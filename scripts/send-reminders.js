/* Runs on a GitHub Actions cron (see .github/workflows/send-reminders.yml),
   not in the browser -- this is the only piece of the project that isn't
   plain client-side JS, because nothing in a browser can schedule a future
   push notification to itself. Pushes are sent *to* a subscribed device *by*
   a server; this is that server, running every 5 minutes. */

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const messaging = admin.messaging();

/* ---- Ported from calendar.js (pure date logic, no DOM/browser dependency).
   Keep in sync by hand -- there's no shared-module system linking this repo's
   browser scripts to this Node script, matching the project's no-build-step
   design elsewhere. ---- */
function pad2(n) { return String(n).padStart(2, '0'); }
function formatISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addToDate(date, freq, interval) {
  const d = new Date(date);
  if (freq === 'daily') d.setDate(d.getDate() + interval);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7 * interval);
  else if (freq === 'monthly') d.setMonth(d.getMonth() + interval);
  else if (freq === 'yearly') d.setFullYear(d.getFullYear() + interval);
  return d;
}
function expandOccurrences(event, rangeStartStr, rangeEndStr) {
  const rangeStart = parseISO(rangeStartStr);
  const rangeEnd = parseISO(rangeEndStr);
  const exceptions = event.exceptions || [];
  const results = [];

  if (event.type === 'custom') {
    (event.dates || []).forEach(ds => {
      const d = parseISO(ds);
      if (d >= rangeStart && d <= rangeEnd && !exceptions.includes(ds)) results.push(ds);
    });
    return results;
  }

  if (!event.recurrence) {
    const d = parseISO(event.date);
    if (d >= rangeStart && d <= rangeEnd && !exceptions.includes(event.date)) results.push(event.date);
    return results;
  }

  const rule = event.recurrence;
  const until = rule.until ? parseISO(rule.until) : null;
  const maxCount = rule.count || Infinity;
  let cur = parseISO(event.date);
  let n = 0;
  let iterations = 0;
  while (n < maxCount && iterations < 3000) {
    if (until && cur > until) break;
    if (cur > rangeEnd) break;
    if (cur >= rangeStart) {
      const ds = formatISO(cur);
      if (!exceptions.includes(ds)) results.push(ds);
    }
    n++;
    iterations++;
    cur = addToDate(cur, rule.freq, rule.interval || 1);
  }
  return results;
}
/* ---- end ported section ---- */

// Converts a wall-clock date+time in a given IANA timezone to the actual UTC
// instant it represents, using only built-in Intl (no external tz library) --
// the standard "double conversion" trick: format a UTC guess as if it were in
// the target zone, see how far that drifted, and correct by the difference.
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcGuess)).map(p => [p.type, p.value]));
  const asIfLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = asIfLocal - utcGuess;
  return new Date(utcGuess - offset);
}

function formatReminderBody(event, occDate) {
  if (!event.time) return `Today, ${occDate}`;
  const [hh, mm] = event.time.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  return `${occDate} at ${h12}:${pad2(mm)} ${period}`;
}

// Retries a few times on Firestore's transient errors (UNAVAILABLE,
// DEADLINE_EXCEEDED, etc) so a brief blip on Google's side doesn't fail the
// whole run and send a failure email.
async function withRetry(fn, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= tries) throw err;
      console.warn(`Attempt ${attempt} failed (${err.message}), retrying...`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

// One-time (or occasional) repair: sets hasReminders on every event from its
// actual reminders map. Run from the Actions tab via "Run workflow" with
// backfill checked. Reads every event once, so don't run it on a schedule.
async function backfill() {
  const snap = await withRetry(() => db.collection('events').get());
  let batch = db.batch();
  let pending = 0;
  let changed = 0;
  for (const doc of snap.docs) {
    const reminders = doc.get('reminders') || {};
    const want = Object.keys(reminders).length > 0;
    if (doc.get('hasReminders') === want) continue;
    batch.update(doc.ref, { hasReminders: want });
    changed++;
    if (++pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
  if (pending > 0) await batch.commit();
  console.log(`Backfill done. ${snap.size} event(s) checked, ${changed} updated.`);
}

async function main() {
  if (process.env.BACKFILL === 'true') return backfill();

  const now = new Date();
  // Much wider than the 5-minute cron interval, on purpose -- observed in
  // practice (via the Actions run history), GitHub does not run this every
  // 5 minutes on a low-traffic personal repo. It's been landing roughly
  // once every 1-2 hours, not every 5 minutes, regardless of the schedule
  // below. sentReminders makes a wide catch-up window safe: it can never
  // cause a duplicate send, only widen the net for a late run -- so the
  // window needs to comfortably outlast the longest gap actually seen
  // between runs, not the configured interval.
  const windowStart = new Date(now.getTime() - 180 * 60 * 1000);
  // Occurrence dates are wall-clock dates in the owner's timezone, but this
  // runner is on UTC -- after ~8 PM Eastern, UTC's "today" is already
  // tomorrow. Starting a day early keeps this evening's events in range;
  // the dueAt window below still decides what actually sends.
  const rangeStartStr = formatISO(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const lookaheadEnd = formatISO(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000));

  // Only events someone has a reminder on (see hasAnyReminders in store.js)
  // -- reading every event and account each run is what used up the free
  // plan's daily read quota.
  const eventsSnap = await withRetry(() =>
    db.collection('events').where('hasReminders', '==', true).get());

  const neededUids = new Set();
  for (const doc of eventsSnap.docs) {
    const data = doc.data();
    if (data.ownerId) neededUids.add(data.ownerId);
    Object.keys(data.reminders || {}).forEach(uid => neededUids.add(uid));
  }
  const accountRefs = [...neededUids].map(uid => db.collection('accounts').doc(uid));
  const accountSnaps = accountRefs.length ? await withRetry(() => db.getAll(...accountRefs)) : [];
  const accounts = new Map(accountSnaps.filter(s => s.exists).map(s => [s.id, s.data()]));

  let sentCount = 0;
  let errorCount = 0;

  for (const doc of eventsSnap.docs) {
    // One bad or just-deleted event shouldn't fail the whole run -- anything
    // not marked sent here simply gets picked up again next run.
    try {
      const event = { id: doc.id, ...doc.data() };
      const reminders = event.reminders || {};
      const uids = Object.keys(reminders);
      if (uids.length === 0) {
        // Stale flag (the app never clears it itself). The precondition
        // skips this if someone added a reminder since we read the doc.
        await doc.ref.update({ hasReminders: false }, { lastUpdateTime: doc.updateTime })
          .catch(() => {});
        continue;
      }

      const owner = accounts.get(event.ownerId);
      if (!owner) continue;
      const timezone = owner.timezone || 'America/New_York';

      const occurrences = expandOccurrences(event, rangeStartStr, lookaheadEnd);
      for (const occDate of occurrences) {
        const eventInstant = zonedTimeToUtc(occDate, event.time, timezone);

        for (const uid of uids) {
          const minutesBefore = reminders[uid];
          const dueAt = new Date(eventInstant.getTime() - minutesBefore * 60 * 1000);
          if (dueAt < windowStart || dueAt > now) continue;

          const sentKey = `${occDate}_${uid}`;
          if (event.sentReminders && event.sentReminders[sentKey]) continue;

          const recipient = accounts.get(uid);
          const tokens = (recipient && recipient.deviceTokens) || [];
          if (tokens.length > 0) {
            const title = event.title || 'Reminder';
            const body = formatReminderBody(event, occDate);
            await Promise.all(tokens.map(token =>
              messaging.send({ token, notification: { title, body } }).catch(err => {
                console.warn(`Failed to send to a token for ${uid}:`, err.message);
              })
            ));
            sentCount++;
            console.log(`Sent reminder for "${event.title}" (${occDate}) to ${uid}`);
          }
          await doc.ref.update({ [`sentReminders.${sentKey}`]: true });
        }
      }
    } catch (err) {
      errorCount++;
      console.warn(`Skipped event ${doc.id}:`, err.message);
    }
  }

  console.log(`Done. ${eventsSnap.size} event(s) with reminders checked, ${sentCount} notification(s) sent, ${errorCount} skipped.`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});

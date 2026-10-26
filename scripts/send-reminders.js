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

// "Today" / "Tomorrow" / "Thu, Oct 30", plus the time for timed events --
// worked out from the day it is for the RECIPIENT right now (in their own
// timezone), not the event's date alone, so a reminder set a day ahead
// says "Tomorrow".
function formatReminderBody(event, occDate, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const todayStr = `${parts.year}-${parts.month}-${parts.day}`;
  const dayDiff = Math.round((Date.parse(`${occDate}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)) / 86400000);
  const day = dayDiff === 0 ? 'Today'
    : dayDiff === 1 ? 'Tomorrow'
    : new Date(`${occDate}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  if (!event.time) return day;
  const [hh, mm] = event.time.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  return `${day} at ${h12}:${pad2(mm)} ${period}`;
}

// Retries a few times on Firestore's transient errors (UNAVAILABLE,
// DEADLINE_EXCEEDED, etc) so a brief blip on Google's side doesn't fail the
// whole run and send a failure email.
/* ---- Standalone reminders (To-do tab) -- copied from store.js's
   reminderOccursOn/reminderNextDate. Keep in sync by hand. ---- */
function reminderOccursOn(r, dateStr) {
  const rep = r.repeat || {};
  if (!rep.date || dateStr < rep.date) return false;
  if (rep.type === 'daily') return true;
  if (rep.type === 'weekly') return (rep.days || []).includes(parseISO(dateStr).getDay());
  if (rep.type === 'monthly') {
    const d = parseISO(dateStr);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(parseISO(rep.date).getDate(), lastDay);
  }
  return dateStr === rep.date;
}
function reminderNextDate(r, afterStr) {
  const d = parseISO(afterStr);
  for (let i = 0; i < 400; i++) {
    d.setDate(d.getDate() + 1);
    const str = formatISO(d);
    if (reminderOccursOn(r, str)) return str;
  }
  return null;
}

// Repeat reminders (see "Keep reminding me until I tap Got it" in Settings).
const MAX_REPEATS = 6;                     // the first one plus 5 repeats, about 30 minutes
const REPEAT_GAP_MS = 4.5 * 60 * 1000;     // runs come every ~5 minutes; a little under so none get skipped
const ALERT_AFTER_MS = 15 * 60 * 1000;     // then tell their connections, if they've turned that on

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

  // Sends one notification to every device a person has signed in on.
  // Returns whether they had any device to send to.
  async function sendTo(person, uid, title, body) {
    const tokens = (person && person.deviceTokens) || [];
    if (!tokens.length) return false;
    await Promise.all(tokens.map(token =>
      messaging.send({ token, notification: { title, body } }).catch(err => {
        console.warn(`Failed to send to a token for ${uid}:`, err.message);
      })
    ));
    return true;
  }
  // Only read when someone's connections actually need alerting.
  let viewerGrants = null;
  async function getViewerGrants() {
    if (!viewerGrants) {
      const snap = await withRetry(() => db.collection('viewers').get());
      viewerGrants = snap.docs.map(d => d.data());
    }
    return viewerGrants;
  }
  async function getAccount(id) {
    if (!accounts.has(id)) {
      const snap = await withRetry(() => db.collection('accounts').doc(id).get());
      if (snap.exists) accounts.set(id, snap.data());
    }
    return accounts.get(id);
  }

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

      // Entirely in the past (nothing from yesterday on, ever again) --
      // stop reading it every run. Editing it back into the future in the
      // app sets hasReminders again (see hasAnyReminders in store.js).
      const farFutureStr = formatISO(new Date(now.getTime() + 2 * 366 * 24 * 60 * 60 * 1000));
      if (expandOccurrences(event, rangeStartStr, farFutureStr).length === 0) {
        await doc.ref.update({ hasReminders: false }, { lastUpdateTime: doc.updateTime })
          .catch(() => {});
        continue;
      }

      // Look far enough ahead for this event's earliest reminder (a
      // "2 weeks before" one needs the event 2 weeks out), never less
      // than the usual 3 days.
      const longest = Math.max(0, ...uids.flatMap(u => [].concat(reminders[u]).filter(n => typeof n === 'number')));
      const eventLookahead = longest > 2 * 24 * 60
        ? formatISO(new Date(now.getTime() + (longest + 24 * 60) * 60 * 1000))
        : lookaheadEnd;
      const occurrences = expandOccurrences(event, rangeStartStr, eventLookahead);
      for (const occDate of occurrences) {
        const eventInstant = zonedTimeToUtc(occDate, event.time, timezone);

        // reminders[uid] is a number (one reminder) or an array (up to 3,
        // e.g. 1 day before AND 1 hour before) -- each sends on its own.
        // One reminder keeps the original "<date>_<uid>" key; several get
        // "<date>_<uid>_<minutes>" so each is tracked separately.
        const due = [];
        for (const uid of uids) {
          const r = reminders[uid];
          (Array.isArray(r) ? r : [r]).forEach(minutesBefore => {
            if (typeof minutesBefore !== 'number') return;
            due.push({ uid, minutesBefore, sentKey: Array.isArray(r) ? `${occDate}_${uid}_${minutesBefore}` : `${occDate}_${uid}` });
          });
        }
        for (const { uid, minutesBefore, sentKey } of due) {
          const dueAt = new Date(eventInstant.getTime() - minutesBefore * 60 * 1000);
          if (dueAt < windowStart || dueAt > now) continue;

          const prev = (event.sentReminders || {})[sentKey];
          // true = sent once, done (everyone without repeat reminders).
          // An object = repeat reminders for someone with "Keep reminding
          // me until I tap Got it" on: { n: times sent, first, last (ms),
          // alerted: connections already told }. Stops once they tap Got
          // it in the app (ackReminders) or after MAX_REPEATS.
          if (prev === true) continue;
          const acked = !!(event.ackReminders || {})[sentKey];
          if (prev && acked) continue;
          // A later reminder for the same event has already gone out (e.g.
          // the 15-minutes-before one after the 30-minutes-before one) --
          // only the newest keeps repeating, so they never double up.
          if (prev && due.some(o => o.uid === uid && o.minutesBefore < minutesBefore
              && (event.sentReminders || {})[o.sentKey])) continue;

          const recipient = accounts.get(uid);
          const recipientTz = (recipient && recipient.timezone) || timezone;
          const repeat = !!(recipient && recipient.nagReminders);
          const nowMs = now.getTime();
          const dueToSend = !prev
            || (repeat && prev.n < MAX_REPEATS && nowMs - prev.last >= REPEAT_GAP_MS);

          if (dueToSend) {
            const title = event.title || 'Reminder';
            const body = formatReminderBody(event, occDate, recipientTz);
            if (await sendTo(recipient, uid, title, prev ? `${body} (tap to open, then Got it)` : body)) {
              sentCount++;
              console.log(`Sent reminder for "${event.title}" (${occDate}) to ${uid}${prev ? ` (repeat ${prev.n + 1})` : ''}`);
            }
            const next = repeat
              ? { n: (prev ? prev.n : 0) + 1, first: prev ? prev.first : nowMs, last: nowMs, alerted: !!(prev && prev.alerted) }
              : true;
            await doc.ref.update({ [`sentReminders.${sentKey}`]: next });
            if (!prev) continue;
          }

          // Still not seen 15 minutes after the first one -- tell the people
          // they're connected to, if they've turned that on.
          if (repeat && !prev.alerted && recipient && recipient.alertConnections
              && nowMs - prev.first >= ALERT_AFTER_MS) {
            const grants = await getViewerGrants();
            const helpers = new Set();
            grants.forEach(g => {
              if (g.viewerId === uid) helpers.add(g.ofUid);
              if (g.ofUid === uid) helpers.add(g.viewerId);
            });
            helpers.delete(uid);
            for (const helperId of helpers) {
              const helper = await getAccount(helperId);
              if (!helper) continue;
              const body = `${event.title || 'An event'}, ${formatReminderBody(event, occDate, helper.timezone || recipientTz)}`;
              if (await sendTo(helper, helperId, `${recipient.name || 'Someone'} hasn't seen a reminder`, body)) sentCount++;
            }
            console.log(`Alerted ${helpers.size} connection(s) for "${event.title}" (${occDate}), ${uid}`);
            await doc.ref.update({ [`sentReminders.${sentKey}.alerted`]: true });
          }
        }
      }
    } catch (err) {
      errorCount++;
      console.warn(`Skipped event ${doc.id}:`, err.message);
    }
  }

  // ---- Standalone reminders. Only ones whose nextDueAt has come are read,
  // so having lots of them never means lots of reads. Each one's `state`
  // tracks today's occurrence: { occDate, n, first, last, alerted, doneBy,
  // doneAt }. One Got it from anyone it reminds stops it for everyone. ----
  const remSnap = await withRetry(() =>
    db.collection('reminders').where('nextDueAt', '<=', now.getTime()).get());
  let households = null;
  const sharesHousehold = async (a, b) => {
    if (!households) households = (await withRetry(() => db.collection('households').get())).docs.map(d => d.data().memberIds || []);
    return households.some(ids => ids.includes(a) && ids.includes(b));
  };
  // Only people the maker could actually remind: themselves, their
  // household, or their connections.
  const mayRemind = async (makerId, uid) => {
    if (uid === makerId || await sharesHousehold(makerId, uid)) return true;
    return (await getViewerGrants()).some(g => (g.viewerId === makerId && g.ofUid === uid) || (g.viewerId === uid && g.ofUid === makerId));
  };
  for (const doc of remSnap.docs) {
    try {
      const r = doc.data();
      const occ = r.nextOccDate;
      const tz = r.timeZone || 'America/New_York';
      const nowMs = now.getTime();
      const advance = extra => {
        const next = occ ? reminderNextDate(r, occ) : null;
        return doc.ref.update({
          nextOccDate: next,
          nextDueAt: next ? zonedTimeToUtc(next, r.time, tz).getTime() : null,
          ...(extra || {}),
        });
      };
      if (!occ) { await doc.ref.update({ nextDueAt: null }); continue; }
      const st = r.state && r.state.occDate === occ ? r.state : null;
      // Already Got it (even before it went off), or the run is hours late.
      if (st && st.doneBy) { await advance(); continue; }
      const occAt = zonedTimeToUtc(occ, r.time, tz).getTime();
      if (!st && nowMs - occAt > 180 * 60 * 1000) { await advance(); continue; }

      const recipients = [];
      for (const uid of r.remindIds || []) {
        if (!(await mayRemind(r.createdBy, uid))) continue;
        const acct = await getAccount(uid);
        if (acct) recipients.push({ uid, acct });
      }
      const nag = recipients.filter(p => p.acct.nagReminders);
      const title = r.title || 'Reminder';
      const bodyFor = (p, repeat) => {
        const base = formatReminderBody({ time: r.time }, occ, p.acct.timezone || tz);
        return [base, r.note].filter(Boolean).join(' · ') + (repeat ? ' (tap to open, then Got it)' : '');
      };

      if (!st) {
        for (const p of recipients) if (await sendTo(p.acct, p.uid, title, bodyFor(p, false))) sentCount++;
        const fresh = { occDate: occ, n: 1, first: nowMs, last: nowMs, alerted: false };
        console.log(`Sent reminder "${title}" (${occ}) to ${recipients.length} person(s)`);
        if (nag.length) await doc.ref.update({ state: fresh, nextDueAt: nowMs + REPEAT_GAP_MS });
        else await advance({ state: fresh });
        continue;
      }

      // Repeat phase -- field-level updates so a Got it tapped in the
      // meantime is never overwritten.
      const upd = {};
      let n = st.n || 1;
      let last = st.last || st.first;
      let alerted = !!st.alerted;
      if (nag.length && n < MAX_REPEATS && nowMs - last >= REPEAT_GAP_MS) {
        for (const p of nag) if (await sendTo(p.acct, p.uid, title, bodyFor(p, true))) sentCount++;
        n += 1; last = nowMs;
        upd['state.n'] = n; upd['state.last'] = last;
      }
      const alertFor = nag.filter(p => p.acct.alertConnections);
      if (alertFor.length && !alerted && nowMs - st.first >= ALERT_AFTER_MS) {
        const grants = await getViewerGrants();
        const reminded = new Set(recipients.map(p => p.uid));
        const told = new Set();
        for (const p of alertFor) {
          grants.forEach(g => {
            if (g.viewerId === p.uid) told.add(g.ofUid);
            if (g.ofUid === p.uid) told.add(g.viewerId);
          });
        }
        reminded.forEach(id => told.delete(id));
        const names = alertFor.map(p => p.acct.name || 'Someone').join(' and ');
        for (const helperId of told) {
          const helper = await getAccount(helperId);
          if (!helper) continue;
          const body = `${title}, ${formatReminderBody({ time: r.time }, occ, helper.timezone || tz)}`;
          if (await sendTo(helper, helperId, `${names} hasn't tapped Got it`, body)) sentCount++;
        }
        alerted = true;
        upd['state.alerted'] = true;
      }
      const wake = [];
      if (nag.length && n < MAX_REPEATS) wake.push(last + REPEAT_GAP_MS);
      if (alertFor.length && !alerted) wake.push(st.first + ALERT_AFTER_MS);
      if (wake.length) {
        upd.nextDueAt = Math.min(...wake);
        await doc.ref.update(upd);
      } else {
        await advance(upd);
      }
    } catch (err) {
      errorCount++;
      console.warn(`Skipped reminder ${doc.id}:`, err.message);
    }
  }

  console.log(`Done. ${eventsSnap.size} event(s) with reminders checked, ${remSnap.size} reminder(s) due, ${sentCount} notification(s) sent, ${errorCount} skipped.`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});

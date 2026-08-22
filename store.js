/* Data layer. Shared calendar data (accounts, connections, households,
   invites, events, categories, views) lives in Firestore and syncs across
   devices via Firebase Auth -- see firebase-config.js and firestore.rules.
   Everything else (todos, planner content, per-device theme, birthdays,
   stickers, habits, event presets, holidays-followed) stays in localStorage,
   same as always: these are per-device preferences or intentionally local
   data, not shared calendar content. */

// Auto-assigned colors (new accounts, new categories) before anyone picks
// their own -- kept soft/muted to match the app's palette, not saturated or
// bright, since these are what people see before they've customized anything.
const DEFAULT_COLORS = ['#7C93A8', '#8A9A6B', '#B08F5A', '#A67B87', '#7E8CA3', '#9C8AA5', '#71816C', '#8C6A56'];

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---- Firestore-backed cache --------------------------------------------
// The rest of the app (calendar.js, todo.js, settings.js) calls Store's
// getters synchronously, inline while building render HTML -- that never
// changed, and rewriting every call site to be async was out of scope. So
// instead, Store.startSync() below opens live onSnapshot listeners that keep
// this in-memory cache current, and every getter just reads the cache. Writes
// update the cache immediately (so the very next render sees them, matching
// the old localStorage UX) and fire the real Firestore write in the
// background, unawaited by the caller.
const _cache = {
  accounts: [],
  connections: [],
  households: [],
  events: [],
  categories: [],
  views: [],       // the CURRENT signed-in user's own custom views only (private)
  editTrust: [],   // uids the CURRENT signed-in user has mutual edit-trust with (private)
  notes: [],       // own notes plus any shared with the current user (see the `visibleTo` note below)
};
let _unsubscribers = [];
let _changeListeners = [];

// Deterministic connection doc id -- this (not a random id) is what lets
// Firestore security rules do an O(1) exists() check for "is A connected to
// B" instead of an unindexable query.
function connectionDocId(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// visibleTo is a denormalized array of every uid allowed to read an event --
// Firestore security rules can only validate a *live* collection query (as
// opposed to a single-doc get) against conditions the query itself proves,
// so an array-contains field is the standard way to make "which events can I
// see" both a valid live query and a valid rule (see firestore.rules).
// Limitation: when authoring an event as someone else (the Participants
// picker), this client may not know that person's *other* connections, so a
// 'shared' event tagging them is only guaranteed visible to them and the
// author, not their full connection list, until it's next edited by one of
// them directly (their own client then fills in the rest).
function computeVisibleTo(participantIds, visibility, customPeople) {
  if (visibility === 'private') return participantIds;
  if (visibility === 'custom') return Array.from(new Set([...participantIds, ...(customPeople || [])]));
  // 'shared' -- every participant, plus (for whichever participant is the
  // current user) their own connections too.
  const currentUserId = Store.getCurrentUserId();
  const ids = new Set(participantIds);
  participantIds.forEach(pid => {
    if (pid === currentUserId) Store.getConnectedIds(pid).forEach(id => ids.add(id));
  });
  return Array.from(ids);
}

const Store = {
  // ---- sync lifecycle: call startSync(uid) after Firebase Auth signs
  // someone in, before rendering the app. Returns a promise that resolves
  // once every collection has delivered its first snapshot. ----
  startSync(userId) {
    this.stopSync();
    const db = firebase.firestore();
    const pending = new Set(['accounts', 'connections-a', 'connections-b', 'households', 'events', 'categories', 'views', 'editTrust', 'notes']);
    let resolveReady;
    const ready = new Promise(res => { resolveReady = res; });
    const settle = key => {
      pending.delete(key);
      if (pending.size === 0) resolveReady();
    };
    const notify = () => this._changeListeners.forEach(fn => fn());

    _unsubscribers.push(db.collection('accounts').onSnapshot(snap => {
      _cache.accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      settle('accounts'); notify();
    }));

    let connA = {}, connB = {};
    const mergeConnections = () => {
      _cache.connections = Object.values({ ...connA, ...connB });
      notify();
    };
    _unsubscribers.push(db.collection('connections').where('a', '==', userId).onSnapshot(snap => {
      connA = {}; snap.forEach(d => { connA[d.id] = d.data(); });
      settle('connections-a'); mergeConnections();
    }));
    _unsubscribers.push(db.collection('connections').where('b', '==', userId).onSnapshot(snap => {
      connB = {}; snap.forEach(d => { connB[d.id] = d.data(); });
      settle('connections-b'); mergeConnections();
    }));

    _unsubscribers.push(db.collection('households').onSnapshot(snap => {
      _cache.households = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      settle('households'); notify();
    }));

    _unsubscribers.push(db.collection('events').where('visibleTo', 'array-contains', userId).onSnapshot(snap => {
      _cache.events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      settle('events'); notify();
    }));

    _unsubscribers.push(db.collection('categories').onSnapshot(snap => {
      _cache.categories = snap.docs.map(d => d.id);
      settle('categories'); notify();
    }));

    _unsubscribers.push(db.collection('views').doc(userId).collection('customViews').onSnapshot(snap => {
      _cache.views = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      settle('views'); notify();
    }));

    // Private per-person index of who I have mutual edit-trust with (i.e.
    // who can add/edit events on my behalf, and vice versa) -- granted only
    // by sharing a household, never by a plain 1:1 connection. See
    // addEditTrust/removeEditTrust and the household join/leave/remove flows.
    _unsubscribers.push(db.collection('editIndex').doc(userId).onSnapshot(snap => {
      _cache.editTrust = (snap.data() && snap.data().ids) || [];
      settle('editTrust'); notify();
    }));

    // Same visibleTo pattern as events (see computeVisibleTo/addEvent) but
    // simpler -- a note's visibleTo is just [ownerId, ...sharedWith], no
    // household/connections expansion, since "share with specific people"
    // is meant to be an explicit, one-off list rather than inheriting
    // whoever the owner happens to be connected to.
    _unsubscribers.push(db.collection('notes').where('visibleTo', 'array-contains', userId).onSnapshot(
      snap => {
        _cache.notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        settle('notes'); notify();
      },
      // Without an error handler here, a failed query (e.g. the Firestore
      // rules for this collection not deployed yet) leaves 'notes' stuck in
      // `pending` forever, which means startSync()'s returned promise never
      // resolves -- silently hanging the ENTIRE app on the pre-sync skeleton
      // (no events, nothing) for every user, not just breaking notes. Treat
      // a failed notes query as "no notes yet" instead of a fatal condition.
      err => {
        console.warn('Notes sync failed:', err.code);
        settle('notes'); notify();
      }
    ));

    return ready;
  },
  stopSync() {
    _unsubscribers.forEach(fn => fn());
    _unsubscribers = [];
    _cache.accounts = []; _cache.connections = []; _cache.households = [];
    _cache.events = []; _cache.categories = []; _cache.views = []; _cache.editTrust = [];
    _cache.notes = [];
  },
  // Registers a callback fired after every live cache update (i.e. a change
  // made by someone else, or on another device, arrived). main.js uses this
  // to re-render the active tab so remote changes show up without a reload.
  onDataChange(fn) {
    this._changeListeners.push(fn);
  },
  _changeListeners,

  // ---- accounts ----
  getAccounts() {
    return _cache.accounts;
  },
  getAccount(id) {
    return _cache.accounts.find(a => a.id === id);
  },
  // Called once, right after Firebase Auth creates a new user -- picks a
  // color round-robin like before, via a one-time count read (not the live
  // cache, which may not be populated yet this early in signup).
  async createAccountDoc(userId, name, email) {
    const db = firebase.firestore();
    const countSnap = await db.collection('accounts').get();
    const defaultColor = DEFAULT_COLORS[countSnap.size % DEFAULT_COLORS.length];
    // timezone anchors "3pm" on this person's events to an actual instant,
    // for the reminders scheduler (which runs outside any browser and has
    // no "local time" of its own) -- not user-facing, just captured once.
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const account = { name, email: email.trim().toLowerCase(), defaultColor, timezone, deviceTokens: [] };
    await db.collection('accounts').doc(userId).set(account);
    // Private per-person index of who has mutual edit-trust with them (see
    // the _cache.editTrust comment in startSync above), used only by
    // Firestore security rules to check "can the requester edit this
    // event's owner's events" -- kept separate from the public `accounts`
    // doc for privacy, and keyed directly by uid (not a composite key)
    // because rules can only reliably get() a path built from a single
    // direct value, not a concatenated one.
    await db.collection('editIndex').doc(userId).set({ ids: [] });
    return { id: userId, ...account };
  },
  updateAccount(id, patch) {
    const idx = _cache.accounts.findIndex(a => a.id === id);
    if (idx >= 0) _cache.accounts[idx] = { ..._cache.accounts[idx], ...patch };
    firebase.firestore().collection('accounts').doc(id).update(patch);
  },
  // Registers this browser/device for push notifications -- arrayUnion so
  // signing in on a second device adds a token instead of replacing the first.
  addDeviceToken(userId, token) {
    const idx = _cache.accounts.findIndex(a => a.id === userId);
    if (idx >= 0) {
      const tokens = _cache.accounts[idx].deviceTokens || [];
      if (!tokens.includes(token)) _cache.accounts[idx] = { ..._cache.accounts[idx], deviceTokens: [...tokens, token] };
    }
    firebase.firestore().collection('accounts').doc(userId)
      .update({ deviceTokens: firebase.firestore.FieldValue.arrayUnion(token) });
  },
  // Stops reminders being sent to this specific device without touching the
  // browser's own notification permission (which JS can never revoke).
  removeDeviceToken(userId, token) {
    const idx = _cache.accounts.findIndex(a => a.id === userId);
    if (idx >= 0) {
      const tokens = (_cache.accounts[idx].deviceTokens || []).filter(t => t !== token);
      _cache.accounts[idx] = { ..._cache.accounts[idx], deviceTokens: tokens };
    }
    firebase.firestore().collection('accounts').doc(userId)
      .update({ deviceTokens: firebase.firestore.FieldValue.arrayRemove(token) });
  },
  // Back-compat alias used throughout the UI: a generic "look up this id" helper.
  getPerson(id) {
    return this.getAccount(id);
  },
  updatePerson(id, patch) {
    this.updateAccount(id, patch);
  },

  // ---- connections (mutual, pairwise; only accepted connections are stored).
  // Note: the live cache only ever contains connections involving the
  // *current* signed-in user (that's what the security rules allow), which
  // matches every real call site below -- isConnected/addConnection/etc are
  // never called for a pair that doesn't include the current user. ----
  isConnected(a, b) {
    return _cache.connections.some(c => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  },
  // Visibility only -- does NOT grant edit access (see addEditTrust, which
  // only households grant).
  addConnection(a, b) {
    if (a === b || this.isConnected(a, b)) return;
    const conn = { a, b, createdAt: Date.now() };
    _cache.connections.push(conn);
    firebase.firestore().collection('connections').doc(connectionDocId(a, b)).set(conn);
  },
  // Unilateral + silent: either side can remove without the other's approval,
  // and it also prunes the removed person out of the remover's saved views.
  // Never touches edit-trust -- that's household-managed (see
  // removeHouseholdMember), independent of this.
  removeConnection(userId, otherId) {
    _cache.connections = _cache.connections.filter(c =>
      !((c.a === userId && c.b === otherId) || (c.a === otherId && c.b === userId))
    );
    // Swallowed catch: removeHouseholdMember also calls this for pairs that
    // may not include the current signed-in user, which the connections
    // delete rule (must be one of the two parties) correctly rejects.
    firebase.firestore().collection('connections').doc(connectionDocId(userId, otherId)).delete().catch(() => {});
    if (userId === this.getCurrentUserId()) {
      _cache.views.filter(v => (v.peopleIds || []).includes(otherId)).forEach(v => {
        const peopleIds = v.peopleIds.filter(id => id !== otherId);
        this._updateOwnView(userId, v.id, { peopleIds });
      });
    }
  },
  // ---- edit-trust (mutual; granted only by sharing a household -- see
  // acceptInvite's household branch and removeHouseholdMember. A plain 1:1
  // connection above never touches this.) ----
  isEditTrusted(otherId) {
    return _cache.editTrust.includes(otherId);
  },
  getEditTrustedIds() {
    return _cache.editTrust;
  },
  addEditTrust(a, b) {
    if (a === b) return;
    const db = firebase.firestore();
    if (a === this.getCurrentUserId() && !_cache.editTrust.includes(b)) _cache.editTrust.push(b);
    if (b === this.getCurrentUserId() && !_cache.editTrust.includes(a)) _cache.editTrust.push(a);
    db.collection('editIndex').doc(a).update({ ids: firebase.firestore.FieldValue.arrayUnion(b) });
    db.collection('editIndex').doc(b).update({ ids: firebase.firestore.FieldValue.arrayUnion(a) });
  },
  removeEditTrust(a, b) {
    const db = firebase.firestore();
    if (a === this.getCurrentUserId()) _cache.editTrust = _cache.editTrust.filter(id => id !== b);
    if (b === this.getCurrentUserId()) _cache.editTrust = _cache.editTrust.filter(id => id !== a);
    // Fire-and-forget with a swallowed catch: whichever side isn't the
    // current signed-in user will be rejected by the editIndex security
    // rule (you can only touch your own index, or append/remove exactly
    // your own uid elsewhere) when a third household member removes two
    // *other* people from a shared household -- that pair's tie is left
    // for one of them to clean up next time their own client is active.
    db.collection('editIndex').doc(a).update({ ids: firebase.firestore.FieldValue.arrayRemove(b) }).catch(() => {});
    db.collection('editIndex').doc(b).update({ ids: firebase.firestore.FieldValue.arrayRemove(a) }).catch(() => {});
  },
  getConnectedIds(userId) {
    return _cache.connections
      .filter(c => c.a === userId || c.b === userId)
      .map(c => (c.a === userId ? c.b : c.a));
  },
  // "Known people" = the accounts a given user is allowed to see/act on: themselves + accepted connections.
  getKnownPeople(userId) {
    const me = this.getAccount(userId);
    const connected = this.getConnectedIds(userId).map(id => this.getAccount(id)).filter(Boolean);
    return me ? [me, ...connected] : connected;
  },

  // ---- households (named group of accounts; bulk-invite convenience only, not a shared login) ----
  getHouseholds() {
    return _cache.households;
  },
  // Self-heal: makes sure the signed-in user has a connection + edit-trust
  // with every co-member of every household they're in. Covers people whose
  // roster entry predates a fix to the join flow (or any write that only
  // partially landed) -- addConnection/addEditTrust are both no-ops if the
  // tie already exists, so running this on every sign-in is cheap and safe.
  reconcileHouseholdTies(userId) {
    this.getHouseholdsFor(userId).forEach(h => {
      h.memberIds.filter(id => id !== userId).forEach(otherId => {
        if (!this.isConnected(userId, otherId)) this.addConnection(userId, otherId);
        if (!this.isEditTrusted(otherId)) this.addEditTrust(userId, otherId);
      });
    });
  },
  getHouseholdsFor(userId) {
    return _cache.households.filter(h => h.memberIds.includes(userId));
  },
  createHousehold(name, founderId) {
    const id = uid();
    const household = { id, name, memberIds: [founderId] };
    _cache.households.push(household);
    firebase.firestore().collection('households').doc(id).set({ name, memberIds: [founderId] });
    return household;
  },
  addHouseholdMember(householdId, userId) {
    const h = _cache.households.find(h => h.id === householdId);
    if (h && !h.memberIds.includes(userId)) h.memberIds = [...h.memberIds, userId];
    firebase.firestore().collection('households').doc(householdId)
      .update({ memberIds: firebase.firestore.FieldValue.arrayUnion(userId) });
  },
  // Any current member can remove any member, including themselves ("leave").
  // Severs the visibility + edit-trust that membership granted with every
  // other remaining member. Note: this can only fully sever ties the acting
  // user is themselves party to (security rules require you to be one of
  // the two people in a connection/edit-trust pair to touch it) -- for a
  // pair of two *other* remaining members, removeEditTrust's write is
  // rejected and silently skipped; the next time either of them has the app
  // open, their own client's household-membership check would need to
  // reconcile it (not yet built -- a known gap for 3+ person households).
  removeHouseholdMember(householdId, memberId) {
    const h = _cache.households.find(hh => hh.id === householdId);
    if (!h) return;
    const newMemberIds = h.memberIds.filter(id => id !== memberId);
    h.memberIds = newMemberIds;
    firebase.firestore().collection('households').doc(householdId).update({ memberIds: newMemberIds });
    newMemberIds.forEach(otherId => {
      this.removeConnection(memberId, otherId);
      this.removeEditTrust(memberId, otherId);
    });
  },

  // ---- invites (shareable links/codes; reusable until revoked). Not
  // live-cached -- looked up on demand (accept-invite flow, or opening the
  // Settings invite-link UI), so these are the only Store methods in this
  // section that return promises instead of reading synchronously. ----
  // type: 'individual_connect' | 'household_member' | 'household_connect'
  async getOrCreateInvite(type, ownerId, householdId = null) {
    const db = firebase.firestore();
    const snap = await db.collection('invites')
      .where('ownerId', '==', ownerId).where('type', '==', type).where('householdId', '==', householdId).get();
    const existing = snap.docs.find(d => !d.data().revoked);
    if (existing) return existing.id;
    const code = uid();
    await db.collection('invites').doc(code).set({ type, ownerId, householdId, revoked: false });
    return code;
  },
  async revokeInvite(code) {
    await firebase.firestore().collection('invites').doc(code).update({ revoked: true });
  },
  async resolveInvite(code) {
    const doc = await firebase.firestore().collection('invites').doc(code).get();
    if (!doc.exists) return null;
    const invite = { code, ...doc.data() };
    return invite.revoked ? null : invite;
  },
  // Returns { ok: true } or { ok: false, reason } — never partially applies.
  async acceptInvite(code, acceptingUserId) {
    const invite = await this.resolveInvite(code);
    if (!invite) return { ok: false, reason: 'This invite link is no longer valid.' };
    if (invite.type === 'individual_connect') {
      if (invite.ownerId === acceptingUserId) return { ok: false, reason: "That's your own invite link." };
      this.addConnection(invite.ownerId, acceptingUserId);
      return { ok: true, connectedTo: [invite.ownerId] };
    }
    // Both invite types land here and behave identically: joining a
    // household always means full mutual visibility *and* mutual edit-trust
    // with everyone currently in it (via real pairwise connections/edit
    // grants, reusing the same mechanisms a direct connection would use)
    // *and* joining the roster, so the next person who joins connects to
    // you too. A household is just a standing group -- there's no "member
    // but can't see or touch anything" state. (Two type strings still
    // recognized so an already-shared old invite link keeps working.)
    if (invite.type === 'household_member' || invite.type === 'household_connect') {
      const household = this.getHouseholds().find(h => h.id === invite.householdId);
      if (!household) return { ok: false, reason: 'This household no longer exists.' };
      const others = household.memberIds.filter(id => id !== acceptingUserId);
      others.forEach(id => {
        this.addConnection(id, acceptingUserId);
        this.addEditTrust(id, acceptingUserId);
      });
      this.addHouseholdMember(invite.householdId, acceptingUserId);
      return { ok: true, connectedTo: others, joinedHousehold: invite.householdId };
    }
    return { ok: false, reason: 'Unknown invite type.' };
  },

  // ---- current user (device identity) -- now just a thin read of Firebase
  // Auth's own persisted session instead of a manual localStorage flag. ----
  getCurrentUserId() {
    const user = firebase.auth().currentUser;
    return user ? user.uid : null;
  },

  // ---- events ----
  getEvents() {
    return _cache.events;
  },
  addEvent(event) {
    const id = event.id || uid();
    const participantIds = event.participantIds || [event.ownerId];
    const visibleTo = computeVisibleTo(participantIds, event.visibility, event.customPeople);
    const full = { ...event, id, participantIds, visibleTo };
    _cache.events.push(full);
    firebase.firestore().collection('events').doc(id).set(full);
  },
  updateEvent(id, patch) {
    const idx = _cache.events.findIndex(e => e.id === id);
    if (idx < 0) return;
    const merged = { ..._cache.events[idx], ...patch };
    if ('visibility' in patch || 'customPeople' in patch || 'ownerId' in patch || 'participantIds' in patch) {
      const participantIds = merged.participantIds || [merged.ownerId];
      merged.visibleTo = computeVisibleTo(participantIds, merged.visibility, merged.customPeople);
    }
    _cache.events[idx] = merged;
    firebase.firestore().collection('events').doc(id).set(merged);
  },
  deleteEvent(id) {
    _cache.events = _cache.events.filter(e => e.id !== id);
    firebase.firestore().collection('events').doc(id).delete();
  },
  // Reminders are per-viewer (two people who can both see an event may want
  // different reminder times, or none). This uses a targeted dot-notation
  // update instead of updateEvent's full-document merge-then-set, so setting
  // your own reminder can never clobber someone else's concurrent edit to
  // the same event (title, another person's reminder, etc).
  setMyReminder(eventId, userId, minutes) {
    const idx = _cache.events.findIndex(e => e.id === eventId);
    if (idx >= 0) {
      const reminders = { ..._cache.events[idx].reminders };
      if (minutes == null) delete reminders[userId];
      else reminders[userId] = minutes;
      _cache.events[idx] = { ..._cache.events[idx], reminders };
    }
    const field = `reminders.${userId}`;
    firebase.firestore().collection('events').doc(eventId)
      .update({ [field]: minutes == null ? firebase.firestore.FieldValue.delete() : minutes });
  },

  // ---- categories (simple flat shared list, derived + custom) ----
  getCategories() {
    return _cache.categories;
  },
  addCategory(name) {
    if (_cache.categories.includes(name)) return;
    _cache.categories.push(name);
    firebase.firestore().collection('categories').doc(name).set({});
  },
  // Renames a category everywhere it's referenced: the shared category list,
  // and every event tagged with it. (Per-user category colors and saved
  // views stay local/private, so a rename can leave a stale reference in
  // someone else's own view filter or color map -- harmless, since a
  // category name that no longer exists just matches nothing.)
  renameCategory(oldName, newName) {
    newName = newName.trim();
    if (!newName || newName === oldName) return;
    const db = firebase.firestore();
    _cache.categories = Array.from(new Set(_cache.categories.map(c => c === oldName ? newName : c)));
    db.collection('categories').doc(oldName).delete();
    db.collection('categories').doc(newName).set({});

    _cache.events.forEach(e => {
      if (e.category === oldName) {
        e.category = newName;
        db.collection('events').doc(e.id).update({ category: newName });
      }
    });

    const colorMap = this.getCategoryColorMap(Store.getCurrentUserId());
    if (colorMap[oldName]) {
      colorMap[newName] = colorMap[oldName];
      delete colorMap[oldName];
      writeJSON(`fc_catcolors_${Store.getCurrentUserId()}`, colorMap);
    }
  },
  // Un-tags any events using this category (doesn't delete the events).
  deleteCategory(name) {
    const db = firebase.firestore();
    _cache.categories = _cache.categories.filter(c => c !== name);
    db.collection('categories').doc(name).delete();

    _cache.events.forEach(e => {
      if (e.category === name) {
        e.category = null;
        db.collection('events').doc(e.id).update({ category: null });
      }
    });

    const colorMap = this.getCategoryColorMap(Store.getCurrentUserId());
    if (colorMap[name]) {
      delete colorMap[name];
      writeJSON(`fc_catcolors_${Store.getCurrentUserId()}`, colorMap);
    }
  },

  // ---- per-user category color map (like colorFor, but keyed by category
  // name) -- stays local/per-device, same as before. ----
  getCategoryColorMap(userId) {
    return readJSON(`fc_catcolors_${userId}`, {});
  },
  setCategoryColor(userId, category, color) {
    const map = this.getCategoryColorMap(userId);
    map[category] = color;
    writeJSON(`fc_catcolors_${userId}`, map);
  },
  categoryColorFor(userId, category) {
    const map = this.getCategoryColorMap(userId);
    if (map[category]) return map[category];
    const cats = this.getCategories();
    const idx = cats.indexOf(category);
    return DEFAULT_COLORS[(idx >= 0 ? idx : 0) % DEFAULT_COLORS.length];
  },

  // ---- per-user views (private -- only ever read/written for the current
  // signed-in user, matching the security rules) ----
  getViews(userId) {
    const builtIn = [
      { id: '__everyone', name: 'Everyone', peopleIds: this.getKnownPeople(userId).map(p => p.id), categories: [], builtIn: true },
      { id: '__justme', name: 'Just me', peopleIds: [userId], categories: [], builtIn: true },
    ];
    return builtIn.concat(_cache.views);
  },
  addCustomView(userId, view) {
    const id = uid();
    const full = { id, ...view };
    _cache.views.push(full);
    firebase.firestore().collection('views').doc(userId).collection('customViews').doc(id).set(view);
  },
  deleteCustomView(userId, viewId) {
    _cache.views = _cache.views.filter(v => v.id !== viewId);
    firebase.firestore().collection('views').doc(userId).collection('customViews').doc(viewId).delete();
  },
  _updateOwnView(userId, viewId, patch) {
    const idx = _cache.views.findIndex(v => v.id === viewId);
    if (idx >= 0) _cache.views[idx] = { ..._cache.views[idx], ...patch };
    firebase.firestore().collection('views').doc(userId).collection('customViews').doc(viewId).update(patch);
  },
  getDefaultViewId(userId) {
    return localStorage.getItem(`fc_defaultView_${userId}`) || '__everyone';
  },
  setDefaultViewId(userId, viewId) {
    localStorage.setItem(`fc_defaultView_${userId}`, viewId);
  },
  getActiveViewId(userId) {
    return localStorage.getItem(`fc_activeView_${userId}`) || this.getDefaultViewId(userId);
  },
  setActiveViewId(userId, viewId) {
    localStorage.setItem(`fc_activeView_${userId}`, viewId);
  },

  // ---- default calendar view mode: which of Month/Week/Day/Planner etc. opens on load ----
  getDefaultCalendarView(userId) {
    return localStorage.getItem(`fc_defaultCalendarView_${userId}`) || 'month';
  },
  setDefaultCalendarView(userId, mode) {
    localStorage.setItem(`fc_defaultCalendarView_${userId}`, mode);
  },
  getCategoryFilter(userId) {
    return localStorage.getItem(`fc_categoryFilter_${userId}`) || '';
  },
  setCategoryFilter(userId, category) {
    localStorage.setItem(`fc_categoryFilter_${userId}`, category || '');
  },

  // ---- view picker mode: 'named' (saved/custom views) or 'checklist' (live multi-select) ----
  getViewMode(userId) {
    return localStorage.getItem(`fc_viewMode_${userId}`) || 'named';
  },
  setViewMode(userId, mode) {
    localStorage.setItem(`fc_viewMode_${userId}`, mode);
  },

  // ---- whether events show their person/category color as a background
  // chip / left border, or just plain title text with no color coding ----
  getShowEventColors(userId) {
    return localStorage.getItem(`fc_showEventColors_${userId}`) !== '0';
  },
  setShowEventColors(userId, val) {
    localStorage.setItem(`fc_showEventColors_${userId}`, val ? '1' : '0');
  },
  // Month view only (day chips + multi-day bars): whether the event's own
  // color tints both box and text ('colored', the default), or the box
  // goes solid with fixed white/black text instead. Per-viewer like every
  // other color preference -- your choice here doesn't affect what anyone
  // else on the household sees.
  getEventTextMode(userId) {
    return localStorage.getItem(`fc_eventTextMode_${userId}`) || 'colored';
  },
  setEventTextMode(userId, mode) {
    localStorage.setItem(`fc_eventTextMode_${userId}`, mode);
  },
  // categories: [] means "all categories, including uncategorized" (same convention as views).
  getChecklistFilter(userId) {
    return readJSON(`fc_checklist_${userId}`, { peopleIds: this.getKnownPeople(userId).map(p => p.id), categories: [] });
  },
  setChecklistFilter(userId, filter) {
    writeJSON(`fc_checklist_${userId}`, filter);
  },
  // Resolves whichever picker mode is active into one {peopleIds, categories, categoryFilter} shape.
  getActiveFilter(userId) {
    if (this.getViewMode(userId) === 'checklist') {
      const f = this.getChecklistFilter(userId);
      return { peopleIds: f.peopleIds, categories: f.categories, categoryFilter: null };
    }
    const activeViewId = this.getActiveViewId(userId);
    const view = this.getViews(userId).find(v => v.id === activeViewId) || this.getViews(userId)[0];
    return { peopleIds: view.peopleIds, categories: view.categories, categoryFilter: this.getCategoryFilter(userId) };
  },

  // ---- planner view: each day has its own widget layout + content, so a
  // preset applies to whichever day you're on, not to every day at once.
  // Default widget ids are fixed strings (not uid()) so an uncustomized day
  // returns the *same* ids on every read -- otherwise two back-to-back reads
  // of a never-saved day would hand out different ids and things like a
  // delete button would silently no-op (filtering by an id from the first
  // read against a freshly-regenerated second read that doesn't have it).
  defaultPlannerDay() {
    return {
      layout: [
        { id: 'default-events', type: 'events', width: 'full' },
        { id: 'default-priorities', type: 'priorities', width: 'full' },
        { id: 'default-notes', type: 'notes', width: 'full' },
      ],
      stickers: [],
      content: {},
    };
  },
  // content is keyed by widget id (not type), so multiple widgets of the
  // same type -- or custom ones -- never collide.
  getPlannerDay(userId, dateStr) {
    const all = readJSON(`fc_plannerDays_${userId}`, {});
    return all[dateStr] || this.defaultPlannerDay();
  },
  savePlannerDay(userId, dateStr, data) {
    const all = readJSON(`fc_plannerDays_${userId}`, {});
    all[dateStr] = data;
    writeJSON(`fc_plannerDays_${userId}`, all);
  },
  getPlannerLayout(userId, dateStr) {
    return this.getPlannerDay(userId, dateStr).layout;
  },
  savePlannerLayout(userId, dateStr, layout) {
    const d = this.getPlannerDay(userId, dateStr);
    d.layout = layout;
    this.savePlannerDay(userId, dateStr, d);
  },

  // ---- week view stickers (keyed by that week's start date -- a separate
  // bucket from planner's per-day stickers, so the two never collide) ----
  getWeekStickers(userId, weekStart) {
    const all = readJSON(`fc_weekStickers_${userId}`, {});
    return all[weekStart] || [];
  },
  saveWeekStickers(userId, weekStart, stickers) {
    const all = readJSON(`fc_weekStickers_${userId}`, {});
    all[weekStart] = stickers;
    writeJSON(`fc_weekStickers_${userId}`, all);
  },

  // Habit names persist across days (per habit-tracker widget instance);
  // only which ones are checked is per-day, stored in that day's content.
  getHabitDefs(userId, widgetId) {
    const all = readJSON(`fc_habitDefs_${userId}`, {});
    return all[widgetId] || [];
  },
  saveHabitDefs(userId, widgetId, defs) {
    const all = readJSON(`fc_habitDefs_${userId}`, {});
    all[widgetId] = defs;
    writeJSON(`fc_habitDefs_${userId}`, all);
  },
  // A single, user-wide "default" habit list. Saving from any habit tracker
  // overwrites it; new habit trackers (added fresh, or via a preset) start
  // seeded from whatever this currently holds.
  getHabitTemplate(userId) {
    return readJSON(`fc_habitTemplate_${userId}`, []);
  },
  saveHabitTemplate(userId, habits) {
    writeJSON(`fc_habitTemplate_${userId}`, habits);
  },

  // ---- named, reusable drawing templates -- save a drawing widget's current
  // strokes under a name, then pick that name from the Add Widget menu later
  // to start a fresh drawing widget pre-seeded with those same strokes ----
  getDrawingTemplates(userId) {
    return readJSON(`fc_drawingTemplates_${userId}`, []);
  },
  saveDrawingTemplates(userId, list) {
    writeJSON(`fc_drawingTemplates_${userId}`, list);
  },

  // ---- sticker book: a starter set plus whatever the user adds (emoji or an uploaded image) ----
  getStickerLibrary(userId) {
    return readJSON(`fc_stickerLibrary_${userId}`, [
      { id: 'star', type: 'emoji', value: '⭐' },
      { id: 'blossom', type: 'emoji', value: '🌸' },
      { id: 'sun', type: 'emoji', value: '☀️' },
      { id: 'moon', type: 'emoji', value: '🌙' },
      { id: 'sparkles', type: 'emoji', value: '✨' },
      { id: 'check', type: 'emoji', value: '✔️' },
      { id: 'pin', type: 'emoji', value: '📌' },
      { id: 'heart', type: 'emoji', value: '💛' },
    ]);
  },
  // item: { type: 'emoji'|'image', value }. Emoji dedupe against existing entries; every image upload is its own entry.
  addToStickerLibrary(userId, item) {
    const lib = this.getStickerLibrary(userId);
    if (item.type === 'emoji' && lib.some(l => l.type === 'emoji' && l.value === item.value)) return;
    lib.push({ id: uid(), ...item });
    writeJSON(`fc_stickerLibrary_${userId}`, lib);
  },
  removeFromStickerLibrary(userId, itemId) {
    writeJSON(`fc_stickerLibrary_${userId}`, this.getStickerLibrary(userId).filter(item => item.id !== itemId));
  },

  // ---- which widget types show in the "+" Add Widget menu, and in what order ----
  getPlannerWidgetCatalog(userId) {
    return readJSON(`fc_plannerCatalog_${userId}`, [
      'events', 'todo', 'notes', 'priorities', 'mood', 'habits',
      'memories', 'photos', 'gratitude', 'goals', 'moodboard', 'drawing',
    ]);
  },
  savePlannerWidgetCatalog(userId, keys) {
    writeJSON(`fc_plannerCatalog_${userId}`, keys);
  },

  // ---- planner layout presets: named, reusable widget arrangements ----
  getPlannerPresets(userId) {
    return readJSON(`fc_plannerPresets_${userId}`, []);
  },
  savePlannerPresets(userId, presets) {
    writeJSON(`fc_plannerPresets_${userId}`, presets);
  },
  addPlannerPreset(userId, name, layout) {
    const presets = this.getPlannerPresets(userId);
    presets.push({ id: uid(), name, layout });
    this.savePlannerPresets(userId, presets);
  },
  deletePlannerPreset(userId, presetId) {
    this.savePlannerPresets(userId, this.getPlannerPresets(userId).filter(p => p.id !== presetId));
  },

  // ---- per-user color map (which color I see each person as) ----
  getColorMap(userId) {
    return readJSON(`fc_colors_${userId}`, {});
  },
  setColorForPerson(userId, personId, color) {
    const map = this.getColorMap(userId);
    map[personId] = color;
    writeJSON(`fc_colors_${userId}`, map);
  },
  colorFor(userId, personId) {
    const map = this.getColorMap(userId);
    if (map[personId]) return map[personId];
    const person = this.getPerson(personId);
    return person ? person.defaultColor : '#888787';
  },

  // ---- per-user, per-event custom color (like the person color map above,
  // but for a specific event) -- deliberately local/per-device rather than a
  // field on the event doc itself, so setting a custom color on a shared
  // event only changes how it looks on your own calendar. Anyone else who
  // can edit the event is free to pick their own color for it too, without
  // overwriting or being overwritten by yours. ----
  getEventColorMap(userId) {
    return readJSON(`fc_eventcolors_${userId}`, {});
  },
  setEventColor(userId, eventId, color) {
    const map = this.getEventColorMap(userId);
    if (color) map[eventId] = color; else delete map[eventId];
    writeJSON(`fc_eventcolors_${userId}`, map);
  },
  eventColorFor(userId, eventId) {
    return this.getEventColorMap(userId)[eventId] || null;
  },

  // ---- per-device theme ----
  getTheme() {
    return readJSON('fc_theme', { font: 'Inter', bgColor: null, bgPhoto: null, bgFit: 'fit', bgAutoColor: null, bgBorderColor: null, bgThroughGrid: false, textColor: null, accent: '#71816C', colorMode: 'light' });
  },
  saveTheme(theme) {
    writeJSON('fc_theme', theme);
  },

  // ---- per-device month background overrides (keyed by month index 0-11, repeats yearly) ----
  getMonthThemes() {
    return readJSON('fc_monthThemes', {});
  },
  getMonthTheme(monthIndex) {
    return this.getMonthThemes()[monthIndex] || null;
  },
  setMonthTheme(monthIndex, theme) {
    const themes = this.getMonthThemes();
    if (theme) themes[monthIndex] = theme;
    else delete themes[monthIndex];
    writeJSON('fc_monthThemes', themes);
  },

  // ---- per-device planner background overrides (keyed by month index 0-11,
  // same as month themes -- planner falls back to the month theme, then the
  // global default, whenever no planner-specific override is saved) ----
  getPlannerMonthThemes() {
    return readJSON('fc_plannerMonthThemes', {});
  },
  getPlannerMonthTheme(monthIndex) {
    return this.getPlannerMonthThemes()[monthIndex] || null;
  },
  setPlannerMonthTheme(monthIndex, theme) {
    const themes = this.getPlannerMonthThemes();
    if (theme) themes[monthIndex] = theme;
    else delete themes[monthIndex];
    writeJSON('fc_plannerMonthThemes', themes);
  },

  // ---- todos/notes: synced via Firestore (like events), not localStorage,
  // specifically so "Share with specific people" can actually reach another
  // person's device -- the old per-device version could only ever "share"
  // within the same browser. getNotes() already returns exactly what's
  // visible to the signed-in user (own + shared-with-me), same shape as
  // getEvents(). ----
  getNotes() {
    return _cache.notes;
  },
  addNote(note) {
    const id = note.id || uid();
    const visibleTo = Array.from(new Set([note.ownerId, ...(note.sharedWith || [])]));
    const full = { ...note, id, visibleTo };
    _cache.notes.push(full);
    firebase.firestore().collection('notes').doc(id).set(full);
  },
  updateNote(id, patch) {
    const idx = _cache.notes.findIndex(n => n.id === id);
    if (idx < 0) return;
    const merged = { ..._cache.notes[idx], ...patch };
    if ('sharedWith' in patch || 'ownerId' in patch) {
      merged.visibleTo = Array.from(new Set([merged.ownerId, ...(merged.sharedWith || [])]));
    }
    _cache.notes[idx] = merged;
    firebase.firestore().collection('notes').doc(id).set(merged);
  },
  deleteNote(id) {
    _cache.notes = _cache.notes.filter(n => n.id !== id);
    firebase.firestore().collection('notes').doc(id).delete();
  },
  // One-time: carries over whatever was in this device's old local-only
  // todos storage (from before notes synced via Firestore) into the real
  // collection, so shipping this change doesn't wipe out lists/notes people
  // already had. The migrated flag is only set once the writes actually
  // succeed -- addNote's Firestore write is fire-and-forget, so this awaits
  // them directly rather than trusting the optimistic local cache push. If
  // it fails (e.g. the Firestore rules for the new `notes` collection
  // haven't been deployed yet), the flag stays unset and it safely retries
  // next load instead of silently orphaning those notes forever. addNote's
  // .set() (not .add()) also makes a retry harmless either way -- same ids
  // just get overwritten with the same data, never duplicated.
  async migrateLocalNotesIfNeeded(userId) {
    if (localStorage.getItem(`fc_notesMigrated_${userId}`) === '1') return;
    const local = readJSON(`fc_todos_${userId}`, []);
    if (!local.length) { localStorage.setItem(`fc_notesMigrated_${userId}`, '1'); return; }
    try {
      await Promise.all(local.map(n => {
        const note = { ...n, ownerId: n.ownerId || userId };
        const id = note.id || uid();
        const visibleTo = Array.from(new Set([note.ownerId, ...(note.sharedWith || [])]));
        const full = { ...note, id, visibleTo };
        if (!_cache.notes.some(existing => existing.id === id)) _cache.notes.push(full);
        return firebase.firestore().collection('notes').doc(id).set(full);
      }));
      localStorage.setItem(`fc_notesMigrated_${userId}`, '1');
    } catch (err) {
      console.warn('Note migration failed, will retry next load:', err.code);
    }
  },
  getShowChecked(userId) {
    return localStorage.getItem(`fc_showchecked_${userId}`) === '1';
  },
  setShowChecked(userId, val) {
    localStorage.setItem(`fc_showchecked_${userId}`, val ? '1' : '0');
  },

  // ---- birthdays (local to this device, private to you -- see
  // calendar.js's birthdayHolidayStub for how tapping one on the calendar
  // can still share a single year's occurrence as a real event) ----
  getBirthdays(userId) {
    return readJSON(`fc_birthdays_${userId}`, []);
  },
  saveBirthdays(userId, list) {
    writeJSON(`fc_birthdays_${userId}`, list);
  },
  // Gift ideas/wish list notes stick to the birthday itself, not any one
  // year's event -- carries forward every year, and stays private even if
  // that year's occurrence gets shared with other participants, since it's
  // never written anywhere but this local birthday record.
  setBirthdayGiftIdeas(userId, birthdayId, text) {
    this.saveBirthdays(userId, this.getBirthdays(userId).map(b =>
      b.id === birthdayId ? { ...b, giftIdeas: text || null } : b
    ));
  },

  // ---- event presets (title -> {time, endTime, category}, saved right from
  // the event modal; typing a matching title on a new event auto-fills the rest) ----
  getEventPresets(userId) {
    return readJSON(`fc_eventPresets_${userId}`, []);
  },
  saveEventPresets(userId, list) {
    writeJSON(`fc_eventPresets_${userId}`, list);
  },

  // ---- holidays (a personal display preference, not shared data -- just
  // which of the built-in holiday defs this user wants shown on their own calendar) ----
  getEnabledHolidays(userId) {
    return readJSON(`fc_holidays_${userId}`, []);
  },
  saveEnabledHolidays(userId, ids) {
    writeJSON(`fc_holidays_${userId}`, ids);
  },
  getHolidayColor(userId) {
    return localStorage.getItem(`fc_holidayColor_${userId}`) || null;
  },
  saveHolidayColor(userId, color) {
    localStorage.setItem(`fc_holidayColor_${userId}`, color);
  },
  getDefaultBirthdayColor(userId) {
    return localStorage.getItem(`fc_defaultBirthdayColor_${userId}`) || null;
  },
  saveDefaultBirthdayColor(userId, color) {
    localStorage.setItem(`fc_defaultBirthdayColor_${userId}`, color);
  },
};

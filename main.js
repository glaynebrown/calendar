function openModal(bodyHTML, wireFn) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal-sheet">${bodyHTML}</div></div>`;
  applyIcons(root);
  root.querySelector('#modal-backdrop').addEventListener('click', e => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
  if (wireFn) wireFn(root);
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

const App = {
  activeTab: 'calendar-tab',

  init() {
    applyIcons(document);
    applyTheme(Store.getTheme());

    // Shown immediately (not waiting on anything async) so there's never a
    // gap where the empty app shell peeks through -- firebase.auth()'s
    // onAuthStateChanged below always fires asynchronously, even with an
    // already-cached session, so without this the bare page (header/nav
    // with an empty calendar grid) would flash briefly on every load before
    // either the sign-in screen or the loaded calendar takes over.
    document.getElementById('loading-screen').classList.remove('hidden');

    this.pendingInviteCode = new URLSearchParams(location.search).get('invite') || null;

    // Registered unconditionally (not gated on notifications actually being
    // enabled) -- the service worker only does anything once a push arrives,
    // and it needs to be registered before Settings' "Enable notifications"
    // toggle can request a token for it.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('firebase-messaging-sw.js').catch(err => {
        console.warn('Service worker registration failed:', err);
      });
    }

    // firebase-messaging-sw.js's onBackgroundMessage only fires while the app
    // is closed or backgrounded -- a push arriving while it's open in the
    // foreground goes nowhere unless something's listening for it here too.
    // Guarded top to bottom: this must never be able to throw and take the
    // rest of init() down with it (a real bug once did exactly that). Note:
    // firebase.messaging.isSupported() in the *compat* SDK (what this whole
    // project uses) returns a plain boolean, not a Promise -- that's a real
    // difference from the newer modular SDK's isSupported(), and calling
    // .then() on it is exactly what broke this the first time.
    try {
      if ('Notification' in window && typeof firebase !== 'undefined'
        && typeof firebase.messaging === 'function' && typeof firebase.messaging.isSupported === 'function'
        && firebase.messaging.isSupported()) {
        firebase.messaging().onMessage(payload => {
          const { title, body } = (payload && payload.notification) || {};
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title || 'Family Calendar', { body: body || '', icon: 'icon-192.png' });
          });
        });
      }
    } catch (err) {
      console.warn('Foreground notification setup failed:', err);
    }

    document.querySelectorAll('.bottom-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    document.getElementById('fab').addEventListener('click', () => {
      if (this.activeTab === 'calendar-tab') {
        Calendar.openEventModal(null, formatISO(new Date()));
      } else {
        Todo.openCreateChoiceModal();
      }
    });

    Settings.init();

    // Firebase persists the session itself -- this fires once immediately
    // with whatever's already signed in (or null), then again on every
    // future sign-in/sign-out, so it's the single source of truth for
    // whether to show the sign-in screen or the app.
    firebase.auth().onAuthStateChanged(user => {
      if (user) this.onSignedIn(user);
      else this.renderSignIn();
    });
  },

  async onSignedIn(user) {
    document.getElementById('whoami-screen').classList.add('hidden');
    document.getElementById('loading-screen').classList.remove('hidden');
    await Store.startSync(user.uid);
    document.getElementById('loading-screen').classList.add('hidden');
    Store.onDataChange(() => {
      if (this.activeTab === 'calendar-tab') Calendar.render();
      else Todo.render();
    });
    // Accounts created before the reminders feature existed don't have a
    // timezone field yet (it's only set at signup) -- self-heals here so
    // reminder scheduling works for them without a manual data fix.
    const me = Store.getAccount(user.uid);
    if (me && !me.timezone) {
      Store.updateAccount(user.uid, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    }
    Store.reconcileHouseholdTies(user.uid);
    this.startApp();
    this.maybeHandleInvite();
  },

  renderSignIn() {
    Store.stopSync();
    document.getElementById('loading-screen').classList.add('hidden');
    const screen = document.getElementById('whoami-screen');
    screen.classList.remove('hidden');
    const nameInput = document.getElementById('signin-name');
    const emailInput = document.getElementById('signin-email');
    const passwordInput = document.getElementById('signin-password');
    const errorEl = document.getElementById('signin-error');
    const continueBtn = document.getElementById('signin-continue');
    // Every time this screen is (re-)shown, make sure it's actually usable --
    // the button is left disabled after a successful sign-in (the screen is
    // expected to get hidden right after), which would otherwise stick if
    // onAuthStateChanged ever bounces back to null and re-shows this same
    // screen (e.g. the account got deleted, or a session became invalid).
    errorEl.textContent = '';
    continueBtn.disabled = false;
    // onAuthStateChanged can in principle fire with a null user more than
    // once in the same page load (e.g. sign-out without a reload in between),
    // and this re-queries the same static form elements each time rather
    // than recreating them -- so guard against attaching a second listener,
    // which would otherwise double-fire the whole sign-in flow on click.
    if (continueBtn.dataset.wired) return;
    continueBtn.dataset.wired = '1';

    const AUTH_ERROR_MESSAGES = {
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/invalid-email': 'Enter a valid email.',
      'auth/wrong-password': 'Incorrect password for that email.',
      'auth/invalid-credential': 'Incorrect password for that email.',
      'auth/too-many-requests': 'Too many attempts -- wait a bit and try again.',
    };

    continueBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      errorEl.textContent = '';
      if (!email || !email.includes('@')) {
        errorEl.textContent = 'Enter a valid email.';
        return;
      }
      if (!password || password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters.';
        return;
      }
      continueBtn.disabled = true;
      try {
        let cred;
        try {
          cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
          if (!name) {
            errorEl.textContent = 'Enter your name to create an account.';
            await cred.user.delete();
            continueBtn.disabled = false;
            return;
          }
          await Store.createAccountDoc(cred.user.uid, name, email);
        } catch (err) {
          if (err.code !== 'auth/email-already-in-use') throw err;
          cred = await firebase.auth().signInWithEmailAndPassword(email, password);
          const accountDoc = await firebase.firestore().collection('accounts').doc(cred.user.uid).get();
          const existingName = accountDoc.exists ? accountDoc.data().name : null;
          if (name && existingName && name !== existingName) Store.updateAccount(cred.user.uid, { name });
        }
        // onAuthStateChanged picks up from here.
      } catch (err) {
        errorEl.textContent = AUTH_ERROR_MESSAGES[err.code] || err.message;
        continueBtn.disabled = false;
      }
    });
  },

  async maybeHandleInvite() {
    if (!this.pendingInviteCode) return;
    const code = this.pendingInviteCode;
    this.pendingInviteCode = null;
    const url = new URL(location.href);
    url.searchParams.delete('invite');
    history.replaceState({}, '', url);

    const invite = await Store.resolveInvite(code);
    const userId = Store.getCurrentUserId();
    if (!invite) {
      openModal(`
        <div class="modal-header"><h2>Invite link expired</h2><button class="modal-close" id="inv-close">${icon('x')}</button></div>
        <p class="muted">This invite link is no longer valid. Ask for a new one.</p>
      `, root => root.querySelector('#inv-close').addEventListener('click', closeModal));
      return;
    }
    if (invite.ownerId === userId) return;

    let description = '';
    if (invite.type === 'individual_connect') {
      description = `${Store.getAccount(invite.ownerId).name} wants to connect with you.`;
    } else if (invite.type === 'household_member' || invite.type === 'household_connect') {
      const h = Store.getHouseholds().find(h => h.id === invite.householdId);
      description = `Join the household "${h ? h.name : ''}"? You'll be able to see everyone's calendar, and they'll see yours.`;
    }

    openModal(`
      <div class="modal-header"><h2>Invite</h2><button class="modal-close" id="inv-close">${icon('x')}</button></div>
      <p>${description}</p>
      <div class="btn-row">
        <button class="btn" id="inv-decline">Decline</button>
        <button class="btn btn-primary" id="inv-accept">Accept</button>
      </div>
    `, root => {
      root.querySelector('#inv-close').addEventListener('click', closeModal);
      root.querySelector('#inv-decline').addEventListener('click', closeModal);
      root.querySelector('#inv-accept').addEventListener('click', async () => {
        await Store.acceptInvite(code, userId);
        closeModal();
        Calendar.render();
      });
    });
  },

  startApp() {
    Calendar.init();
    Todo.init();
  },

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== tabId));
    document.querySelectorAll('.bottom-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

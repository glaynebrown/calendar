/* Service worker: handles a push notification arriving while the app isn't
   focused (or isn't open at all). Runs outside the page, so it can't use the
   compat <script> tags from index.html -- importScripts() is the service
   worker equivalent, keeping this build-step-free like everything else.

   Also keeps a copy of the app's own files (index.html, CSS, JS, icons, the
   Firebase SDK, fonts) so the app can open with no internet. The *data* side
   of offline is Firestore's own persistence (see firebase-config.js) -- this
   file only covers the files the page needs to start at all. It lives here
   rather than in a second service worker because a page scope can only have
   one, and push (settings.js's getToken) is already tied to this one. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

/* Same values as firebase-config.js -- duplicated because a service worker
   can't share scope/variables with the page, and can't import a script that
   itself calls firebase.firestore() (which isn't needed or loaded here). */
firebase.initializeApp({
  apiKey: 'AIzaSyA3QdD4M6PI0vsEbDVXe3DIreFocfsnlIQ',
  authDomain: 'calendar-15c84.firebaseapp.com',
  projectId: 'calendar-15c84',
  storageBucket: 'calendar-15c84.firebasestorage.app',
  messagingSenderId: '155401581004',
  appId: '1:155401581004:web:889b44e7316e220ae5ed69',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Family Calendar', {
    body: body || '',
    icon: 'icon-192.png',
    badge: 'favicon-32.png',
  });
});

/* ---- Offline app files ----
   Strategy, chosen so the manual ?v=NNN release routine needs NO extra step:
   - index.html: network first. Online, you always get the latest page (and
     through it the latest ?v= file URLs), exactly like before. Offline or
     on a very slow connection, the last saved copy is used instead.
   - Everything else: serve the saved copy instantly, then quietly refresh it
     in the background. A ?v= bump is a brand-new URL, so it's never served
     stale; old ?v= copies are deleted once the new one is saved.
   Firestore/Auth network traffic is never touched -- only GET requests for
   this site's own files, the Firebase SDK scripts, and Google Fonts. */
const CACHE_NAME = 'fc-offline-v1';
const INDEX_URL = new URL('index.html', self.registration.scope).href;
const SCOPE_PATH = new URL(self.registration.scope).pathname;
// How long a page load waits on the network before falling back to the saved
// copy -- long enough for a normal connection, short enough that one bar of
// signal doesn't leave the app on a blank screen.
const NETWORK_TIMEOUT_MS = 4000;

function isCacheable(href) {
  const u = new URL(href);
  if (u.origin === self.location.origin) {
    return href.startsWith(self.registration.scope) && !u.pathname.endsWith('firebase-messaging-sw.js');
  }
  return (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/'))
    || u.hostname === 'fonts.googleapis.com'
    || u.hostname === 'fonts.gstatic.com';
}

// Script/stylesheet tags without crossorigin="" fetch cross-origin files as
// "opaque" responses (status 0) -- still perfectly usable by the page, so
// they're worth saving too.
function isSaveable(res) {
  return res && (res.ok || res.type === 'opaque');
}

// After saving e.g. calendar.js?v=293, drop calendar.js?v=292 so old
// releases don't pile up in storage forever.
async function deleteOtherVersions(cache, href) {
  const u = new URL(href);
  if (u.origin !== self.location.origin || !u.searchParams.has('v')) return;
  const keys = await cache.keys();
  await Promise.all(keys.map(req => {
    const k = new URL(req.url);
    return (k.pathname === u.pathname && k.search !== u.search) ? cache.delete(req) : null;
  }));
}

async function save(cache, request, res) {
  await cache.put(request, res);
  await deleteOtherVersions(cache, typeof request === 'string' ? request : request.url);
}

// On install, save index.html plus every file it references, so the very
// next launch works offline -- not just after each file has happened to be
// requested once. Failures are swallowed: installing offline (or with one
// file briefly unreachable) must never block push notifications from working.
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const res = await fetch(INDEX_URL, { cache: 'no-cache' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put(INDEX_URL, res);
    const urls = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
      .map(m => new URL(m[1].replace(/&amp;/g, '&'), INDEX_URL).href)
      .filter(isCacheable);
    await Promise.all(urls.map(async href => {
      const sameOrigin = new URL(href).origin === self.location.origin;
      const fileRes = await fetch(new Request(href, { mode: sameOrigin ? 'same-origin' : 'no-cors' }));
      if (isSaveable(fileRes)) await save(cache, href, fileRes);
    }).map(p => p.catch(() => {})));
  })().catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('fc-offline-') && n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirstPage(event) {
  const cache = await caches.open(CACHE_NAME);
  const network = fetch(event.request).then(async res => {
    if (res.ok && !res.redirected) await cache.put(INDEX_URL, res.clone());
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;
  const saved = await cache.match(INDEX_URL);
  // Nothing saved yet (e.g. first-ever launch on a slow connection) -- keep
  // waiting on the network rather than failing.
  return saved || network;
}

async function savedThenRefresh(event) {
  const cache = await caches.open(CACHE_NAME);
  const saved = await cache.match(event.request, { ignoreVary: true });
  const network = fetch(event.request).then(async res => {
    if (isSaveable(res)) await save(cache, event.request, res.clone());
    return res;
  });
  if (saved) {
    event.waitUntil(network.catch(() => {}));
    return saved;
  }
  return network;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    // Only the app's own page (with or without ?invite=...) -- anything else
    // is left to the browser untouched.
    if (url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html') {
      event.respondWith(networkFirstPage(event));
    }
    return;
  }
  if (isCacheable(req.url)) event.respondWith(savedThenRefresh(event));
});

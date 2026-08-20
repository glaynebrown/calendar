/* Service worker: handles a push notification arriving while the app isn't
   focused (or isn't open at all). Runs outside the page, so it can't use the
   compat <script> tags from index.html -- importScripts() is the service
   worker equivalent, keeping this build-step-free like everything else. */
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

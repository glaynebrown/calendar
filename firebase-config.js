/* Firebase project config -- paste your own values in below from:
   Firebase Console -> Project settings -> General -> "Your apps" -> Web app.
   This object is meant to be public/client-side; it just tells the SDK which
   project to talk to. Firestore Security Rules (firestore.rules) are what
   actually protect the data, not keeping this secret. */
const firebaseConfig = {
  apiKey: 'AIzaSyA3QdD4M6PI0vsEbDVXe3DIreFocfsnlIQ',
  authDomain: 'calendar-15c84.firebaseapp.com',
  projectId: 'calendar-15c84',
  storageBucket: 'calendar-15c84.firebasestorage.app',
  messagingSenderId: '155401581004',
  appId: '1:155401581004:web:889b44e7316e220ae5ed69',
};

// Web Push certificate (VAPID public key) for Cloud Messaging -- from
// Firebase Console -> Project settings -> Cloud Messaging -> Web configuration.
// Public/client-side by design, same as the rest of this file.
const VAPID_KEY = 'BAkw0-WB-s93box6mm05B79708tKwtdZ7xR-9gNuivmbPM1fwzb9jxzreyjdxOoYVbWZsHhfbjJu3SeHQpmevcQ';

firebase.initializeApp(firebaseConfig);

firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(err => {
  // Fails in some browsers/tabs (e.g. multiple tabs without synchronizeTabs
  // support, or private browsing). The app still works online without it --
  // it just loses the offline queue/cache benefit.
  console.warn('Firestore offline persistence unavailable:', err.code);
});

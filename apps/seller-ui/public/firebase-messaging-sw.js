/* global importScripts, firebase */
/**
 * Firebase Cloud Messaging service worker. Must be served from the site root: FCM
 * registers it with scope '/', and a worker can only control paths at or below its own.
 *
 * A static file cannot read the app's environment, so the (public) Firebase web config
 * arrives in this script's own URL — see serviceWorkerUrl() in src/lib/push.ts.
 *
 * The compat builds are pinned to the `firebase` version in package.json. Bump them
 * together.
 */
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;

firebase.initializeApp({
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
});

const messaging = firebase.messaging();

// Pushes from notification-service carry a `notification` block and a
// webpush.fcmOptions.link, so the SDK already displays them and opens the link on click.
// Calling showNotification here as well would show every push twice — this only logs.
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw] background message', payload?.data?.notificationId);
});

// Push notifications on the customer's phone.
//
// Real mode (Firebase configured): asks permission, registers /firebase-messaging-sw.js,
// gets an FCM token with the Firebase web SDK (loaded from gstatic) and stores it on the server.
// Mock mode (no Firebase keys, development): registers a fake device so the server-side
// push → SMS fallback flow can be tried; the alert itself appears in /dev/notifications.
import { post } from './api.js';

export const pushSupported = () => 'Notification' in window && 'serviceWorker' in navigator;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  } catch {
    return null;
  }
}

/**
 * @returns {'enabled' | 'denied' | 'unsupported'}
 */
export async function enablePush({ config, vapidKey, sdkVersion }) {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await registerServiceWorker();
  if (!config) {
    await post('/push/tokens/mock');
    return 'enabled';
  }

  const base = `https://www.gstatic.com/firebasejs/${sdkVersion}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const { getMessaging, getToken, onMessage } = await import(`${base}/firebase-messaging.js`);
  const app = initializeApp(config);
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) return 'denied';
  await post('/push/tokens', { token });
  // While the page is open, Firebase hands messages to the page instead of showing them;
  // the tracker already reacts to the live state, so nothing else is needed here.
  onMessage(messaging, () => {});
  return 'enabled';
}

/** Shows a local notification (used when the tracker tab is in the background). */
export async function showLocalNotification(title, body, link) {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.getRegistration();
  registration?.showNotification(title, {
    body,
    dir: 'rtl',
    lang: 'ar',
    tag: 'your-turn',
    renotify: true,
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 900],
    data: { local: true, link },
  });
}

// Firebase push: the service worker script and device token registration.
import { env } from '../config/env.js';
import * as notifications from '../services/notification.service.js';
import { firebaseWebConfig } from '../integrations/push/index.js';
import { parse } from '../middleware/validate.js';
import * as v from '../validators/customer.validators.js';
import { randomToken } from '../utils/codes.js';

/**
 * Service worker served at the site root (it must control "/" to receive pushes).
 * It shows the notification when the page is closed and opens the tracker on click.
 * With real FCM it loads the Firebase compat SDK; in mock mode it only handles clicks.
 */
export function serviceWorker(req, res) {
  const config = firebaseWebConfig();
  const v = env.FIREBASE_WEB_SDK_VERSION;
  const firebasePart = config
    ? `
importScripts('https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/${v}/firebase-messaging-compat.js');
firebase.initializeApp(${JSON.stringify(config)});
// Notifications with a "notification" payload are shown by Firebase automatically.
firebase.messaging();`
    : '// Push provider is in development mock mode — no Firebase SDK loaded.';

  // Firebase opens its own notifications' links (fcmOptions.link). This handler only covers
  // notifications the tracker page shows itself while it is in a background tab.
  res.type('application/javascript').set('Cache-Control', 'no-cache').send(`${firebasePart}
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  if (!data.local) return;
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) if (client.url.includes(data.link) && 'focus' in client) return client.focus();
    return clients.openWindow(data.link || '/me');
  }));
});
`);
}

/** Stores the device's FCM token for the logged-in customer. */
export async function register(req, res) {
  const { token } = parse(v.pushToken, req.body);
  await notifications.registerPushToken(req.user.id, token, req.get('user-agent'));
  res.json({ ok: true });
}

/** Mock mode: register a fake token so the push → SMS fallback logic can be exercised locally. */
export async function registerMock(req, res) {
  if (env.pushProvider !== 'mock') return res.status(404).json({ error: { message: 'not available' } });
  await notifications.registerPushToken(req.user.id, `mock-device-${randomToken(12)}`, req.get('user-agent'));
  res.json({ ok: true, mock: true });
}

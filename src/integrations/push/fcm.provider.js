// Firebase Cloud Messaging (web push) via the official firebase-admin SDK.
// Alerts are sent as high-urgency web notifications that stay on screen
// (requireInteraction) and vibrate, so the customer notices them even when the page is closed.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../../config/env.js';

function messaging() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getMessaging();
}

// Errors that mean the token will never work again (app uninstalled, permission revoked…).
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export const fcmPushProvider = {
  name: 'fcm',
  async send({ token, title, body, link, tag }) {
    try {
      const messageId = await messaging().send({
        token,
        data: { title, body, link: link ?? '', tag: tag ?? '' },
        webpush: {
          headers: { Urgency: 'high', TTL: '900' },
          notification: {
            title,
            body,
            icon: '/images/icon-192.png',
            badge: '/images/badge-72.png',
            dir: 'rtl',
            lang: 'ar',
            tag,
            renotify: true,
            requireInteraction: true,
            vibrate: [500, 200, 500, 200, 900],
          },
          fcmOptions: link ? { link } : undefined,
        },
      });
      return { ok: true, messageId };
    } catch (err) {
      return { ok: false, error: err.message, invalidToken: DEAD_TOKEN_CODES.has(err.code) };
    }
  },
};

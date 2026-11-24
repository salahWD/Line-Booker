// Push provider factory. Every provider implements:
//   send({ token, title, body, link, tag }) → Promise<{ ok, messageId?, error?, invalidToken? }>
import { env } from '../../config/env.js';
import { mockPushProvider } from './mock.provider.js';
import { fcmPushProvider } from './fcm.provider.js';

export function getPushProvider() {
  return env.pushProvider === 'fcm' ? fcmPushProvider : mockPushProvider;
}

/** Public Firebase web config for the browser (null when push runs in mock mode). */
export function firebaseWebConfig() {
  if (env.pushProvider !== 'fcm') return null;
  return {
    apiKey: env.FIREBASE_WEB_API_KEY,
    authDomain: env.FIREBASE_WEB_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    messagingSenderId: env.FIREBASE_WEB_MESSAGING_SENDER_ID,
    appId: env.FIREBASE_WEB_APP_ID,
  };
}

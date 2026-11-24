// ⚠️ DEVELOPMENT MOCK — NO PUSH NOTIFICATION IS SENT.
// Used when FIREBASE_PROJECT_ID is empty. Logs the alert and keeps it in the dev inbox.
import { addToDevInbox } from '../dev-inbox.js';

export const mockPushProvider = {
  name: 'mock',
  async send({ token, title, body, link }) {
    console.log(
      `\n┌─────────────── [MOCK PUSH – NOT SENT] ──────────────\n│ Token: ${token.slice(0, 24)}…\n│ ${title}\n│ ${body}\n│ ${link ?? ''}\n└──────────────────────────────────────────────────────\n`,
    );
    addToDevInbox({ channel: 'push', to: `${token.slice(0, 16)}…`, body: `${title} — ${body}`, link });
    return { ok: true, messageId: `mock-push-${Date.now()}` };
  },
};

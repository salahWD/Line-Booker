// ⚠️ DEVELOPMENT MOCK — NO SMS IS SENT.
// Prints the message to the console and keeps it in the dev inbox (/dev/notifications).
import { addToDevInbox } from '../dev-inbox.js';

let counter = 0;

export const mockSmsProvider = {
  name: 'mock',
  async send({ to, body }) {
    counter += 1;
    const id = `mock-sms-${Date.now()}-${counter}`;
    console.log(
      `\n┌─────────────── [MOCK SMS – NOT SENT] ───────────────\n│ To:   ${to}\n│ Text: ${body}\n└──────────────────────────────────────────────────────\n`,
    );
    addToDevInbox({ channel: 'sms', to, body, id });
    // The mock "delivers" instantly so delivery tracking can be seen working.
    return { providerMessageId: id, delivered: true };
  },
};

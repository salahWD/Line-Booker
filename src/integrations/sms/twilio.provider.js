// Twilio SMS adapter (REST API, no SDK). Implemented from Twilio's public docs:
// POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
// NOTE: not tested against a live Twilio account — verify before going to production.
import { env } from '../../config/env.js';

export const twilioSmsProvider = {
  name: 'twilio',
  async send({ to, body }) {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = env;
    if (!sid || !token || !from) throw new Error('Twilio is not configured (TWILIO_* env vars).');

    const form = new URLSearchParams({
      To: to,
      From: from,
      Body: body,
      // Twilio calls this URL with delivery status updates (see routes/webhooks.routes.js).
      StatusCallback: `${env.APP_URL}/webhooks/sms/twilio?secret=${encodeURIComponent(env.SMS_WEBHOOK_SECRET)}`,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Twilio ${response.status}: ${data.message ?? 'request failed'}`);
    return { providerMessageId: data.sid, delivered: false };
  },

  /** Maps a Twilio status callback to our notification status. */
  mapStatus(twilioStatus) {
    if (twilioStatus === 'delivered') return 'delivered';
    if (['failed', 'undelivered'].includes(twilioStatus)) return 'failed';
    if (['sent', 'queued', 'sending', 'accepted'].includes(twilioStatus)) return 'sent';
    return null;
  },
};

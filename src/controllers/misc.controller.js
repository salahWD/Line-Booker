// Development inbox (mock SMS/push) and SMS provider webhooks.
import { env } from '../config/env.js';
import { readDevInbox } from '../integrations/dev-inbox.js';
import { twilioSmsProvider } from '../integrations/sms/twilio.provider.js';
import * as notifications from '../services/notification.service.js';
import { notFound } from '../utils/errors.js';
import { t } from '../locales/ar.js';

/** DEVELOPMENT ONLY: shows the messages the mock providers "sent" (including OTP codes). */
export function devInbox(req, res) {
  if (env.isProduction) throw notFound();
  res.render('pages/dev/notifications', { title: t('dev.title'), messages: readDevInbox() });
}

export function devInboxJson(req, res) {
  if (env.isProduction) throw notFound();
  res.json({ messages: readDevInbox().slice(0, 20) });
}

/** Twilio delivery-status callback. Authenticated with ?secret=SMS_WEBHOOK_SECRET. */
export async function twilioStatus(req, res) {
  if (req.query.secret !== env.SMS_WEBHOOK_SECRET) return res.status(403).end();
  const { MessageSid, MessageStatus, ErrorCode } = req.body ?? {};
  if (MessageSid) {
    await notifications.recordDeliveryStatus(MessageSid, twilioSmsProvider.mapStatus(MessageStatus), ErrorCode ? `Twilio error ${ErrorCode}` : null);
  }
  res.status(204).end();
}

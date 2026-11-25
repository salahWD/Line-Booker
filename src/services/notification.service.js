// Notifications (SMS + push) using the "outbox" pattern:
//
//   1. Inside the business transaction we INSERT a row into `notifications` (status queued).
//      If the transaction rolls back, no message is ever sent.
//   2. Right after commit the row is sent in the background (the request does not wait).
//   3. The provider adapter sends it and we record sent/delivered/failed. A failed attempt
//      gets a retry time (`nextAttemptAt`, with backoff) and the job sweep (every 15 s)
//      tries again. Push that cannot be delivered falls back to SMS.
//   4. The sweep also picks up rows whose sender died mid-send (e.g. the app restarted).
import { env } from '../config/env.js';
import { t } from '../locales/ar.js';
import * as notificationModel from '../models/notification.model.js';
import * as userModel from '../models/user.model.js';
import { getSmsProvider } from '../integrations/sms/index.js';
import { getPushProvider } from '../integrations/push/index.js';
import { logger } from '../utils/logger.js';

const MAX_ATTEMPTS = 5; // 1 try + 4 retries
/** Wait before the next try after attempt 1, 2, 3, 4: 15 s, 30 s, 60 s, 120 s. */
const retryDelayMs = (attempts) => 15_000 * 2 ** Math.max(0, attempts - 1);

/** Absolute link for SMS / push. */
export const absoluteUrl = (path) => `${env.APP_URL}${path}`;

/** Message text from the locale file with the app name filled in. */
export const message = (key, vars) => t(`sms.${key}`, { app: env.APP_NAME, ...vars });

/** Sends in the background; a failure is logged and retried later by the job sweep. */
function sendSoon(id) {
  setImmediate(() => {
    sendNotification(id).catch((err) => logger.error(`Notification ${id} could not be sent`, err));
  });
}

function scheduleSend(tx, id) {
  tx.afterCommit(() => sendSoon(id));
}

/**
 * Queues an SMS.
 * @param {object} tx   current transaction
 * @param {object} msg  { to, body, kind, secretBody?, userId?, appointmentId?, ticketId? }
 */
export async function queueSms(tx, { to, body, kind, secretBody, userId, appointmentId, ticketId }) {
  if (!to) return null;
  const row = await notificationModel.create(
    { channel: 'sms', kind, toPhone: to, body, secretBody, userId, appointmentId, ticketId },
    tx,
  );
  scheduleSend(tx, row.id);
  return row;
}

/**
 * Notifies a customer on their phone: push if they enabled it on a device, otherwise SMS.
 * If push fails on every device, the SMS is sent instead.
 */
export async function notifyCustomer(tx, { userId, phone, kind, title, body, link, appointmentId, ticketId }) {
  const tokens = userId ? await notificationModel.activePushTokens(userId, tx) : [];
  if (!phone && userId) phone = (await userModel.findById(userId, tx))?.phone;

  if (tokens.length) {
    const row = await notificationModel.create(
      { channel: 'push', kind, userId, title, body, link, fallbackPhone: phone, appointmentId, ticketId },
      tx,
    );
    scheduleSend(tx, row.id);
    return row;
  }
  return queueSms(tx, { to: phone, body, kind, userId, appointmentId, ticketId });
}

/**
 * Sends one queued notification (right after commit, or later by the job sweep).
 * Safe to call twice: only the caller that claims the row sends it.
 */
export async function sendNotification(id) {
  const row = await notificationModel.claimForSending(id);
  if (!row) return; // already sent, or being sent by another worker

  try {
    if (row.channel === 'sms') {
      const provider = getSmsProvider();
      const result = await provider.send({ to: row.toPhone, body: row.secretBody ?? row.body });
      await notificationModel.update(row.id, {
        status: result.delivered ? 'delivered' : 'sent',
        provider: provider.name,
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
        deliveredAt: result.delivered ? new Date() : null,
        secretBody: null, // never keep OTP text once it has been handed over
        lastError: null,
        nextAttemptAt: null,
      });
      return;
    }

    // Push: send to every active device of the customer.
    const provider = getPushProvider();
    const tokens = await notificationModel.activePushTokens(row.userId);
    let delivered = 0;
    const errors = [];
    for (const tokenRow of tokens) {
      const result = await provider.send({
        token: tokenRow.token,
        title: row.title ?? env.APP_NAME,
        body: row.body,
        link: row.link,
        tag: row.ticketId ? `ticket-${row.ticketId}` : `n-${row.id}`,
      });
      if (result.ok) delivered += 1;
      else {
        errors.push(result.error);
        if (result.invalidToken) await notificationModel.revokePushToken(tokenRow.token);
      }
    }

    if (delivered > 0) {
      await notificationModel.update(row.id, { status: 'sent', provider: provider.name, sentAt: new Date(), lastError: null, nextAttemptAt: null });
      return;
    }

    // No device accepted the push → fall back to SMS right away (no point retrying dead tokens).
    await notificationModel.update(row.id, {
      status: 'failed',
      provider: provider.name,
      failedAt: new Date(),
      nextAttemptAt: null,
      lastError: errors.join(' | ') || 'no active push tokens',
    });
    if (row.fallbackPhone) await sendSmsFallback(row);
  } catch (err) {
    const finalAttempt = row.attempts >= MAX_ATTEMPTS;
    await notificationModel.update(row.id, {
      status: finalAttempt ? 'failed' : 'queued',
      lastError: err.message,
      failedAt: finalAttempt ? new Date() : null,
      nextAttemptAt: finalAttempt ? null : new Date(Date.now() + retryDelayMs(row.attempts)),
    });
    if (finalAttempt) {
      logger.error(`Notification ${row.id} failed permanently`, err);
      if (row.channel === 'push' && row.fallbackPhone) await sendSmsFallback(row);
      return;
    }
    logger.warn(`Notification ${row.id} attempt ${row.attempts} failed, will retry: ${err.message}`);
  }
}

async function sendSmsFallback(pushRow) {
  const text = pushRow.link ? `${pushRow.body} ${pushRow.link}` : pushRow.body;
  const row = await notificationModel.create({
    channel: 'sms',
    kind: pushRow.kind,
    userId: pushRow.userId,
    toPhone: pushRow.fallbackPhone,
    body: text,
    appointmentId: pushRow.appointmentId,
    ticketId: pushRow.ticketId,
  });
  sendSoon(row.id);
}

/** Job sweep: sends rows whose retry time has come and rows whose sender died mid-send. */
export async function sendDue() {
  const due = await notificationModel.listDue(100);
  for (const { id, status } of due) {
    if (status === 'sending') await notificationModel.update(id, { status: 'queued' }); // lease ran out
    await sendNotification(id);
  }
  return due.length;
}

/** Delivery status callback from the SMS provider (e.g. Twilio). */
export async function recordDeliveryStatus(providerMessageId, status, error) {
  const row = await notificationModel.findByProviderId(providerMessageId);
  if (!row || !status) return;
  await notificationModel.update(row.id, {
    status,
    deliveredAt: status === 'delivered' ? new Date() : row.deliveredAt,
    failedAt: status === 'failed' ? new Date() : row.failedAt,
    lastError: error ?? row.lastError,
  });
}

export async function registerPushToken(userId, token, userAgent) {
  await notificationModel.upsertPushToken(userId, token, userAgent?.slice(0, 300));
}

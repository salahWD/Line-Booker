// Notifications (SMS + push) using the "outbox" pattern:
//
//   1. Inside the business transaction we INSERT a row into `notifications` (status queued).
//      If the transaction rolls back, no message is ever sent.
//   2. After commit, a pg-boss job `notify-send` is added for the row.
//   3. The job sends it through the provider adapter, retrying with backoff on failure,
//      and records sent/delivered/failed. Push that cannot be delivered falls back to SMS.
//   4. A sweep every minute re-enqueues rows that never reached the job queue.
import { env } from '../config/env.js';
import { t } from '../locales/ar.js';
import * as notificationModel from '../models/notification.model.js';
import * as userModel from '../models/user.model.js';
import { getSmsProvider } from '../integrations/sms/index.js';
import { getPushProvider } from '../integrations/push/index.js';
import { enqueue, QUEUES } from '../jobs/boss.js';
import { logger } from '../utils/logger.js';

const MAX_ATTEMPTS = 5; // 1 try + 4 pg-boss retries

/** Absolute link for SMS / push. */
export const absoluteUrl = (path) => `${env.APP_URL}${path}`;

/** Message text from the locale file with the app name filled in. */
export const message = (key, vars) => t(`sms.${key}`, { app: env.APP_NAME, ...vars });

function scheduleSend(tx, id) {
  tx.afterCommit(async () => {
    const jobId = await enqueue(QUEUES.NOTIFY_SEND, { id });
    if (jobId) await notificationModel.markEnqueued([id]);
  });
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
 * If push fails on every device, the job automatically sends the SMS instead.
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
 * Sends one queued notification (called by the `notify-send` job).
 * Throws on a retryable failure so pg-boss retries with backoff.
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
      await notificationModel.update(row.id, { status: 'sent', provider: provider.name, sentAt: new Date(), lastError: null });
      return;
    }

    // No device accepted the push → fall back to SMS right away (no point retrying dead tokens).
    await notificationModel.update(row.id, {
      status: 'failed',
      provider: provider.name,
      failedAt: new Date(),
      lastError: errors.join(' | ') || 'no active push tokens',
    });
    if (row.fallbackPhone) await sendSmsFallback(row);
  } catch (err) {
    const finalAttempt = row.attempts >= MAX_ATTEMPTS;
    await notificationModel.update(row.id, {
      status: finalAttempt ? 'failed' : 'queued',
      lastError: err.message,
      failedAt: finalAttempt ? new Date() : null,
    });
    if (finalAttempt) {
      logger.error(`Notification ${row.id} failed permanently`, err);
      if (row.channel === 'push' && row.fallbackPhone) await sendSmsFallback(row);
      return;
    }
    throw err; // let pg-boss retry
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
  const jobId = await enqueue(QUEUES.NOTIFY_SEND, { id: row.id });
  if (jobId) await notificationModel.markEnqueued([row.id]);
}

/** Every-minute sweep: re-enqueue notifications that never reached (or got stuck in) the queue. */
export async function sweepStuck() {
  const stuck = await notificationModel.listStuck(100);
  for (const { id } of stuck) {
    await notificationModel.update(id, { status: 'queued' });
    const jobId = await enqueue(QUEUES.NOTIFY_SEND, { id });
    if (jobId) await notificationModel.markEnqueued([id]);
  }
  return stuck.length;
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

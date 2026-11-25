// Notification outbox rows and customers' push tokens.
import { and, eq, desc, isNull, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { notifications, pushTokens } from './schema/index.js';
import { exec, one, insertOne, updateOne } from './db-helpers.js';

/** How long a "sending" row is reserved before the sweep assumes the sender died. */
const SENDING_LEASE_MS = 10 * 60_000;

export async function create(data, tx) {
  return insertOne(notifications, data, tx);
}

export async function findById(id, tx) {
  return one(await exec(tx).select().from(notifications).where(eq(notifications.id, id)));
}

export async function update(id, data, tx) {
  return updateOne(notifications, id, data, tx);
}

/**
 * Marks a queued row as "sending" — returns null if another worker already took it.
 * `nextAttemptAt` becomes a lease: if the process dies mid-send, the sweep retries after it.
 */
export async function claimForSending(id, tx) {
  return updateOne(
    notifications,
    id,
    { status: 'sending', attempts: sql`${notifications.attempts} + 1`, nextAttemptAt: new Date(Date.now() + SENDING_LEASE_MS) },
    tx,
    eq(notifications.status, 'queued'),
  );
}

/**
 * Rows the job sweep should (re)send: queued rows whose retry time has come, and "sending"
 * rows whose lease ran out. Rows created in the last few seconds are left to the
 * immediate after-commit send.
 */
export async function listDue(limit, tx) {
  const now = new Date();
  return exec(tx)
    .select({ id: notifications.id, status: notifications.status })
    .from(notifications)
    .where(
      and(
        inArray(notifications.status, ['queued', 'sending']),
        or(isNull(notifications.nextAttemptAt), lte(notifications.nextAttemptAt, now)),
        lt(notifications.createdAt, new Date(now.getTime() - 5_000)),
      ),
    )
    .orderBy(notifications.id)
    .limit(limit);
}

export async function findByProviderId(providerMessageId, tx) {
  return one(await exec(tx).select().from(notifications).where(eq(notifications.providerMessageId, providerMessageId)));
}

export async function listRecent({ limit = 200, channel } = {}, tx) {
  return exec(tx)
    .select()
    .from(notifications)
    .where(channel ? eq(notifications.channel, channel) : undefined)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function listForTicket(ticketId, tx) {
  return exec(tx).select().from(notifications).where(eq(notifications.ticketId, ticketId)).orderBy(desc(notifications.createdAt));
}

// ── Push tokens ────────────────────────────────────────────────

export async function upsertPushToken(userId, token, userAgent, tx) {
  await exec(tx)
    .insert(pushTokens)
    .values({ userId, token, userAgent })
    .onDuplicateKeyUpdate({ set: { userId, userAgent, lastSeenAt: new Date(), revokedAt: null } });
}

export async function activePushTokens(userId, tx) {
  return exec(tx)
    .select()
    .from(pushTokens)
    .where(and(eq(pushTokens.userId, userId), isNull(pushTokens.revokedAt)));
}

export async function revokePushToken(token, tx) {
  await exec(tx).update(pushTokens).set({ revokedAt: new Date() }).where(eq(pushTokens.token, token));
}

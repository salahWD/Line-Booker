// Notification outbox rows and customers' push tokens.
import { and, eq, desc, isNull, inArray, sql, lt, or } from 'drizzle-orm';
import { notifications, pushTokens } from './schema/index.js';
import { exec, one } from './db-helpers.js';

export async function create(data, tx) {
  return one(await exec(tx).insert(notifications).values(data).returning());
}

export async function findById(id, tx) {
  return one(await exec(tx).select().from(notifications).where(eq(notifications.id, id)));
}

export async function update(id, data, tx) {
  return one(await exec(tx).update(notifications).set(data).where(eq(notifications.id, id)).returning());
}

/** Marks a queued row as "sending" — returns null if another worker already took it. */
export async function claimForSending(id, tx) {
  return one(
    await exec(tx)
      .update(notifications)
      .set({ status: 'sending', attempts: sql`${notifications.attempts} + 1` })
      .where(and(eq(notifications.id, id), eq(notifications.status, 'queued')))
      .returning(),
  );
}

/** Rows that were never handed to the job queue, or have been stuck for a while. */
export async function listStuck(limit, tx) {
  return exec(tx)
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      or(
        and(eq(notifications.status, 'queued'), isNull(notifications.enqueuedAt)),
        and(eq(notifications.status, 'queued'), lt(notifications.enqueuedAt, sql`now() - interval '10 minutes'`)),
        and(eq(notifications.status, 'sending'), lt(notifications.enqueuedAt, sql`now() - interval '10 minutes'`)),
      ),
    )
    .limit(limit);
}

export async function markEnqueued(ids, tx) {
  if (!ids.length) return;
  await exec(tx).update(notifications).set({ enqueuedAt: new Date() }).where(inArray(notifications.id, ids));
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
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, userAgent, lastSeenAt: new Date(), revokedAt: null },
    });
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

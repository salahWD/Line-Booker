// Small tables: OTP codes, platform settings and the audit log.
import { and, eq, desc, gte, isNull, sql } from 'drizzle-orm';
import { otpCodes, platformSettings, auditLogs, users } from './schema/index.js';
import { exec, one } from './db-helpers.js';

// ── OTP codes ──────────────────────────────────────────────────

export async function createOtp(data, tx) {
  return one(await exec(tx).insert(otpCodes).values(data).returning());
}

export async function latestOtp(phone, tx) {
  return one(
    await exec(tx).select().from(otpCodes).where(eq(otpCodes.phone, phone)).orderBy(desc(otpCodes.createdAt)).limit(1),
  );
}

export async function latestUsableOtp(phone, tx) {
  return one(
    await exec(tx)
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1),
  );
}

export async function countOtpsSince(phone, since, tx) {
  const [row] = await exec(tx)
    .select({ n: sql`count(*)::int` })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), gte(otpCodes.createdAt, since)));
  return row.n;
}

export async function updateOtp(id, data, tx) {
  await exec(tx).update(otpCodes).set(data).where(eq(otpCodes.id, id));
}

export async function deleteOldOtps(tx) {
  await exec(tx).delete(otpCodes).where(sql`${otpCodes.createdAt} < now() - interval '1 day'`);
}

// ── Platform settings (single row) ─────────────────────────────

export async function getSettings(tx) {
  const row = one(await exec(tx).select().from(platformSettings).where(eq(platformSettings.id, 1)));
  return row ?? { id: 1, whishPaymentUrl: null, paymentInstructions: null, defaultHoldMinutes: 30 };
}

export async function saveSettings(data, tx) {
  return one(
    await exec(tx)
      .insert(platformSettings)
      .values({ id: 1, ...data })
      .onConflictDoUpdate({ target: platformSettings.id, set: data })
      .returning(),
  );
}

// ── Audit log ──────────────────────────────────────────────────

export async function addAudit(data, tx) {
  await exec(tx).insert(auditLogs).values(data);
}

export async function listAudit({ businessId, limit = 200 } = {}, tx) {
  return exec(tx)
    .select({ log: auditLogs, actorName: users.name, actorRole: users.role })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(businessId ? eq(auditLogs.businessId, businessId) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

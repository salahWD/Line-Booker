// Records sensitive administrative changes (who, what, before/after, from which IP).
import * as misc from '../models/misc.model.js';

/**
 * @param {object} tx        transaction (so the audit row commits/rolls back with the change)
 * @param {object} entry     { actor, action, entityType, entityId, businessId, before, after, ip }
 */
export async function log(tx, { actor, action, entityType, entityId, businessId, before, after, ip }) {
  await misc.addAudit(
    {
      actorUserId: actor?.id ?? null,
      businessId: businessId ?? actor?.businessId ?? null,
      action,
      entityType,
      entityId: entityId ?? null,
      before: before ?? null,
      after: after ?? null,
      ip: ip ?? null,
    },
    tx,
  );
}

/** Keeps only the fields that changed, so the audit log stays readable. */
export function diff(before, after) {
  const changedBefore = {};
  const changedAfter = {};
  for (const key of Object.keys(after)) {
    const a = before?.[key];
    const b = after[key];
    if (String(a ?? '') !== String(b ?? '')) {
      changedBefore[key] = a ?? null;
      changedAfter[key] = b ?? null;
    }
  }
  return { before: changedBefore, after: changedAfter };
}

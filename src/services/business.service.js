// Platform admin: create businesses (with their owner account) and suspend/activate them.
import { transaction, isUniqueViolation } from '../config/db.js';
import * as businessModel from '../models/business.model.js';
import * as userModel from '../models/user.model.js';
import * as audit from './audit.service.js';
import { hashPassword } from './auth.service.js';
import { assertPlatformAdmin } from './access.service.js';
import { conflict, notFound } from '../utils/errors.js';

export async function createWithOwner(admin, { name, slug, phone, ownerName, ownerEmail, ownerPhone, ownerPassword }, ip) {
  assertPlatformAdmin(admin);
  const passwordHash = await hashPassword(ownerPassword);
  try {
    return await transaction(async (tx) => {
      const business = await businessModel.create({ name, slug, phone: phone || null }, tx);
      const owner = await userModel.create(
        { role: 'business_owner', name: ownerName, email: ownerEmail.toLowerCase(), phone: ownerPhone || null, passwordHash, businessId: business.id },
        tx,
      );
      await audit.log(tx, {
        actor: admin,
        action: 'business.create',
        entityType: 'business',
        entityId: business.id,
        businessId: business.id,
        after: { name, slug, ownerEmail, ownerId: owner.id },
        ip,
      });
      return business;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('الرابط المختصر أو البريد الإلكتروني أو الهاتف مستخدم مسبقاً.');
    throw err;
  }
}

export async function setActive(admin, businessId, isActive, ip) {
  assertPlatformAdmin(admin);
  const business = await businessModel.findById(Number(businessId));
  if (!business) throw notFound();
  return transaction(async (tx) => {
    const updated = await businessModel.update(business.id, { isActive }, tx);
    await audit.log(tx, {
      actor: admin,
      action: isActive ? 'business.activate' : 'business.suspend',
      entityType: 'business',
      entityId: business.id,
      businessId: business.id,
      before: { isActive: business.isActive },
      after: { isActive },
      ip,
    });
    return updated;
  });
}

export const list = () => businessModel.listWithStats();

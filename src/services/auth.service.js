// Sign-in logic. Staff use email/phone + password; customers use phone + OTP.
import bcrypt from 'bcryptjs';
import * as userModel from '../models/user.model.js';
import * as businessModel from '../models/business.model.js';
import { normalizePhone } from '../utils/phone.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { t } from '../locales/ar.js';

const BCRYPT_COST = 12;
// Compared against when the user does not exist, so response time does not reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_COST);

export async function staffLogin(identifier, password) {
  const value = String(identifier ?? '').trim();
  const lookup = value.includes('@') ? { email: value.toLowerCase() } : { phone: normalizePhone(value) };
  const user = await userModel.findStaffByIdentifier(lookup);

  const valid = await bcrypt.compare(String(password ?? ''), user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) throw badRequest(t('auth.invalidCredentials'));
  if (!user.isActive) throw forbidden(t('auth.accountDisabled'));
  if (user.businessId) {
    const business = await businessModel.findById(user.businessId);
    if (!business?.isActive) throw forbidden(t('auth.accountDisabled'));
  }
  await userModel.touchLogin(user.id);
  return user;
}

/** After a successful OTP check: find the customer account or create it. */
export async function customerFromVerifiedPhone(phone) {
  const existing = await userModel.findByPhone(phone);
  if (existing) {
    if (existing.role !== 'customer') throw badRequest(t('auth.invalidCredentials')); // staff must use staff login
    if (!existing.isActive) throw forbidden(t('auth.accountDisabled'));
    await userModel.update(existing.id, { phoneVerifiedAt: new Date(), lastLoginAt: new Date() });
    return existing;
  }
  return userModel.create({ role: 'customer', phone, phoneVerifiedAt: new Date(), lastLoginAt: new Date() });
}

export async function setCustomerName(userId, name) {
  return userModel.update(userId, { name: name.trim() });
}

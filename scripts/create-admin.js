// Creates (or resets) the platform admin account on a real installation.
//
//   npm run create-admin -- --email admin@example.com --phone 70123456 --password 'S3cure-pass' [--name 'إدارة المنصة']
//
// Values can also come from ADMIN_EMAIL / ADMIN_PHONE / ADMIN_PASSWORD / ADMIN_NAME.
// Running it again for the same email updates that admin's password.
import { parseArgs } from 'node:util';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db.js';
import * as userModel from '../src/models/user.model.js';
import { normalizePhone } from '../src/utils/phone.js';

const { values } = parseArgs({
  options: { email: { type: 'string' }, phone: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' } },
});
const email = (values.email ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const rawPhone = values.phone ?? process.env.ADMIN_PHONE ?? '';
const password = values.password ?? process.env.ADMIN_PASSWORD ?? '';
const name = values.name ?? process.env.ADMIN_NAME ?? 'إدارة المنصة';

const fail = async (message) => {
  console.error(`❌ ${message}`);
  await pool.end();
  process.exit(1);
};

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) await fail('A valid --email is required.');
if (password.length < 10) await fail('--password must be at least 10 characters.');
const phone = rawPhone ? normalizePhone(rawPhone) : null;
if (rawPhone && !phone) await fail('--phone is not a valid phone number.');

const passwordHash = await bcrypt.hash(password, 12);
const existing = await userModel.findStaffByIdentifier({ email });
if (existing) {
  if (existing.role !== 'platform_admin') await fail(`${email} already belongs to a ${existing.role} account.`);
  await userModel.update(existing.id, { passwordHash, name, isActive: true, ...(phone ? { phone } : {}) });
  console.log(`✅ Platform admin ${email} updated (new password set).`);
} else {
  await userModel.create({ role: 'platform_admin', name, email, phone, passwordHash });
  console.log(`✅ Platform admin ${email} created. Sign in at /staff/login`);
}
await pool.end();

// Phone verification codes (OTP).
// Rules: 6 digits · valid OTP_TTL_SECONDS · OTP_MAX_ATTEMPTS wrong tries per code ·
// one code per OTP_RESEND_COOLDOWN_SECONDS · OTP_MAX_PER_HOUR codes per phone per hour.
// Codes are stored only as an HMAC hash, and the SMS text is redacted in the outbox log.
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { transaction } from '../config/db.js';
import * as misc from '../models/misc.model.js';
import * as notifications from './notification.service.js';
import { otpCode } from '../utils/codes.js';
import { badRequest, tooMany } from '../utils/errors.js';
import { t } from '../locales/ar.js';

const hash = (phone, code) => crypto.createHmac('sha256', env.OTP_SECRET).update(`${phone}:${code}`).digest('hex');

/** Seconds the user must still wait before asking for another code (0 = can send now). */
export async function secondsUntilResend(phone) {
  const latest = await misc.latestOtp(phone);
  if (!latest) return 0;
  const elapsed = (Date.now() - new Date(latest.createdAt).getTime()) / 1000;
  return Math.max(0, Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - elapsed));
}

export async function requestCode(phone, ip) {
  const wait = await secondsUntilResend(phone);
  if (wait > 0) throw tooMany(t('auth.resendWait', { seconds: wait }));

  const sentLastHour = await misc.countOtpsSince(phone, new Date(Date.now() - 3600_000));
  if (sentLastHour >= env.OTP_MAX_PER_HOUR) throw tooMany(t('auth.hourlyLimit'));

  const code = otpCode();
  const minutes = Math.round(env.OTP_TTL_SECONDS / 60);

  await transaction(async (tx) => {
    await misc.createOtp(
      { phone, codeHash: hash(phone, code), expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000), ip },
      tx,
    );
    await notifications.queueSms(tx, {
      to: phone,
      kind: 'otp',
      body: notifications.message('otp', { code: '••••••', minutes }), // what logs show
      secretBody: notifications.message('otp', { code, minutes }), // what is actually sent
    });
  });
}

/** Checks the code. Returns true on success (and consumes it); throws a friendly error otherwise. */
export async function verifyCode(phone, code) {
  const otp = await misc.latestUsableOtp(phone);
  if (!otp) throw badRequest(t('auth.codeExpired'));
  if (new Date(otp.expiresAt) < new Date()) throw badRequest(t('auth.codeExpired'));
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) throw tooMany(t('auth.tooManyAttempts'));

  const expected = Buffer.from(otp.codeHash, 'hex');
  const actual = Buffer.from(hash(phone, String(code).trim()), 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!ok) {
    await misc.updateOtp(otp.id, { attempts: otp.attempts + 1 });
    if (otp.attempts + 1 >= env.OTP_MAX_ATTEMPTS) throw tooMany(t('auth.tooManyAttempts'));
    throw badRequest(t('auth.codeInvalid'));
  }
  await misc.updateOtp(otp.id, { consumedAt: new Date() });
  return true;
}

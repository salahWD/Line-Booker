// Phone numbers are stored in E.164 format (+96170123456). Local Lebanese input like
// "70 123 456" or "03123456" is accepted and normalised.
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { env } from '../config/env.js';

/** Returns the E.164 number, or null when the input is not a valid phone number. */
export function normalizePhone(input) {
  if (!input) return null;
  const cleaned = String(input).replace(/[^\d+]/g, '').replace(/^00/, '+');
  const parsed = parsePhoneNumberFromString(cleaned, env.DEFAULT_PHONE_COUNTRY);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** "+96170123456" → "+961 70 ••• 456" — safe to show on screens shared with others. */
export function maskPhone(phone) {
  if (!phone) return '';
  return `${phone.slice(0, -6)}•••${phone.slice(-3)}`;
}

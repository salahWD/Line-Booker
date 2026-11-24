// Random tokens and human-friendly reference codes.
import crypto from 'node:crypto';

// No 0/O, 1/I/L — easy to read aloud and type into a Whish transfer note.
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** URL-safe random token (tracking links, display screens). */
export function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Appointment reference such as "AP-7Q4M2X". */
export function appointmentReference() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length];
  return `AP-${out}`;
}

/** Six-digit numeric OTP code. */
export function otpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** "A" + 12 → "A-012" */
export function ticketDisplayCode(prefix, number) {
  return `${prefix}-${String(number).padStart(3, '0')}`;
}

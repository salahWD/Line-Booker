// CSRF protection (synchronizer token stored in the session).
// Forms send it as a hidden `_csrf` field; fetch() calls send the `X-CSRF-Token` header
// (read from <meta name="csrf-token">). Multipart uploads are checked after multer has
// parsed the body (see middleware/upload.js).
import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';
import { randomToken } from '../utils/codes.js';
import { t } from '../locales/ar.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomToken(24);
  return req.session.csrfToken;
}

function tokensMatch(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = req.get('x-csrf-token') || req.body?._csrf;
  if (tokensMatch(sent, req.session?.csrfToken)) return next();
  next(new AppError(t('errors.csrf'), 403, 'csrf'));
}

/** Global middleware: skips multipart requests, which verify the token after parsing. */
export function csrfProtection(req, res, next) {
  if (req.is('multipart/form-data')) return next();
  return verifyCsrf(req, res, next);
}

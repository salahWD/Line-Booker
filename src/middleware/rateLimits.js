// Request rate limits (in memory — use a shared store such as Redis if you run several instances).
import { rateLimit } from 'express-rate-limit';
import { tooMany } from '../utils/errors.js';
import { t } from '../locales/ar.js';

const limiter = (windowMinutes, limit, keyGenerator) =>
  rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res, next) => next(tooMany(t('errors.rateLimited'))),
  });

export const otpRequestLimiter = limiter(60, 20); // per IP (per-phone limits live in otp.service)
export const otpVerifyLimiter = limiter(15, 30);
export const staffLoginLimiter = limiter(15, 10);
export const bookingLimiter = limiter(60, 30);
export const joinLimiter = limiter(10, 20);
export const uploadLimiter = limiter(60, 20);
export const apiLimiter = limiter(1, 300);

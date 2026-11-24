// Values every view can use: the current user, translations, CSRF token, flash messages,
// old form input after a validation error, and formatting helpers.
import { env } from '../config/env.js';
import { t } from '../locales/ar.js';
import ar from '../locales/ar.js';
import { ensureCsrfToken } from './csrf.js';
import { formatMoney } from '../utils/money.js';
import { formatDate, formatTime, formatDateTime, hhmm } from '../utils/dates.js';
import { maskPhone } from '../utils/phone.js';

/** Escapes JSON for safe embedding inside <script type="application/json">. */
const safeJson = (value) => JSON.stringify(value ?? null).replace(/</g, '\\u003c');

export function locals(req, res, next) {
  const session = req.session;
  res.locals.t = t;
  res.locals.appName = env.APP_NAME;
  res.locals.currentUser = req.user ?? null;
  res.locals.currentPath = req.path;
  res.locals.csrfToken = ensureCsrfToken(req);
  res.locals.isDev = !env.isProduction;
  res.locals.mockNotifications = !env.isProduction && (env.SMS_PROVIDER === 'mock' || env.pushProvider === 'mock');
  res.locals.clientStrings = safeJson(ar.client);
  res.locals.safeJson = safeJson;
  res.locals.timezone = env.DEFAULT_TIMEZONE;

  // One-time values set before a redirect (Post/Redirect/Get).
  res.locals.flash = session.flash ?? [];
  res.locals.old = session.old ?? {};
  res.locals.errors = session.formErrors ?? {};
  delete session.flash;
  delete session.old;
  delete session.formErrors;

  res.locals.fmt = { money: formatMoney, date: formatDate, time: formatTime, dateTime: formatDateTime, hhmm, maskPhone };
  next();
}

/** req.flash('success' | 'error' | 'info', message) — shown once on the next page. */
export function flashHelper(req, res, next) {
  req.flash = (type, message) => {
    req.session.flash = [...(req.session.flash ?? []), { type, message }];
  };
  next();
}

// Turns errors into responses:
//   • fetch/JSON requests → { error: { code, message, details } }
//   • form submissions    → back to the form with the message and the typed values
//   • page requests       → friendly Arabic error page
// Unexpected errors are logged and shown as a generic message (no stack traces to users).
import { AppError, notFound } from '../utils/errors.js';
import { wantsJson, backUrl } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { t } from '../locales/ar.js';

const SECRET_FIELDS = ['_csrf', 'password', 'ownerPassword', 'code', 'currentPassword'];

export function notFoundHandler(req, res, next) {
  next(notFound());
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const known = err instanceof AppError;
  const status = known ? err.status : err.status && err.status < 500 ? err.status : 500;
  const message = known ? err.message : status < 500 ? t('common.errorGeneric') : t('errors.serverBody');
  if (status >= 500) logger.error(`${req.method} ${req.originalUrl}`, err);

  if (wantsJson(req)) {
    return res.status(status).json({ error: { code: err.code ?? 'error', message, details: err.details } });
  }

  // Post/Redirect/Get: show the error on the form the user came from, keeping their input.
  if (req.method !== 'GET' && status < 500 && status !== 404 && req.session) {
    req.session.flash = [...(req.session.flash ?? []), { type: 'error', message }];
    if (err.details) req.session.formErrors = err.details;
    const old = { ...(req.body ?? {}) };
    for (const field of SECRET_FIELDS) delete old[field];
    req.session.old = old;
    return res.redirect(backUrl(req));
  }

  const titles = { 403: t('errors.forbiddenTitle'), 404: t('errors.notFoundTitle') };
  const bodies = { 403: t('errors.forbiddenBody'), 404: t('errors.notFoundBody') };
  res.status(status).render('pages/errors/error', {
    title: titles[status] ?? t('errors.serverTitle'),
    status,
    body: bodies[status] ?? message,
  });
}

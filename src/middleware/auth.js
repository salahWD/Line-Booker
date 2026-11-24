// Authentication & role checks.
import * as userModel from '../models/user.model.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { wantsJson } from '../utils/http.js';

/** Loads req.user from the session. Disabled accounts and suspended businesses are logged out. */
export async function loadUser(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();
  const found = await userModel.findWithBusiness(userId);
  const user = found?.user;
  const blocked = !user || !user.isActive || (user.businessId && !found.businessActive);
  if (blocked) {
    delete req.session.userId;
    return next();
  }
  req.user = { ...user, businessName: found.businessName };
  next();
}

/** Starts a fresh session on login (prevents session fixation). */
export function loginSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

export function logoutSession(req) {
  return new Promise((resolve) => req.session.destroy(() => resolve()));
}

/** Customers only. Unknown visitors are sent to the phone login and brought back afterwards. */
export function requireCustomer(req, res, next) {
  if (req.user?.role === 'customer') {
    // First login: ask for a name before anything else.
    if (!req.user.name && req.path !== '/welcome') return res.redirect(`/welcome?next=${encodeURIComponent(req.originalUrl)}`);
    return next();
  }
  if (wantsJson(req)) return next(unauthorized());
  if (req.user) return next(forbidden());
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

/** Staff roles. Example: requireRole('business_owner', 'branch_operator') */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) return next();
    if (!req.user) {
      if (wantsJson(req)) return next(unauthorized());
      return res.redirect(`/staff/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    next(forbidden());
  };
}

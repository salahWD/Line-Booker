// Customer phone/OTP login, first-time name, staff login and logout.
import * as otp from '../services/otp.service.js';
import * as auth from '../services/auth.service.js';
import { loginSession, logoutSession } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import * as v from '../validators/customer.validators.js';
import { safeNext, clientIp } from '../utils/http.js';
import { t } from '../locales/ar.js';

const STAFF_HOME = { platform_admin: '/admin', business_owner: '/owner', branch_operator: '/operator' };

export function showLogin(req, res) {
  if (req.user?.role === 'customer') return res.redirect(safeNext(req.query.next, '/me'));
  res.render('pages/public/login', { title: t('auth.customerTitle'), next: safeNext(req.query.next, '') });
}

export async function requestCode(req, res) {
  const { phone, next } = parse(v.phoneLogin, req.body);
  await otp.requestCode(phone, clientIp(req));
  req.session.pendingPhone = phone;
  req.flash('success', t('auth.codeSent'));
  res.redirect(`/login/verify${next ? `?next=${encodeURIComponent(safeNext(next))}` : ''}`);
}

export async function showVerify(req, res) {
  const phone = req.session.pendingPhone;
  if (!phone) return res.redirect('/login');
  res.render('pages/public/verify', {
    title: t('auth.verifyTitle'),
    phone,
    next: safeNext(req.query.next, ''),
    resendIn: await otp.secondsUntilResend(phone),
  });
}

export async function resendCode(req, res) {
  const phone = req.session.pendingPhone;
  if (!phone) return res.redirect('/login');
  await otp.requestCode(phone, clientIp(req));
  req.flash('success', t('auth.codeSent'));
  res.redirect(`/login/verify${req.body.next ? `?next=${encodeURIComponent(safeNext(req.body.next))}` : ''}`);
}

export async function verifyCode(req, res) {
  const phone = req.session.pendingPhone;
  if (!phone) return res.redirect('/login');
  const { code, next } = parse(v.otpVerify, req.body);
  await otp.verifyCode(phone, code);
  const user = await auth.customerFromVerifiedPhone(phone);
  await loginSession(req, user.id);
  const target = safeNext(next, '/me');
  res.redirect(user.name ? target : `/welcome?next=${encodeURIComponent(target)}`);
}

export function showWelcome(req, res) {
  res.render('pages/public/welcome', { title: t('auth.welcomeTitle'), next: safeNext(req.query.next, '/me') });
}

export async function saveWelcome(req, res) {
  const { name, next } = parse(v.welcome, req.body);
  await auth.setCustomerName(req.user.id, name);
  res.redirect(safeNext(next, '/me'));
}

export function showStaffLogin(req, res) {
  if (req.user && STAFF_HOME[req.user.role]) return res.redirect(STAFF_HOME[req.user.role]);
  res.render('pages/public/staff-login', { title: t('auth.staffTitle'), next: safeNext(req.query.next, '') });
}

export async function staffLogin(req, res) {
  const { identifier, password, next } = parse(v.staffLogin, req.body);
  const user = await auth.staffLogin(identifier, password);
  await loginSession(req, user.id);
  req.session.cookie.maxAge = 12 * 3600_000; // staff sessions are shorter than customer sessions
  res.redirect(safeNext(next, STAFF_HOME[user.role]));
}

export async function logout(req, res) {
  await logoutSession(req);
  res.clearCookie('sid');
  res.redirect('/');
}

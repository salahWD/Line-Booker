// Platform admin: businesses, platform settings (Whish link), payment verification,
// settlement report, notification log and audit log.
import * as businessService from '../services/business.service.js';
import * as settingsService from '../services/settings.service.js';
import * as payments from '../services/payment.service.js';
import * as reportService from '../services/report.service.js';
import * as notificationModel from '../models/notification.model.js';
import { parse } from '../middleware/validate.js';
import * as v from '../validators/staff.validators.js';
import { toCsv, sendCsv } from '../utils/csv.js';
import { clientIp } from '../utils/http.js';
import { t } from '../locales/ar.js';

const staffLayout = { layout: 'layouts/staff' };

export async function dashboard(req, res) {
  const [stats, pending] = await Promise.all([reportService.adminOverview(), payments.adminQueue()]);
  res.render('pages/admin/dashboard', { ...staffLayout, title: t('admin.title'), stats, pending: pending.slice(0, 5) });
}

export async function businesses(req, res) {
  res.render('pages/admin/businesses', { ...staffLayout, title: t('admin.businesses'), list: await businessService.list() });
}

export function newBusiness(req, res) {
  res.render('pages/admin/business-form', { ...staffLayout, title: t('admin.newBusiness') });
}

export async function createBusiness(req, res) {
  const data = parse(v.business, req.body);
  await businessService.createWithOwner(req.user, data, clientIp(req));
  req.flash('success', t('admin.businessCreated'));
  res.redirect('/admin/businesses');
}

export async function toggleBusiness(req, res) {
  await businessService.setActive(req.user, req.params.id, req.body.active === '1', clientIp(req));
  req.flash('success', t('common.saved'));
  res.redirect('/admin/businesses');
}

export async function settings(req, res) {
  res.render('pages/admin/settings', { ...staffLayout, title: t('admin.settings'), settings: await settingsService.getSettings() });
}

export async function saveSettings(req, res) {
  const data = parse(v.platformSettings, req.body);
  await settingsService.updateSettings(req.user, data, clientIp(req));
  req.flash('success', t('common.saved'));
  res.redirect('/admin/settings');
}

// ── Payment verification ─────────────────────────────────────────

export async function paymentQueue(req, res) {
  const [pending, history] = await Promise.all([payments.adminQueue(), payments.adminHistory()]);
  res.render('pages/admin/payments', { ...staffLayout, title: t('admin.payments'), pending, history: history.slice(0, 50) });
}

export async function confirmPayment(req, res) {
  await payments.confirmPayment(req.user, req.params.id, clientIp(req));
  req.flash('success', t('admin.paymentConfirmed'));
  res.redirect('/admin/payments');
}

export async function rejectPayment(req, res) {
  const { reason } = parse(v.rejectPayment, req.body);
  await payments.rejectPayment(req.user, req.params.id, reason, clientIp(req));
  req.flash('success', t('admin.paymentRejected'));
  res.redirect('/admin/payments');
}

export async function proof(req, res) {
  const file = await payments.proofFile(req.user, req.params.id);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', 'inline');
  res.type(file.mime).sendFile(file.absolute);
}

// ── Reports & logs ───────────────────────────────────────────────

export async function settlement(req, res) {
  const query = parse(v.reportQuery, req.query);
  const report = await reportService.settlementReport(req.user, query);
  if (req.query.format === 'csv') {
    return sendCsv(res, `settlement-${report.period.from}-${report.period.to}.csv`, toCsv(report.rows, [
      { key: 'business_name', label: t('common.business') },
      { key: 'branch_name', label: t('common.branch') },
      { key: 'currency', label: t('common.currency') },
      { key: 'count', label: t('reports.appointments') },
      { key: 'total', label: t('reports.confirmedFees') },
    ]));
  }
  res.render('pages/admin/settlement', { ...staffLayout, title: t('admin.settlement'), report });
}

export async function notifications(req, res) {
  const channel = ['sms', 'push'].includes(req.query.channel) ? req.query.channel : undefined;
  const list = await notificationModel.listRecent({ limit: 200, channel });
  res.render('pages/admin/notifications', { ...staffLayout, title: t('admin.notifications'), list, channel });
}

export async function audit(req, res) {
  const logs = await reportService.auditLog({});
  res.render('pages/admin/audit', { ...staffLayout, title: t('admin.audit'), logs });
}

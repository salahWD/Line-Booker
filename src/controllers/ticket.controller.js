// Take a number, and the live ticket tracker (/t/:token).
import * as lineModel from '../models/line.model.js';
import * as ticketModel from '../models/ticket.model.js';
import * as lineService from '../services/line.service.js';
import * as realtime from '../services/realtime.service.js';
import { firebaseWebConfig } from '../integrations/push/index.js';
import { parse } from '../middleware/validate.js';
import * as v from '../validators/customer.validators.js';
import { env } from '../config/env.js';
import { ALERT_LEAD_CHOICES } from '../config/constants.js';
import { notFound } from '../utils/errors.js';
import { t } from '../locales/ar.js';

function joinedMessage(outcome) {
  if (outcome === 'existing') return t('ticket.alreadyActive');
  if (outcome === 'checked_in') return t('appointment.checkedIn');
  return t('ticket.joined');
}

/** Remote "take a number" from the branch page. */
export async function join(req, res) {
  const { ticket, outcome } = await lineService.joinAsCustomer(req.user, req.params.lineId);
  req.flash(outcome === 'existing' ? 'info' : 'success', joinedMessage(outcome));
  res.redirect(`/t/${ticket.trackingToken}`);
}

/** QR poster at the branch → /join/<line display token>. Works even when remote joining is off. */
export async function onsitePage(req, res) {
  const line = await lineModel.findByDisplayToken(String(req.params.token));
  if (!line || !line.isActive) throw notFound();
  const found = await lineModel.findWithBranch(line.id);
  res.render('pages/customer/join', { title: t('ticket.joinTitle', { line: line.name }), line, branch: found.branch });
}

export async function onsiteJoin(req, res) {
  const line = await lineModel.findByDisplayToken(String(req.params.token));
  if (!line) throw notFound();
  const { ticket, outcome } = await lineService.joinAsCustomer(req.user, line.id, { onsite: true });
  req.flash(outcome === 'existing' ? 'info' : 'success', joinedMessage(outcome));
  res.redirect(`/t/${ticket.trackingToken}`);
}

export async function trackerPage(req, res) {
  const view = await lineService.ticketView(String(req.params.token));
  const ownedByViewer = req.user && view.ticket.customerId === req.user.id;
  // Internal ids are not needed by the page (it is embedded as JSON).
  delete view.ticket.customerId;
  delete view.ticket.id;
  res.render('pages/customer/ticket', {
    title: `${t('ticket.title')} ${view.ticket.code}`,
    view,
    token: req.params.token,
    alertChoices: ALERT_LEAD_CHOICES,
    // Push needs a customer account to attach the device token to.
    canEnablePush: Boolean(ownedByViewer),
    pushConfig: firebaseWebConfig(),
    vapidKey: env.FIREBASE_WEB_VAPID_KEY,
    firebaseSdk: env.FIREBASE_WEB_SDK_VERSION,
  });
}

export async function trackerState(req, res) {
  const view = await lineService.ticketView(String(req.params.token));
  delete view.ticket.customerId;
  delete view.ticket.id;
  res.json(view);
}

export async function trackerEvents(req, res) {
  const ticket = await ticketModel.findByToken(String(req.params.token));
  if (!ticket) throw notFound();
  realtime.subscribe(req, res, [`line:${ticket.lineId}`]);
}

export async function setAlert(req, res) {
  const { minutes } = parse(v.alertLead, req.body);
  await lineService.setAlertLead(String(req.params.token), minutes);
  res.json({ ok: true, minutes });
}

export async function cancel(req, res) {
  await lineService.cancelByToken(String(req.params.token), req.user?.id ?? null);
  req.flash('info', t('ticket.cancelled'));
  res.redirect(`/t/${req.params.token}`);
}

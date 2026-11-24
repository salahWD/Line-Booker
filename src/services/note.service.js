// Notes with server-enforced visibility:
//   customer → written by the customer; visible to the customer and staff
//   internal → written by staff; staff only — never returned to customer pages
//   shared   → written by staff; visible to the customer
import * as noteModel from '../models/note.model.js';
import * as appointmentModel from '../models/appointment.model.js';
import * as ticketModel from '../models/ticket.model.js';
import * as access from './access.service.js';
import { badRequest, notFound } from '../utils/errors.js';

export const CUSTOMER_VISIBLE_KINDS = ['customer', 'shared'];
export const STAFF_KINDS = ['internal', 'shared'];

/** Loads the appointment or ticket a note is attached to. */
async function loadTarget({ appointmentId, ticketId }) {
  if (appointmentId) return { kind: 'appointment', record: await appointmentModel.findById(Number(appointmentId)) };
  if (ticketId) return { kind: 'ticket', record: await ticketModel.findById(Number(ticketId)) };
  throw badRequest('missing note target');
}

/** A customer adds a note to their own appointment or ticket. The kind is always "customer". */
export async function addCustomerNote(customer, target, body) {
  const { kind, record } = await loadTarget(target);
  if (!record || record.customerId !== customer.id) throw notFound();
  return noteModel.create({
    businessId: record.businessId,
    branchId: record.branchId,
    appointmentId: kind === 'appointment' ? record.id : null,
    ticketId: kind === 'ticket' ? record.id : null,
    authorId: customer.id,
    kind: 'customer',
    body,
  });
}

/** Staff add an internal or shared note — only inside their own branches. */
export async function addStaffNote(user, target, noteKind, body) {
  if (!STAFF_KINDS.includes(noteKind)) throw badRequest('نوع الملاحظة غير صالح.');
  const { kind, record } = await loadTarget(target);
  await access.assertRecordAccess(user, record);
  return noteModel.create({
    businessId: record.businessId,
    branchId: record.branchId,
    appointmentId: kind === 'appointment' ? record.id : null,
    ticketId: kind === 'ticket' ? record.id : null,
    authorId: user.id,
    kind: noteKind,
    body,
  });
}

export function listForCustomer(target) {
  return noteModel.list({ ...target, kinds: CUSTOMER_VISIBLE_KINDS });
}

export async function listForStaff(user, target) {
  const { record } = await loadTarget(target);
  await access.assertRecordAccess(user, record);
  return noteModel.list({ ...target, kinds: ['customer', 'internal', 'shared'] });
}

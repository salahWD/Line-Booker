// Reviews: one per completed appointment (rating 1–5 + comment); the business owner can reply.
import { isUniqueViolation, transaction } from '../config/db.js';
import * as reviewModel from '../models/review.model.js';
import * as appointmentModel from '../models/appointment.model.js';
import * as access from './access.service.js';
import * as audit from './audit.service.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { t } from '../locales/ar.js';

export async function create(customer, reference, { rating, comment }) {
  const appointment = (await appointmentModel.findDetailByReference(String(reference)))?.appointment;
  if (!appointment || appointment.customerId !== customer.id) throw notFound();
  if (appointment.status !== 'completed') throw badRequest(t('reviews.onlyCompleted'));
  try {
    return await reviewModel.create({
      appointmentId: appointment.id,
      businessId: appointment.businessId,
      branchId: appointment.branchId,
      lineId: appointment.lineId,
      customerId: customer.id,
      rating,
      comment: comment || null,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(t('reviews.already'));
    throw err;
  }
}

export async function reply(user, reviewId, text, ip) {
  const review = await reviewModel.findById(Number(reviewId));
  if (!review) throw notFound();
  access.assertOwnerOf(user, review.businessId);
  return transaction(async (tx) => {
    const updated = await reviewModel.update(review.id, { ownerReply: text, repliedById: user.id, repliedAt: new Date() }, tx);
    await audit.log(tx, { actor: user, action: 'review.reply', entityType: 'review', entityId: review.id, businessId: review.businessId, before: { reply: review.ownerReply }, after: { reply: text }, ip });
    return updated;
  });
}

export const listForBranch = (branchId, limit = 20) => reviewModel.listForBranch(branchId, limit);
export const ratingByBranch = (branchIds) => reviewModel.ratingByBranch(branchIds);

export async function listForOwner(user, filters) {
  return reviewModel.listForBusiness(user.businessId, filters);
}

import { Router } from 'express';
import { numericIdParams } from '../middleware/params.js';
import * as me from '../controllers/customer.controller.js';
import * as book from '../controllers/booking.controller.js';
import * as push from '../controllers/push.controller.js';
import { requireCustomer } from '../middleware/auth.js';
import { paymentProofUpload } from '../middleware/upload.js';
import { bookingLimiter, uploadLimiter } from '../middleware/rateLimits.js';

export const customerRoutes = numericIdParams(Router());

// Booking an appointment (browsing is public; holding a slot needs login)
customerRoutes.get('/book/:slug', book.chooseLine);
customerRoutes.get('/book/:slug/:lineId', book.chooseSlot);
customerRoutes.post('/book/:slug/:lineId', requireCustomer, bookingLimiter, book.hold);

// My area
customerRoutes.get('/me', requireCustomer, me.dashboard);
customerRoutes.get('/me/appointments/:ref', requireCustomer, me.appointmentPage);
customerRoutes.post('/me/appointments/:ref/cancel', requireCustomer, me.cancel);
customerRoutes.post('/me/appointments/:ref/check-in', requireCustomer, me.checkIn);
customerRoutes.get('/me/appointments/:ref/reschedule', requireCustomer, me.rescheduleForm);
customerRoutes.post('/me/appointments/:ref/reschedule', requireCustomer, bookingLimiter, me.reschedule);
customerRoutes.post('/me/appointments/:ref/payment', requireCustomer, uploadLimiter, paymentProofUpload, me.submitTransfer);
customerRoutes.post('/me/appointments/:ref/notes', requireCustomer, me.addNote);
customerRoutes.post('/me/appointments/:ref/review', requireCustomer, me.addReview);
customerRoutes.get('/me/payments/:id/proof', requireCustomer, me.proof);

// Push notification devices
customerRoutes.post('/push/tokens', requireCustomer, push.register);
customerRoutes.post('/push/tokens/mock', requireCustomer, push.registerMock);

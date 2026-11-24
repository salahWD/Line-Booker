// Customer-side input: login, booking, payments, notes, reviews, line alerts.
import { z } from 'zod';
import { phone, requiredText, optionalText, int, isoDate } from './common.js';
import { ALERT_LEAD_CHOICES } from '../config/constants.js';

export const phoneLogin = z.object({ phone, next: z.string().optional() });

export const otpVerify = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'الرمز يتكون من 6 أرقام'),
  next: z.string().optional(),
});

export const welcome = z.object({ name: requiredText(80), next: z.string().optional() });

export const staffLogin = z.object({
  identifier: requiredText(160),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export const hold = z.object({ slotId: int(1, 2_147_483_647), note: optionalText(500) });

export const reschedule = z.object({ slotId: int(1, 2_147_483_647) });

export const dateQuery = z.object({ date: isoDate.optional() });

export const transfer = z.object({
  transactionRef: z.string().trim().min(3, 'أدخل رقم العملية كما يظهر في Whish').max(80),
});

export const note = z.object({ body: requiredText(1000) });

export const review = z.object({ rating: int(1, 5), comment: optionalText(1000) });

export const alertLead = z.object({ minutes: z.coerce.number().int().refine((v) => ALERT_LEAD_CHOICES.includes(v)) });

export const pushToken = z.object({ token: z.string().min(10).max(4096) });

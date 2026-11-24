// Staff input: operator console, owner settings, platform admin.
import { z } from 'zod';
import {
  requiredText, optionalText, checkbox, int, optionalInt, isoDate, hhmmTime,
  optionalPhone, arrayOf, slug, money,
} from './common.js';
import { CURRENCIES, FEE_TYPES, QUEUE_POLICIES } from '../config/constants.js';

// ── Operator ───────────────────────────────────────────────────
export const counter = z.object({ counterLabel: optionalText(40) });
export const walkIn = z.object({ guestName: optionalText(80), phone: z.string().trim().max(30).optional() });
export const pause = z.object({ reason: optionalText(200) });
export const staffNote = z.object({ body: requiredText(1000), kind: z.enum(['internal', 'shared']) });
export const cancelReason = z.object({ reason: optionalText(300) });

// ── Owner: branch ──────────────────────────────────────────────
export const branch = z.object({
  name: requiredText(120),
  slug,
  city: requiredText(80),
  address: optionalText(300),
  phone: optionalPhone,
  timezone: z.string().trim().min(3).max(64).default('Asia/Beirut'),
  feeAmount: money,
  currency: z.enum(CURRENCIES),
  feeType: z.enum(FEE_TYPES),
  holdMinutes: optionalInt(5, 1440),
  minNoticeMinutes: int(0, 10_080),
  bookingWindowDays: int(1, 60),
  cancellationCutoffHours: int(0, 720),
  allowReschedule: checkbox,
  cancellationPolicyText: optionalText(1000),
  isActive: checkbox,
});

export const hours = z
  .object({
    weekday: arrayOf(z.coerce.number().int().min(1).max(7)),
    openTime: arrayOf(hhmmTime),
    closeTime: arrayOf(hhmmTime),
  })
  .transform((v, ctx) => {
    const rows = v.weekday.map((weekday, i) => ({ weekday, openTime: v.openTime[i], closeTime: v.closeTime[i] }));
    rows.forEach((r, i) => {
      if (!r.openTime || !r.closeTime || r.closeTime <= r.openTime) {
        ctx.addIssue({ code: 'custom', path: ['closeTime', i], message: 'وقت الإغلاق يجب أن يكون بعد وقت الفتح' });
      }
    });
    return rows;
  });

export const holiday = z.object({ date: isoDate, reason: optionalText(120) });

// ── Owner: line ────────────────────────────────────────────────
export const line = z.object({
  name: requiredText(120),
  description: optionalText(300),
  codePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}$/, 'حرف إنجليزي واحد إلى ثلاثة'),
  avgMinutesPerCustomer: int(1, 240),
  countersCount: int(1, 50),
  queuePolicy: z.enum(QUEUE_POLICIES),
  interleaveRatio: int(1, 10),
  lateGraceMinutes: int(0, 240),
  checkinOpenMinutes: int(0, 720),
  allowRemoteJoin: checkbox,
  defaultAlertLeadMinutes: int(5, 120),
  alertAheadThreshold: int(0, 20),
  sortOrder: int(0, 100),
  isActive: checkbox,
});

// ── Owner: slots ───────────────────────────────────────────────
export const slotGenerator = z
  .object({
    fromDate: isoDate,
    toDate: isoDate,
    weekdays: arrayOf(z.coerce.number().int().min(1).max(7)).refine((v) => v.length > 0, 'اختر يوماً واحداً على الأقل'),
    startTime: hhmmTime,
    endTime: hhmmTime,
    slotMinutes: int(5, 480),
    capacity: int(1, 50),
  })
  .refine((v) => v.endTime > v.startTime, { path: ['endTime'], message: 'وقت النهاية يجب أن يكون بعد البداية' });

export const singleSlot = z.object({ date: isoDate, time: hhmmTime, durationMinutes: int(5, 480), capacity: int(1, 50) });

// ── Owner: operators ───────────────────────────────────────────
const operatorBase = {
  name: requiredText(80),
  email: z.string().trim().toLowerCase().email('بريد إلكتروني غير صالح').max(160).optional().or(z.literal('')).transform((v) => v || null),
  phone: optionalPhone,
  branchIds: arrayOf(z.coerce.number().int().positive()),
};

export const operatorCreate = z
  .object({ ...operatorBase, password: z.string().min(8, 'كلمة المرور 8 أحرف على الأقل').max(200) })
  .refine((v) => v.email || v.phone, { path: ['email'], message: 'أدخل البريد الإلكتروني أو الهاتف لتسجيل الدخول' });

export const operatorUpdate = z
  .object({
    ...operatorBase,
    isActive: checkbox,
    password: z.string().max(200).optional().transform((v) => v || null).refine((v) => !v || v.length >= 8, 'كلمة المرور 8 أحرف على الأقل'),
  })
  .refine((v) => v.email || v.phone, { path: ['email'], message: 'أدخل البريد الإلكتروني أو الهاتف لتسجيل الدخول' });

export const reply = z.object({ reply: requiredText(1000) });

export const reportQuery = z.object({
  from: isoDate.optional().or(z.literal('')).transform((v) => v || undefined),
  to: isoDate.optional().or(z.literal('')).transform((v) => v || undefined),
  branchId: optionalInt(1, 2_147_483_647).optional(),
  lineId: optionalInt(1, 2_147_483_647).optional(),
});

// ── Platform admin ─────────────────────────────────────────────
export const business = z.object({
  name: requiredText(120),
  slug,
  phone: optionalPhone,
  ownerName: requiredText(80),
  ownerEmail: z.string().trim().toLowerCase().email('بريد إلكتروني غير صالح'),
  ownerPhone: optionalPhone,
  ownerPassword: z.string().min(8, 'كلمة المرور 8 أحرف على الأقل').max(200),
});

export const platformSettings = z.object({
  whishPaymentUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null)
    .refine((v) => !v || /^https:\/\/\S+$/.test(v), 'يجب أن يبدأ الرابط بـ https://'),
  paymentInstructions: optionalText(1000),
  defaultHoldMinutes: int(5, 1440),
});

export const rejectPayment = z.object({ reason: requiredText(300) });

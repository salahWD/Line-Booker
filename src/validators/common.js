// Building blocks for form validation (HTML forms send everything as strings).
import { z } from 'zod';
import { normalizePhone } from '../utils/phone.js';
import { t } from '../locales/ar.js';

/** Trimmed text; empty → null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const requiredText = (max = 200) => z.string().trim().min(1, t('common.required')).max(max);

/** HTML checkbox: present ("on") = true, missing = false. */
export const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === '1' || v === true, z.boolean());

export const int = (min, max) => z.coerce.number().int().min(min).max(max);

export const optionalInt = (min, max) =>
  z.preprocess((v) => (v === '' || v === undefined || v === null ? null : v), z.coerce.number().int().min(min).max(max).nullable());

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح');
export const hhmmTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'وقت غير صالح');

/** Phone in any common local format → E.164. */
export const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const normalized = normalizePhone(v);
    if (!normalized) ctx.addIssue({ code: 'custom', message: t('auth.invalidPhone') });
    return normalized ?? '';
  });

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const normalized = normalizePhone(v);
    if (!normalized) ctx.addIssue({ code: 'custom', message: t('auth.invalidPhone') });
    return normalized;
  });

/** Single value or repeated form field → array. */
export const arrayOf = (schema) => z.preprocess((v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]), z.array(schema));

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'أحرف إنجليزية صغيرة وأرقام وشرطات فقط')
  .max(80);

export const money = z.coerce.number().min(0).max(100_000_000).transform((v) => v.toFixed(2));

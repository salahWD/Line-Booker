// Zod validation helpers. Error messages come in Arabic (Zod's built-in "ar" locale).
import { z } from 'zod';
import { ar } from 'zod/locales';
import { validationError } from '../utils/errors.js';

z.config(ar());

/** { fieldName: firstMessage } from a ZodError. */
export function fieldErrors(error) {
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Parses `data` or throws a 422 AppError that carries the field errors. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw validationError(fieldErrors(result.error));
}

/** Middleware version: replaces req.body (or req.query) with the parsed value. */
export const validate = (schema, source = 'body') => (req, res, next) => {
  const parsed = parse(schema, req[source]);
  if (source === 'query') req.validQuery = parsed;
  else req[source] = parsed;
  next();
};

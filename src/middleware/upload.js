// Safe upload of payment proofs:
//   • max MAX_UPLOAD_MB, one file
//   • stored outside the public folder with a random name
//   • real type checked from the file's bytes (not the browser's claim): jpeg/png/webp/pdf
//   • CSRF verified right after multer parses the multipart body
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import { env } from '../config/env.js';
import { verifyCsrf } from './csrf.js';
import { AppError, badRequest } from '../utils/errors.js';
import { randomToken } from '../utils/codes.js';
import { t } from '../locales/ar.js';

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);
const SUBDIR = 'payment-proofs';
const directory = path.resolve(env.UPLOAD_DIR, SUBDIR);
fs.mkdirSync(directory, { recursive: true });

const parser = multer({
  storage: multer.diskStorage({
    destination: directory,
    filename: (req, file, cb) => cb(null, randomToken(16)),
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (req, file, cb) =>
    ALLOWED.has(file.mimetype) ? cb(null, true) : cb(badRequest(t('payment.invalidFile'))),
});

export async function discardUpload(req) {
  const file = req.proof?.absolute ?? req.file?.path;
  if (file) await fsp.rm(file, { force: true });
}

/** Parses the form, checks CSRF and the file, then sets req.proof = { relativePath, mime, size }. */
export function paymentProofUpload(req, res, next) {
  parser.single('proof')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest(t('payment.fileTooLarge')));
      return next(err instanceof AppError ? err : badRequest(t('payment.invalidFile')));
    }
    verifyCsrf(req, res, async (csrfErr) => {
      try {
        if (csrfErr) {
          await discardUpload(req);
          return next(csrfErr);
        }
        if (!req.file) return next();
        const type = await fileTypeFromFile(req.file.path);
        if (!type || !ALLOWED.has(type.mime)) {
          await discardUpload(req);
          return next(badRequest(t('payment.invalidFile')));
        }
        const name = `${req.file.filename}.${ALLOWED.get(type.mime)}`;
        const absolute = path.join(directory, name);
        await fsp.rename(req.file.path, absolute);
        req.proof = { relativePath: `${SUBDIR}/${name}`, mime: type.mime, size: req.file.size, absolute };
        next();
      } catch (e) {
        next(e);
      }
    });
  });
}

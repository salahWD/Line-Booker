// Errors that services throw on purpose. The error handler turns them into an
// Arabic message + HTTP status; any other error becomes a generic 500.
export class AppError extends Error {
  /**
   * @param {string} message  Arabic message safe to show to the user
   * @param {number} status   HTTP status code
   * @param {string} code     short machine-readable code
   */
  constructor(message, status = 400, code = 'bad_request', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (msg, details) => new AppError(msg, 400, 'bad_request', details);
export const unauthorized = (msg = 'يرجى تسجيل الدخول أولاً.') => new AppError(msg, 401, 'unauthorized');
export const forbidden = (msg = 'ليست لديك صلاحية لهذا الإجراء.') => new AppError(msg, 403, 'forbidden');
// 404 is also used for "exists but belongs to another business" so IDs cannot be probed.
export const notFound = (msg = 'العنصر غير موجود.') => new AppError(msg, 404, 'not_found');
export const conflict = (msg) => new AppError(msg, 409, 'conflict');
export const validationError = (details, msg = 'يرجى تصحيح الحقول المظللة.') =>
  new AppError(msg, 422, 'validation', details);
export const tooMany = (msg) => new AppError(msg, 429, 'rate_limited');

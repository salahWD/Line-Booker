// Numeric route parameters (:id, :lineId, …) must be positive integers.
// Anything else is answered with 404 before reaching controllers or the database.
import { notFound } from '../utils/errors.js';

const ID_PARAMS = ['id', 'lineId', 'branchId', 'ticketId', 'slotId', 'holidayId'];

export function numericIdParams(router) {
  for (const name of ID_PARAMS) {
    router.param(name, (req, res, next, value) => {
      next(/^[1-9]\d{0,9}$/.test(value) ? undefined : notFound());
    });
  }
  return router;
}

// Shared enum values. The database enums (models/schema/enums.js) are built from these lists,
// so the allowed values live in exactly one place.

export const ROLES = ['platform_admin', 'business_owner', 'branch_operator', 'customer'];
export const STAFF_ROLES = ['platform_admin', 'business_owner', 'branch_operator'];

export const CURRENCIES = ['USD', 'LBP'];
export const FEE_TYPES = ['deposit', 'full'];

// ── Live lines ────────────────────────────────────────
export const QUEUE_POLICIES = ['fifo', 'booked_first', 'interleave'];
export const TICKET_SOURCES = ['walk_in', 'appointment'];
export const PRIORITY_GROUPS = ['appointment', 'walk_in'];
export const TICKET_STATUSES = ['waiting', 'called', 'completed', 'skipped', 'cancelled', 'expired'];
export const ACTIVE_TICKET_STATUSES = ['waiting', 'called'];
export const ALERT_LEAD_CHOICES = [10, 15, 20, 30, 45, 60];

// ── Appointments ──────────────────────────────────────
export const APPOINTMENT_STATUSES = ['held', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show', 'expired'];
// Statuses that occupy a slot (count against capacity).
export const ACTIVE_APPOINTMENT_STATUSES = ['held', 'confirmed', 'checked_in'];
export const PAYMENT_STATUSES = ['not_required', 'unpaid', 'awaiting_verification', 'confirmed', 'rejected'];
export const SUBMISSION_STATUSES = ['pending', 'confirmed', 'rejected'];

// ── Notes & notifications ─────────────────────────────
export const NOTE_KINDS = ['customer', 'internal', 'shared'];
export const NOTIFICATION_CHANNELS = ['sms', 'push'];
export const NOTIFICATION_KINDS = [
  'otp',
  'hold_created',
  'appointment_confirmed',
  'payment_submitted',
  'payment_rejected',
  'hold_expired',
  'appointment_cancelled',
  'reminder',
  'ticket_created',
  'turn_approaching',
  'your_turn',
];
export const NOTIFICATION_STATUSES = ['queued', 'sending', 'sent', 'delivered', 'failed'];

// Upper bounds that keep bulk operations reasonable.
export const LIMITS = {
  slotGeneratorMaxDays: 92,
  bookingWindowDays: 60,
  listPageSize: 100,
};

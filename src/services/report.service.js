// Reports for owners (per branch / line) and the platform admin (settlement).
import * as reportModel from '../models/report.model.js';
import * as misc from '../models/misc.model.js';
import * as userModel from '../models/user.model.js';
import * as businessModel from '../models/business.model.js';
import * as branchModel from '../models/branch.model.js';
import * as paymentModel from '../models/payment.model.js';
import * as ticketModel from '../models/ticket.model.js';
import * as access from './access.service.js';
import { dateRange, addDays } from '../utils/dates.js';
import { badRequest } from '../utils/errors.js';

const isoToday = () => new Date().toISOString().slice(0, 10);

/** Default period: last 30 days. Periods are capped at one year. */
export function normalizePeriod({ from, to }) {
  const end = to || isoToday();
  const start = from || addDays(end, -29);
  if (start > end) throw badRequest('تاريخ البداية يجب أن يسبق تاريخ النهاية.');
  if (dateRange(start, end).length > 366) throw badRequest('أقصى فترة للتقرير سنة واحدة.');
  return { from: start, to: end };
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

/** Full owner report: per branch/line tables, totals and daily chart series. */
export async function ownerReport(user, query) {
  access.assertOwnerOf(user, user.businessId);
  const period = normalizePeriod(query);
  const f = { ...period, businessId: user.businessId, branchId: query.branchId || null, lineId: query.lineId || null };

  const [appointments, fees, tickets, apptDaily, ticketDaily] = await Promise.all([
    reportModel.appointmentSummary(f),
    reportModel.feeSummary(f),
    reportModel.ticketSummary(f),
    reportModel.appointmentsDaily(f),
    reportModel.ticketsDaily(f),
  ]);

  const sum = (list, key) => list.reduce((s, r) => s + (r[key] ?? 0), 0);
  const attendedBase = sum(appointments, 'completed') + sum(appointments, 'no_show');
  const estimated = sum(tickets, 'estimated');

  // Fill missing days with zeros so charts have a continuous axis.
  const days = dateRange(period.from, period.to);
  const apptByDay = Object.fromEntries(apptDaily.map((r) => [r.day, r]));
  const ticketByDay = Object.fromEntries(ticketDaily.map((r) => [r.day, r]));
  const daily = days.map((day) => ({
    day,
    completed: apptByDay[day]?.completed ?? 0,
    noShow: apptByDay[day]?.no_show ?? 0,
    cancelled: apptByDay[day]?.cancelled ?? 0,
    open: apptByDay[day]?.open ?? 0,
    tickets: ticketByDay[day]?.tickets ?? 0,
    avgWait: ticketByDay[day]?.avg_wait ?? null,
  }));

  return {
    period,
    filters: { branchId: f.branchId, lineId: f.lineId },
    appointments: appointments.map((r) => ({ ...r, attendanceRate: pct(r.completed, r.completed + r.no_show) })),
    fees,
    tickets: tickets.map((r) => ({ ...r, accuracy: pct(r.within_range, r.estimated) })),
    totals: {
      appointments: sum(appointments, 'total'),
      completed: sum(appointments, 'completed'),
      noShow: sum(appointments, 'no_show'),
      cancelled: sum(appointments, 'cancelled'),
      expired: sum(appointments, 'expired'),
      attendanceRate: pct(sum(appointments, 'completed'), attendedBase),
      tickets: sum(tickets, 'total'),
      walkIns: sum(tickets, 'walk_ins'),
      fromAppointments: sum(tickets, 'from_appointments'),
      served: sum(tickets, 'served'),
      accuracy: pct(sum(tickets, 'within_range'), estimated),
    },
    daily,
  };
}

export async function settlementReport(admin, query) {
  access.assertPlatformAdmin(admin);
  const period = normalizePeriod(query);
  return { period, rows: await reportModel.settlement(period) };
}

export async function ownerDashboard(user) {
  return reportModel.ownerToday(user.businessId);
}

export async function adminOverview() {
  const [businesses, branches, roles, pendingPayments, ticketsToday] = await Promise.all([
    businessModel.count(),
    branchModel.count(),
    userModel.countByRole(),
    paymentModel.countPending(),
    ticketModel.countToday(),
  ]);
  return { businesses, branches, customers: roles.customer ?? 0, pendingPayments, ticketsToday };
}

export const auditLog = (filters) => misc.listAudit(filters);

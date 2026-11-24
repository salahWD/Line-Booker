// Checks the critical workflows against the real database (run: `npm run check`).
// It creates its own isolated businesses/users, runs the checks through the same services
// the HTTP routes use, then deletes everything it created. Demo data is not touched.
//
//   1. Branch / business isolation
//   2. Simultaneous bookings (no overbooking) + slot release on expiry / rejection
//   3. Live-line transitions (ordering policy, invalid moves, concurrent "call next",
//      check-in without duplicate tickets, "approaching" alert sent once)
//   4. Note privacy
//   5. Payment confirmation permissions
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { pool } from '../src/config/db.js';
import * as userModel from '../src/models/user.model.js';
import * as businessModel from '../src/models/business.model.js';
import * as branchModel from '../src/models/branch.model.js';
import * as lineModel from '../src/models/line.model.js';
import * as slotModel from '../src/models/slot.model.js';
import * as appointmentModel from '../src/models/appointment.model.js';
import * as access from '../src/services/access.service.js';
import * as appointments from '../src/services/appointment.service.js';
import * as payments from '../src/services/payment.service.js';
import * as lineService from '../src/services/line.service.js';
import * as alerts from '../src/services/alert.service.js';
import * as notes from '../src/services/note.service.js';
import { orderQueue, orderedWaiting } from '../src/services/queueOrder.service.js';
import { randomToken } from '../src/utils/codes.js';

const TZ = 'Asia/Beirut';
const tag = Date.now().toString(36);
const created = { businesses: [], users: [] };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

/** Expects the promise to fail with an HTTP-like status. */
async function rejectsWith(promise, status) {
  try {
    await promise;
  } catch (err) {
    assert.equal(err.status, status, `expected ${status}, got ${err.status} (${err.message})`);
    return;
  }
  assert.fail(`expected an error with status ${status}, but it succeeded`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let phoneCounter = 0;
async function user(role, extra = {}) {
  phoneCounter += 1;
  const u = await userModel.create({
    role,
    name: `${role}-${tag}-${phoneCounter}`,
    phone: `+9618${String(Date.now() % 100000).padStart(5, '0')}${String(phoneCounter).padStart(2, '0')}`.slice(0, 13),
    ...extra,
  });
  created.users.push(u.id);
  return u;
}

async function business(name) {
  const b = await businessModel.create({ name, slug: `check-${tag}-${created.businesses.length}` });
  created.businesses.push(b.id);
  return b;
}

async function branch(biz, fields) {
  return branchModel.create({
    businessId: biz.id,
    name: `فرع ${tag}`,
    slug: `check-${tag}-${randomToken(4).toLowerCase()}`,
    city: 'بيروت',
    timezone: TZ,
    displayToken: randomToken(),
    minNoticeMinutes: 0,
    ...fields,
  });
}

async function line(br, fields = {}) {
  return lineModel.create({
    businessId: br.businessId,
    branchId: br.id,
    name: `دور ${tag}`,
    codePrefix: 'Q',
    avgMinutesPerCustomer: 10,
    displayToken: randomToken(),
    ...fields,
  });
}

async function slotAt(ln, startsAt, capacity = 1) {
  const dt = DateTime.fromJSDate(startsAt).setZone(TZ);
  await slotModel.insertMany([
    {
      businessId: ln.businessId,
      branchId: ln.branchId,
      lineId: ln.id,
      startsAt,
      localDate: dt.toISODate(),
      localTime: dt.toFormat('HH:mm'),
      durationMinutes: 20,
      capacity,
    },
  ]);
  const { rows } = await pool.query('select id from appointment_slots where line_id = $1 and starts_at = $2', [ln.id, startsAt]);
  return rows[0].id;
}

// Each check books on its own day (a customer may hold only one active appointment per line per day).
const dayAt = (daysAhead, hh = 10) => DateTime.now().setZone(TZ).plus({ days: daysAhead }).set({ hour: hh, minute: 0, second: 0, millisecond: 0 }).toJSDate();

async function cleanup() {
  const biz = created.businesses;
  const users = created.users;
  // $1 = business ids, $2 = user ids (each query gets exactly the parameters it uses).
  const q = (text) => {
    const usesBiz = text.includes('$1');
    const usesUsers = text.includes('$2');
    if (usesBiz && usesUsers) return pool.query(text, [biz, users]);
    if (usesBiz) return pool.query(text, [biz]);
    return pool.query(text.replaceAll('$2', '$1'), [users]);
  };
  await q(`delete from notifications where user_id = any($2::int[])
           or ticket_id in (select id from queue_tickets where business_id = any($1::int[]))
           or appointment_id in (select id from appointments where business_id = any($1::int[]))`);
  await q('delete from notes where business_id = any($1::int[]) or author_id = any($2::int[])');
  await q('delete from reviews where business_id = any($1::int[])');
  await q('delete from payment_submissions where appointment_id in (select id from appointments where business_id = any($1::int[]))');
  await q('delete from queue_tickets where business_id = any($1::int[])');
  await q('delete from appointments where business_id = any($1::int[])');
  await q('delete from appointment_slots where business_id = any($1::int[])');
  await q('delete from queue_counters where line_id in (select id from lines where business_id = any($1::int[]))');
  await q('delete from line_pauses where line_id in (select id from lines where business_id = any($1::int[]))');
  await q('delete from lines where business_id = any($1::int[])');
  await q('delete from operator_branches where user_id = any($2::int[])');
  await q('delete from push_tokens where user_id = any($2::int[])');
  await q('delete from audit_logs where business_id = any($1::int[]) or actor_user_id = any($2::int[])');
  await q('delete from branches where business_id = any($1::int[])');
  await q('delete from otp_codes where phone in (select phone from users where id = any($2::int[]))');
  await q('delete from users where id = any($2::int[])');
  await q('delete from businesses where id = any($1::int[])');
}

// ─── Setup ───────────────────────────────────────────────────────────────────

/** Two businesses (A, B), two branches in A (paid / free), lines, staff and customers. */
async function createFixtures() {
  const admin = await user('platform_admin');
  const bizA = await business('مؤسسة الفحص أ');
  const bizB = await business('مؤسسة الفحص ب');
  const ownerA = await user('business_owner', { businessId: bizA.id });
  const ownerB = await user('business_owner', { businessId: bizB.id });

  // A1: paid appointments (10 USD). A2: free appointments, used for the live-line checks.
  const branchA1 = await branch(bizA, { feeAmount: '10.00', currency: 'USD', feeType: 'deposit' });
  const branchA2 = await branch(bizA, { feeAmount: '0' });
  const lineA1 = await line(branchA1);
  const lineA2 = await line(branchA2, { queuePolicy: 'interleave', interleaveRatio: 2, countersCount: 2 });

  const operatorA1 = await user('branch_operator', { businessId: bizA.id });
  await userModel.setOperatorBranches(operatorA1.id, [branchA1.id]);
  const operatorQ1 = await user('branch_operator', { businessId: bizA.id });
  const operatorQ2 = await user('branch_operator', { businessId: bizA.id });
  await userModel.setOperatorBranches(operatorQ1.id, [branchA2.id]);
  await userModel.setOperatorBranches(operatorQ2.id, [branchA2.id]);

  const customers = [];
  for (let i = 0; i < 24; i += 1) customers.push(await user('customer', { name: `زبون ${i + 1}` }));

  return { admin, ownerA, ownerB, branchA1, branchA2, lineA1, lineA2, operatorA1, operatorQ1, operatorQ2, customers };
}

console.log(`\nCritical workflow checks (fixtures tagged "${tag}")\n`);

try {
  const { admin, ownerA, ownerB, branchA1, branchA2, lineA1, lineA2, operatorA1, operatorQ1, operatorQ2, customers } = await createFixtures();

  // ─── 1. Isolation ──────────────────────────────────────────────────────────
  console.log('1. Branch & business isolation');
  const sampleSlot = await slotAt(lineA1, dayAt(5));
  const sample = await appointments.hold(customers[0], lineA1.id, { slotId: sampleSlot });

  await check("another business's owner cannot load the branch (404)", () => rejectsWith(access.getBranchForStaff(ownerB, branchA1.id), 404));
  await check("another business's owner cannot open the line console (404)", () => rejectsWith(lineService.operatorView(ownerB, lineA1.id), 404));
  await check("another business's owner cannot call tickets (404)", () => rejectsWith(lineService.callNext(ownerB, lineA1.id), 404));
  await check("another business's owner cannot view the appointment (404)", () => rejectsWith(appointments.staffView(ownerB, sample.id), 404));
  await check("another business's owner cannot add notes (404)", () => rejectsWith(notes.addStaffNote(ownerB, { appointmentId: sample.id }, 'internal', 'x'), 404));
  await check('operator cannot open a line of an unassigned branch, same business (404)', () => rejectsWith(lineService.operatorView(operatorA1, lineA2.id), 404));
  await check('operator can open the line of their own branch', async () => {
    const view = await lineService.operatorView(operatorA1, lineA1.id);
    assert.equal(view.line.id, lineA1.id);
  });
  await check('owner sees only their own branches', async () => {
    const ids = await access.accessibleBranchIds(ownerA);
    assert.deepEqual(new Set(ids), new Set([branchA1.id, branchA2.id]));
  });
  await check('customer cannot view another customer\'s appointment (404)', () => rejectsWith(appointments.customerView(customers[1], sample.reference), 404));

  // ─── 2. Simultaneous bookings ──────────────────────────────────────────────
  console.log('2. Simultaneous bookings');
  await check('20 parallel bookings on a capacity-1 slot → exactly 1 succeeds', async () => {
    const slotId = await slotAt(lineA1, dayAt(1), 1);
    const results = await Promise.allSettled(customers.slice(2, 22).map((c) => appointments.hold(c, lineA1.id, { slotId })));
    const ok = results.filter((r) => r.status === 'fulfilled');
    assert.equal(ok.length, 1, `${ok.length} bookings succeeded`);
    assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 409), 'losers get 409');
    const slot = await slotModel.findById(slotId);
    assert.equal(slot.reservedCount, 1);
  });
  await check('20 parallel bookings on a capacity-3 slot → exactly 3 succeed', async () => {
    const slotId = await slotAt(lineA1, dayAt(2), 3);
    const results = await Promise.allSettled(customers.slice(2, 22).map((c) => appointments.hold(c, lineA1.id, { slotId })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
    assert.equal((await slotModel.findById(slotId)).reservedCount, 3);
  });
  await check('an expired unpaid hold releases the slot so someone else can book it', async () => {
    const slotId = await slotAt(lineA1, dayAt(3), 1);
    const held = await appointments.hold(customers[2], lineA1.id, { slotId });
    await rejectsWith(appointments.hold(customers[3], lineA1.id, { slotId }), 409);
    await appointmentModel.update(held.id, { holdExpiresAt: new Date(Date.now() - 1000) });
    assert.equal(await appointments.expireHold(held.id), true);
    assert.equal((await appointmentModel.findById(held.id)).status, 'expired');
    assert.equal((await slotModel.findById(slotId)).reservedCount, 0);
    const second = await appointments.hold(customers[3], lineA1.id, { slotId });
    assert.equal(second.status, 'held');
  });
  await check('a rejected payment cancels the booking and releases the slot', async () => {
    const slotId = await slotAt(lineA1, dayAt(4), 1);
    const held = await appointments.hold(customers[4], lineA1.id, { slotId });
    const submission = await payments.submitTransfer(customers[4], held.reference, { transactionRef: 'WH-REJECT-1' });
    await payments.rejectPayment(admin, submission.id, 'لم يصل المبلغ');
    const after = await appointmentModel.findById(held.id);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.paymentStatus, 'rejected');
    assert.equal((await slotModel.findById(slotId)).reservedCount, 0);
  });

  // ─── 3. Live-line transitions ──────────────────────────────────────────────
  console.log('3. Live lines');
  await check('ordering policies (pure function)', () => {
    const t = (id, group, minute) => ({ id, priorityGroup: group, sortAt: new Date(2026, 0, 1, 9, minute), joinedAt: new Date(2026, 0, 1, 9, minute) });
    const list = [t(1, 'walk_in', 1), t(2, 'appointment', 5), t(3, 'walk_in', 2), t(4, 'appointment', 6), t(5, 'appointment', 7)];
    assert.deepEqual(orderQueue(list, { policy: 'fifo' }).map((x) => x.id), [1, 3, 2, 4, 5]);
    assert.deepEqual(orderQueue(list, { policy: 'booked_first' }).map((x) => x.id), [2, 4, 5, 1, 3]);
    assert.deepEqual(orderQueue(list, { policy: 'interleave', ratio: 2 }).map((x) => x.id), [2, 4, 1, 5, 3]);
    // Two appointment holders were just called → a walk-in is next.
    assert.deepEqual(orderQueue(list, { policy: 'interleave', ratio: 2, recentGroups: ['appointment', 'appointment'] }).map((x) => x.id), [1, 2, 4, 3, 5]);
  });

  // Today's appointment slot on the free branch (confirmed immediately) for check-ins.
  const soon = DateTime.now().setZone(TZ).plus({ minutes: 20 }).startOf('minute').toJSDate();
  const todaySlot = await slotAt(lineA2, soon, 10);
  const [a1, a2, a3, w1, w2, w3, c7, c8] = customers;
  const appts = [];
  for (const c of [a1, a2, a3]) appts.push(await appointments.hold(c, lineA2.id, { slotId: todaySlot }));
  for (const [i, ap] of appts.entries()) await lineService.checkIn([a1, a2, a3][i], ap.id);
  for (const c of [w1, w2, w3]) await lineService.joinAsCustomer(c, lineA2.id);

  await check('interleave 2:1 orders the real line correctly', async () => {
    const ordered = await orderedWaiting(lineA2, TZ);
    const byCustomer = ordered.map((x) => x.customerId);
    assert.deepEqual(byCustomer, [a1.id, a2.id, w1.id, a3.id, w2.id, w3.id]);
  });

  let calledA;
  let calledB;
  await check('two operators pressing "call next" together get different tickets', async () => {
    [calledA, calledB] = await Promise.all([
      lineService.callNext(operatorQ1, lineA2.id, 'شباك 1'),
      lineService.callNext(operatorQ2, lineA2.id, 'شباك 2'),
    ]);
    assert.ok(calledA && calledB, 'both calls returned a ticket');
    assert.notEqual(calledA.id, calledB.id);
    assert.deepEqual(new Set([calledA.customerId, calledB.customerId]), new Set([a1.id, a2.id]));
    assert.ok(calledA.actualWaitSeconds !== null, 'actual wait recorded');
  });
  await check('invalid transitions are rejected (409)', async () => {
    const waiting = (await orderedWaiting(lineA2, TZ))[0];
    await rejectsWith(lineService.complete(operatorQ1, waiting.id), 409); // waiting → completed
    await rejectsWith(lineService.restore(operatorQ1, waiting.id), 409); // waiting → restore
    await lineService.complete(operatorQ1, calledA.id);
    await rejectsWith(lineService.recall(operatorQ1, calledA.id), 409); // completed → recall
    await rejectsWith(lineService.complete(operatorQ1, calledA.id), 409); // completed twice
  });
  await check('completing an appointment ticket completes the appointment', async () => {
    const ap = await appointmentModel.findById(calledA.appointmentId);
    assert.equal(ap.status, 'completed');
  });
  await check('skip → restore puts the ticket back in the line', async () => {
    await lineService.skip(operatorQ1, calledB.id);
    await lineService.restore(operatorQ1, calledB.id);
    const ordered = await orderedWaiting(lineA2, TZ);
    assert.ok(ordered.some((x) => x.id === calledB.id));
  });
  await check('joining twice returns the same ticket (no duplicate)', async () => {
    const first = await lineService.joinAsCustomer(w1, lineA2.id);
    assert.equal(first.outcome, 'existing');
  });
  await check('walk-in ticket is upgraded on check-in instead of creating a second ticket', async () => {
    const walkIn = (await lineService.joinAsCustomer(c7, lineA2.id)).ticket;
    const ap = await appointments.hold(c7, lineA2.id, { slotId: todaySlot });
    const ticket = await lineService.checkIn(c7, ap.id);
    assert.equal(ticket.id, walkIn.id);
    assert.equal(ticket.source, 'appointment');
    const again = await lineService.checkIn(c7, ap.id);
    assert.equal(again.id, walkIn.id);
    const { rows } = await pool.query("select count(*)::int as n from queue_tickets where line_id = $1 and customer_id = $2 and status in ('waiting','called')", [lineA2.id, c7.id]);
    assert.equal(rows[0].n, 1);
  });
  await check('"take a number" with an appointment today becomes a check-in', async () => {
    await appointments.hold(c8, lineA2.id, { slotId: todaySlot });
    const result = await lineService.joinAsCustomer(c8, lineA2.id);
    assert.equal(result.outcome, 'checked_in');
    assert.equal(result.ticket.source, 'appointment');
  });
  await check('staff cancelling a checked-in appointment also removes its ticket from the line', async () => {
    const ap = await appointmentModel.findForCustomerLineDay(c8.id, lineA2.id, DateTime.now().setZone(TZ).toISODate());
    await appointments.cancelByStaff(operatorQ1, ap.id, 'طلب الزبون');
    assert.equal((await appointmentModel.findById(ap.id)).status, 'cancelled');
    const { rows } = await pool.query("select status from queue_tickets where appointment_id = $1", [ap.id]);
    assert.deepEqual(rows.map((r) => r.status), ['cancelled']);
  });
  await check('"approaching" alert is sent at most once per ticket (parallel checks)', async () => {
    await Promise.all([alerts.checkLine(lineA2.id), alerts.checkLine(lineA2.id), alerts.checkLine(lineA2.id)]);
    const { rows } = await pool.query(
      `select ticket_id, count(*)::int as n from notifications
       where kind = 'turn_approaching' and ticket_id in (select id from queue_tickets where line_id = $1) group by ticket_id`,
      [lineA2.id],
    );
    assert.ok(rows.length > 0, 'some alerts were sent');
    assert.ok(rows.every((r) => r.n === 1), `duplicates: ${JSON.stringify(rows)}`);
  });
  await check('"your turn" notification is queued when a ticket is called', async () => {
    const { rows } = await pool.query("select count(*)::int as n from notifications where kind = 'your_turn' and ticket_id = $1", [calledA.id]);
    assert.ok(rows[0].n >= 1);
  });

  // ─── 4. Note privacy ───────────────────────────────────────────────────────
  console.log('4. Note privacy');
  await check('customer view never contains internal notes', async () => {
    await notes.addStaffNote(operatorA1, { appointmentId: sample.id }, 'internal', 'سري: للموظفين فقط');
    await notes.addStaffNote(operatorA1, { appointmentId: sample.id }, 'shared', 'مرئي للزبون');
    await notes.addCustomerNote(customers[0], { appointmentId: sample.id }, 'ملاحظة الزبون');
    const view = await appointments.customerView(customers[0], sample.reference);
    const kinds = view.notes.map((n) => n.kind).sort();
    assert.deepEqual(kinds, ['customer', 'shared']);
    assert.ok(!view.notes.some((n) => n.body.includes('سري')));
    const staff = await appointments.staffView(operatorA1, sample.id);
    assert.equal(staff.notes.length, 3);
  });
  await check('customers cannot write internal or shared notes', async () => {
    await rejectsWith(notes.addStaffNote(customers[0], { appointmentId: sample.id }, 'internal', 'x'), 404);
    const note = await notes.addCustomerNote(customers[0], { appointmentId: sample.id }, 'y');
    assert.equal(note.kind, 'customer');
  });
  await check("customers cannot add notes to someone else's appointment", () =>
    rejectsWith(notes.addCustomerNote(customers[1], { appointmentId: sample.id }, 'z'), 404));

  // ─── 5. Payment confirmation permissions ───────────────────────────────────
  console.log('5. Payment confirmation');
  const submission = await payments.submitTransfer(customers[0], sample.reference, { transactionRef: 'WH-CHECK-1' });
  await check('submitting a transfer only sets "awaiting verification"', async () => {
    const a = await appointmentModel.findById(sample.id);
    assert.equal(a.status, 'held');
    assert.equal(a.paymentStatus, 'awaiting_verification');
    assert.equal(a.paymentConfirmedAt, null);
    assert.equal(a.holdExpiresAt, null, 'slot stays reserved until the admin decides');
  });
  await check('customer cannot confirm (403)', () => rejectsWith(payments.confirmPayment(customers[0], submission.id), 403));
  await check('business owner cannot confirm (403)', () => rejectsWith(payments.confirmPayment(ownerA, submission.id), 403));
  await check('branch operator cannot confirm (403)', () => rejectsWith(payments.confirmPayment(operatorA1, submission.id), 403));
  await check('platform admin confirms; who and when are recorded and audited', async () => {
    await payments.confirmPayment(admin, submission.id, '127.0.0.1');
    const a = await appointmentModel.findById(sample.id);
    assert.equal(a.status, 'confirmed');
    assert.equal(a.paymentStatus, 'confirmed');
    assert.equal(a.paymentConfirmedById, admin.id);
    assert.ok(a.paymentConfirmedAt instanceof Date);
    const { rows } = await pool.query("select count(*)::int as n from audit_logs where action = 'payment.confirm' and entity_id = $1", [submission.id]);
    assert.equal(rows[0].n, 1);
  });
  await check('confirming twice is refused (409)', () => rejectsWith(payments.confirmPayment(admin, submission.id), 409));
} finally {
  // Let background alert checks (fired after each queue change) finish before deleting fixtures.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await cleanup();
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} passed, ${failed} failed\n`);
await pool.end();
process.exit(failed ? 1 : 0);

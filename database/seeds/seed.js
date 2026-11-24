// Demo data (Arabic, Lebanon): two fictional businesses, branches, lines, staff, customers,
// 30 days of simulated history (for reports and waiting estimates), live queues for today,
// and appointments in every state. Run on an empty database: `npm run db:reset`.
import { DateTime } from 'luxon';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from '../../src/config/db.js';
import * as s from '../../src/models/schema/index.js';
import { randomToken, appointmentReference, ticketDisplayCode } from '../../src/utils/codes.js';

const TZ = 'Asia/Beirut';
const NOW = DateTime.now().setZone(TZ);
const TODAY = NOW.toISODate();

// ── Deterministic randomness (same data on every run) ─────────────
let state = 20261123;
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;

const hash = (password) => bcrypt.hashSync(password, 10);
const local = (date, hhmm) => DateTime.fromISO(`${date}T${hhmm}`, { zone: TZ });

// ── Safety check ─────────────────────────────────────────────────
const [{ n }] = (await db.execute(sql`select count(*)::int as n from users`)).rows;
if (n > 0) {
  console.error('The database already has data. Run `npm run db:reset` to rebuild it with demo data.');
  await pool.end();
  process.exit(1);
}

// ── Platform ─────────────────────────────────────────────────────
const [admin] = await db
  .insert(s.users)
  .values({ role: 'platform_admin', name: 'إدارة المنصة', email: 'admin@dawri.test', phone: '+96170000001', passwordHash: hash('Admin@2026') })
  .returning();

await db.insert(s.platformSettings).values({
  id: 1,
  // Placeholder — the platform admin must replace it with the real Whish Money link (Admin → Settings).
  whishPaymentUrl: 'https://example.com/replace-with-platform-whish-link',
  paymentInstructions: 'بعد إتمام التحويل احتفظ بصورة الإيصال. يتم التحقق خلال ساعات العمل (9 صباحاً – 6 مساءً).',
  defaultHoldMinutes: 30,
  updatedById: admin.id,
});

// ── Businesses, owners, branches, lines ──────────────────────────
const businessesData = [
  {
    business: { name: 'مستشفى الأرز التخصصي', slug: 'arz-hospital', phone: '+9611350000', description: 'مستشفى خاص متعدد الاختصاصات' },
    owner: { name: 'سامي حداد', email: 'owner@arz.test', phone: '+96171000001' },
    branches: [
      {
        name: 'فرع الحمرا — بيروت',
        slug: 'arz-hamra',
        city: 'بيروت',
        address: 'شارع الحمرا، بناية الأرز، الطابق الثاني',
        phone: '+9611350001',
        feeAmount: '15.00',
        currency: 'USD',
        feeType: 'deposit',
        cancellationPolicyText: 'يمكن الإلغاء مجاناً قبل 24 ساعة. العربون غير مسترد عند الإلغاء المتأخر أو عدم الحضور.',
        hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, openTime: '00:00', closeTime: '23:59' })), // hospital: open 24/7
        lines: [
          { name: 'عيادة الأطفال', codePrefix: 'A', description: 'د. ريما سليمان — طب الأطفال', avgMinutesPerCustomer: 12, countersCount: 1, queuePolicy: 'interleave', slots: { minutes: 20, from: '09:00', to: '13:00', capacity: 1 } },
          { name: 'عيادة القلب', codePrefix: 'C', description: 'د. وليد عساف — أمراض القلب', avgMinutesPerCustomer: 15, countersCount: 1, queuePolicy: 'booked_first', slots: { minutes: 30, from: '10:00', to: '14:00', capacity: 1 } },
          { name: 'المختبر', codePrefix: 'L', description: 'فحوصات الدم والتحاليل — دون موعد', avgMinutesPerCustomer: 6, countersCount: 2, queuePolicy: 'fifo', slots: null },
        ],
      },
      {
        name: 'فرع جونية',
        slug: 'arz-jounieh',
        city: 'جونية',
        address: 'الأوتوستراد البحري، مقابل الملعب البلدي',
        phone: '+9619640000',
        feeAmount: '10.00',
        currency: 'USD',
        feeType: 'deposit',
        hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, openTime: '08:00', closeTime: '16:00' })).concat([{ weekday: 6, openTime: '08:00', closeTime: '13:00' }]),
        holiday: { offsetDays: 9, reason: 'عطلة رسمية' },
        lines: [
          { name: 'الطب العام', codePrefix: 'G', avgMinutesPerCustomer: 10, countersCount: 2, queuePolicy: 'interleave', slots: { minutes: 15, from: '08:30', to: '12:30', capacity: 2 } },
        ],
      },
    ],
    operators: [
      { name: 'ريم خوري', email: 'reem@arz.test', phone: '+96171000002', branches: ['arz-hamra'] },
      { name: 'جاد نصر', email: 'jad@arz.test', phone: '+96171000003', branches: ['arz-hamra', 'arz-jounieh'] },
    ],
  },
  {
    business: { name: 'مركز النخبة لخدمات المعاملات', slug: 'nokhba-center', phone: '+9616430000', description: 'إنجاز المعاملات الرسمية وتصديق المستندات' },
    owner: { name: 'ليلى منصور', email: 'owner@nokhba.test', phone: '+96176000001' },
    branches: [
      {
        name: 'فرع طرابلس — التل',
        slug: 'nokhba-tripoli',
        city: 'طرابلس',
        address: 'ساحة التل، قرب برج الساعة',
        phone: '+9616430001',
        feeAmount: '5.00',
        currency: 'USD',
        feeType: 'full',
        hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, openTime: '08:00', closeTime: '15:00' })).concat([{ weekday: 6, openTime: '08:00', closeTime: '13:00' }]),
        lines: [
          { name: 'المعاملات العامة', codePrefix: 'T', avgMinutesPerCustomer: 8, countersCount: 2, queuePolicy: 'interleave', slots: { minutes: 15, from: '08:30', to: '13:30', capacity: 2 } },
          { name: 'تصديق المستندات', codePrefix: 'D', avgMinutesPerCustomer: 6, countersCount: 1, queuePolicy: 'fifo', slots: { minutes: 15, from: '09:00', to: '12:00', capacity: 1 } },
        ],
      },
      {
        name: 'فرع صيدا',
        slug: 'nokhba-saida',
        city: 'صيدا',
        address: 'شارع رياض الصلح، بناية النخبة',
        phone: '+9617720000',
        feeAmount: '450000',
        currency: 'LBP',
        feeType: 'full',
        allowReschedule: false,
        hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, openTime: '08:30', closeTime: '14:30' })),
        lines: [
          { name: 'المعاملات العامة', codePrefix: 'S', avgMinutesPerCustomer: 9, countersCount: 1, queuePolicy: 'interleave', slots: { minutes: 20, from: '09:00', to: '13:00', capacity: 1 } },
        ],
      },
    ],
    operators: [{ name: 'عمر الحسن', email: 'omar@nokhba.test', phone: '+96176000002', branches: ['nokhba-tripoli', 'nokhba-saida'] }],
  },
];

const customersData = [
  ['محمد عيتاني', '+96170123401'],
  ['فاطمة الزين', '+96170123402'],
  ['علي حمود', '+96170123403'],
  ['نور الهدى قاسم', '+96170123404'],
  ['كريم شمس', '+96170123405'],
  ['مايا سعادة', '+96170123406'],
  ['حسن بزي', '+96170123407'],
  ['لينا عبود', '+96170123408'],
  ['طارق ضاهر', '+96170123409'],
  ['رنا فرحات', '+96170123410'],
  ['جورج معلوف', '+96170123411'],
  ['سارة يموت', '+96170123412'],
];
const customers = await db
  .insert(s.users)
  .values(customersData.map(([name, phone]) => ({ role: 'customer', name, phone, phoneVerifiedAt: NOW.minus({ days: 40 }).toJSDate() })))
  .returning();
const demoCustomer = customers[0];

const guestNames = ['أبو أحمد', 'أم خليل', 'زياد', 'هالة', 'منى', 'يوسف', 'سمير', 'ديانا', 'إيلي', 'رامي', 'خديجة', 'وسام', 'ميشال', 'بلال', 'جنى'];

const allLines = []; // { line, branch, config }
const owners = {};
for (const data of businessesData) {
  const [business] = await db.insert(s.businesses).values(data.business).returning();
  const [owner] = await db
    .insert(s.users)
    .values({ role: 'business_owner', ...data.owner, passwordHash: hash('Owner@2026'), businessId: business.id })
    .returning();
  owners[business.slug] = owner;

  const branchBySlug = {};
  for (const b of data.branches) {
    const { hours, lines, holiday, ...fields } = b;
    const [branch] = await db
      .insert(s.branches)
      .values({ ...fields, businessId: business.id, timezone: TZ, displayToken: randomToken() })
      .returning();
    branchBySlug[branch.slug] = branch;
    await db.insert(s.branchHours).values(hours.map((h) => ({ ...h, branchId: branch.id })));
    if (holiday) await db.insert(s.branchHolidays).values({ branchId: branch.id, date: NOW.plus({ days: holiday.offsetDays }).toISODate(), reason: holiday.reason });

    for (const [index, l] of lines.entries()) {
      const { slots, ...lineFields } = l;
      const [line] = await db
        .insert(s.lines)
        .values({ ...lineFields, businessId: business.id, branchId: branch.id, sortOrder: index, displayToken: randomToken() })
        .returning();
      allLines.push({ line, branch, hours, slots, business });
    }
  }

  for (const op of data.operators) {
    const { branches: branchSlugs, ...fields } = op;
    const [operator] = await db
      .insert(s.users)
      .values({ role: 'branch_operator', ...fields, passwordHash: hash('Operator@2026'), businessId: business.id })
      .returning();
    await db.insert(s.operatorBranches).values(branchSlugs.map((slug) => ({ userId: operator.id, branchId: branchBySlug[slug].id })));
  }
}

// ── Helpers to create rows ───────────────────────────────────────
const counters = new Map(); // `${lineId}|${date}` → last number
function nextNumber(lineId, date) {
  const key = `${lineId}|${date}`;
  const value = (counters.get(key) ?? 0) + 1;
  counters.set(key, value);
  return value;
}

const slotCache = new Map(); // `${lineId}|${iso}` → slot row
async function ensureSlot(entry, startsAt, minutes, capacity = 1) {
  const key = `${entry.line.id}|${startsAt.toISO()}`;
  if (slotCache.has(key)) return slotCache.get(key);
  const [slot] = await db
    .insert(s.appointmentSlots)
    .values({
      businessId: entry.line.businessId,
      branchId: entry.line.branchId,
      lineId: entry.line.id,
      startsAt: startsAt.toJSDate(),
      localDate: startsAt.toISODate(),
      localTime: startsAt.toFormat('HH:mm'),
      durationMinutes: minutes,
      capacity,
    })
    .onConflictDoNothing()
    .returning();
  slotCache.set(key, slot);
  return slot;
}

async function reserve(slot) {
  await db.execute(sql`update appointment_slots set reserved_count = reserved_count + 1 where id = ${slot.id}`);
}

/** Estimate range exactly like estimate.service ("configured" method). */
function estimateAtJoin(ahead, line) {
  const pace = line.avgMinutesPerCustomer / line.countersCount;
  const mid = ahead * pace + pace / 2;
  let low = mid * 0.6;
  let high = mid * 1.7;
  if (high > 15) return [Math.floor(low / 5) * 5, Math.ceil(high / 5) * 5];
  return [Math.floor(low), Math.max(Math.ceil(high), Math.floor(low) + 1)];
}

async function createAppointment(entry, slot, customer, fields) {
  const [a] = await db
    .insert(s.appointments)
    .values({
      reference: appointmentReference(),
      slotId: slot.id,
      businessId: entry.line.businessId,
      branchId: entry.line.branchId,
      lineId: entry.line.id,
      customerId: customer.id,
      startsAt: slot.startsAt,
      localDate: slot.localDate,
      localTime: slot.localTime,
      amountDue: entry.branch.feeAmount,
      currency: entry.branch.currency,
      feeType: entry.branch.feeType,
      ...fields,
    })
    .returning();
  return a;
}

const txRef = () => `WH${int(10000000, 99999999)}`;

async function addEvents(appointmentId, events) {
  if (events.length) await db.insert(s.appointmentEvents).values(events.map((e) => ({ appointmentId, ...e })));
}

const reviewComments = {
  5: ['خدمة ممتازة والانتظار كان أقل من المتوقع 👏', 'التنبيه على الهاتف وصلني في الوقت المناسب، شكراً', 'منظم جداً، أنصح به', 'الطاقم لطيف والموعد التزم بالوقت'],
  4: ['تجربة جيدة، تأخير بسيط عن الموعد', 'جيد جداً لكن المكان كان مزدحماً', 'سهل الحجز والدفع'],
  3: ['مقبول، الانتظار كان أطول من التقدير', 'الخدمة جيدة لكن الموقف صعب'],
  2: ['تأخروا كثيراً عن موعدي'],
  1: ['لم يتم الالتزام بالموعد إطلاقاً'],
};
const ownerReplies = ['شكراً لملاحظتك، نسعد بخدمتك دائماً 🌷', 'نعتذر عن التأخير وسنعمل على تحسين التنظيم.', 'شكراً لثقتكم بنا!'];
const ratingFor = () => {
  const r = rand();
  return r < 0.5 ? 5 : r < 0.8 ? 4 : r < 0.92 ? 3 : r < 0.97 ? 2 : 1;
};

// ── 30 days of history ───────────────────────────────────────────
console.log('Simulating 30 days of activity…');
const isOpenDay = (entry, date) => entry.hours.some((h) => h.weekday === DateTime.fromISO(date).weekday);
const hoursOf = (entry, date) => {
  const h = entry.hours.find((x) => x.weekday === DateTime.fromISO(date).weekday);
  // The 24/7 hospital still has a realistic "busy window" for clinics.
  return h.openTime === '00:00' ? { open: '08:00', close: '15:00' } : { open: h.openTime, close: h.closeTime };
};

let reviewsCount = 0;
for (let back = 30; back >= 1; back -= 1) {
  const date = NOW.minus({ days: back }).toISODate();
  for (const entry of allLines) {
    if (!isOpenDay(entry, date)) continue;
    const { line, branch } = entry;
    const { open, close } = hoursOf(entry, date);
    const openAt = local(date, open);
    const lastJoin = local(date, close).minus({ minutes: 50 });
    const arrivals = [];

    // Appointments of that day (from slots).
    if (entry.slots) {
      const count = int(2, 5);
      const used = new Set();
      for (let i = 0; i < count; i += 1) {
        const startMin = int(0, Math.floor((local(date, entry.slots.to).diff(local(date, entry.slots.from), 'minutes').minutes - entry.slots.minutes) / entry.slots.minutes)) * entry.slots.minutes;
        const startsAt = local(date, entry.slots.from).plus({ minutes: startMin });
        if (used.has(startsAt.toISO())) continue;
        used.add(startsAt.toISO());
        const slot = await ensureSlot(entry, startsAt, entry.slots.minutes, entry.slots.capacity);
        const customer = pick(customers);
        const roll = rand();
        const status = roll < 0.72 ? 'completed' : roll < 0.82 ? 'no_show' : roll < 0.93 ? 'cancelled' : 'expired';
        const paid = status === 'completed' || status === 'no_show' || (status === 'cancelled' && chance(0.5));
        const bookedAt = startsAt.minus({ days: int(1, 6), hours: int(0, 8) });
        const confirmedAt = bookedAt.plus({ hours: int(1, 6) });
        const a = await createAppointment(entry, slot, customer, {
          status,
          paymentStatus: paid ? 'confirmed' : 'unpaid',
          paymentConfirmedById: paid ? admin.id : null,
          paymentConfirmedAt: paid ? confirmedAt.toJSDate() : null,
          confirmedAt: paid ? confirmedAt.toJSDate() : null,
          cancelledAt: status === 'cancelled' ? confirmedAt.plus({ hours: 5 }).toJSDate() : null,
          cancelledById: status === 'cancelled' ? customer.id : null,
          expiredAt: status === 'expired' ? bookedAt.plus({ minutes: 30 }).toJSDate() : null,
          noShowAt: status === 'no_show' ? startsAt.plus({ hours: 8 }).toJSDate() : null,
          createdAt: bookedAt.toJSDate(),
        });
        if (status !== 'expired') await reserve(slot);
        if (paid) {
          await db.insert(s.paymentSubmissions).values({
            appointmentId: a.id,
            customerId: customer.id,
            transactionRef: txRef(),
            status: 'confirmed',
            reviewedById: admin.id,
            reviewedAt: confirmedAt.toJSDate(),
            createdAt: bookedAt.plus({ minutes: 12 }).toJSDate(),
          });
        }
        const events = [{ type: 'held', actorUserId: customer.id, createdAt: bookedAt.toJSDate() }];
        if (paid) {
          events.push({ type: 'payment_submitted', actorUserId: customer.id, createdAt: bookedAt.plus({ minutes: 12 }).toJSDate() });
          events.push({ type: 'payment_confirmed', actorUserId: admin.id, createdAt: confirmedAt.toJSDate() });
        }
        if (status === 'expired') events.push({ type: 'expired', createdAt: bookedAt.plus({ minutes: 30 }).toJSDate() });
        if (status === 'cancelled') events.push({ type: 'cancelled', actorUserId: customer.id, createdAt: confirmedAt.plus({ hours: 5 }).toJSDate() });
        if (status === 'no_show') events.push({ type: 'no_show', createdAt: startsAt.plus({ hours: 8 }).toJSDate() });
        await addEvents(a.id, events);

        if (status === 'completed') {
          arrivals.push({ appointment: a, customer, joinedAt: startsAt.minus({ minutes: int(5, 20) }), priorityGroup: 'appointment', sortAt: startsAt });
          if (chance(0.35)) {
            const rating = ratingFor();
            await db.insert(s.reviews).values({
              appointmentId: a.id,
              businessId: a.businessId,
              branchId: a.branchId,
              lineId: a.lineId,
              customerId: customer.id,
              rating,
              comment: pick(reviewComments[rating]),
              ownerReply: chance(0.4) ? pick(ownerReplies) : null,
              repliedAt: null,
              createdAt: startsAt.plus({ hours: 3 }).toJSDate(),
            });
            reviewsCount += 1;
          }
        }
      }
    }

    // Walk-ins
    const walkIns = int(10, 26);
    const windowMinutes = lastJoin.diff(openAt, 'minutes').minutes;
    for (let i = 0; i < walkIns; i += 1) {
      const joinedAt = openAt.plus({ minutes: between(0, windowMinutes) });
      const customer = chance(0.4) ? pick(customers) : null;
      arrivals.push({ customer, guestName: customer ? null : pick(guestNames), joinedAt, priorityGroup: 'walk_in', sortAt: joinedAt });
    }
    arrivals.sort((x, y) => x.joinedAt - y.joinedAt);

    // Serve them with N counters (first come, first served is close enough for history).
    const free = Array.from({ length: line.countersCount }, () => openAt.plus({ minutes: 5 }));
    for (const arrival of arrivals) {
      free.sort((x, y) => x - y);
      const start = DateTime.max(arrival.joinedAt.plus({ minutes: 1 }), free[0]);
      const skipped = !arrival.appointment && chance(0.07);
      const duration = skipped ? 2 : line.avgMinutesPerCustomer * between(0.6, 1.45);
      arrival.calledAt = start;
      arrival.doneAt = start.plus({ minutes: duration });
      arrival.skipped = skipped;
      free[0] = arrival.doneAt;
    }
    const rows = arrivals.map((arrival) => {
      const ahead = arrivals.filter((o) => o.joinedAt < arrival.joinedAt && o.calledAt > arrival.joinedAt).length;
      const [low, high] = estimateAtJoin(ahead, line);
      const number = nextNumber(line.id, date);
      return {
        businessId: line.businessId,
        branchId: line.branchId,
        lineId: line.id,
        serviceDate: date,
        number,
        displayCode: ticketDisplayCode(line.codePrefix, number),
        source: arrival.appointment ? 'appointment' : 'walk_in',
        appointmentId: arrival.appointment?.id ?? null,
        customerId: arrival.customer?.id ?? null,
        guestName: arrival.guestName ?? null,
        phone: arrival.customer?.phone ?? null,
        priorityGroup: arrival.priorityGroup,
        sortAt: arrival.sortAt.toJSDate(),
        status: arrival.skipped ? 'skipped' : 'completed',
        joinedAt: arrival.joinedAt.toJSDate(),
        firstCalledAt: arrival.calledAt.toJSDate(),
        lastCalledAt: arrival.calledAt.toJSDate(),
        counterLabel: line.countersCount > 1 ? `شباك ${int(1, line.countersCount)}` : 'العيادة',
        completedAt: arrival.skipped ? null : arrival.doneAt.toJSDate(),
        closedAt: arrival.skipped ? arrival.doneAt.toJSDate() : null,
        trackingToken: randomToken(),
        alertLeadMinutes: line.defaultAlertLeadMinutes,
        approachAlertedAt: arrival.customer ? arrival.calledAt.minus({ minutes: 15 }).toJSDate() : null,
        estimateLowMin: low,
        estimateHighMin: high,
        estimateMethod: 'configured',
        actualWaitSeconds: Math.round(arrival.calledAt.diff(arrival.joinedAt, 'seconds').seconds),
      };
    });
    if (rows.length) await db.insert(s.queueTickets).values(rows);
    // Completed appointments were checked in through the line.
    for (const arrival of arrivals.filter((x) => x.appointment)) {
      await db
        .update(s.appointments)
        .set({ checkedInAt: arrival.joinedAt.toJSDate(), completedAt: arrival.doneAt.toJSDate() })
        .where(sql`id = ${arrival.appointment.id}`);
      await addEvents(arrival.appointment.id, [
        { type: 'checked_in', actorUserId: arrival.customer.id, createdAt: arrival.joinedAt.toJSDate() },
        { type: 'completed', createdAt: arrival.doneAt.toJSDate() },
      ]);
    }
  }
}

// ── Future free slots (next 21 days) ─────────────────────────────
console.log('Publishing free appointment slots…');
for (const entry of allLines) {
  if (!entry.slots) continue; // the lab works without appointments (shows the "no dates" state)
  const { slots: cfg } = entry;
  const rows = [];
  for (let ahead = 0; ahead <= 21; ahead += 1) {
    const date = NOW.plus({ days: ahead }).toISODate();
    if (!isOpenDay(entry, date)) continue;
    if (entry.branch.slug === 'arz-jounieh' && ahead === 9) continue; // holiday
    for (let at = local(date, cfg.from); at.plus({ minutes: cfg.minutes }) <= local(date, cfg.to); at = at.plus({ minutes: cfg.minutes })) {
      if (at <= NOW.plus({ minutes: 60 })) continue;
      rows.push({
        businessId: entry.line.businessId,
        branchId: entry.line.branchId,
        lineId: entry.line.id,
        startsAt: at.toJSDate(),
        localDate: date,
        localTime: at.toFormat('HH:mm'),
        durationMinutes: cfg.minutes,
        capacity: cfg.capacity,
      });
    }
  }
  if (rows.length) await db.insert(s.appointmentSlots).values(rows).onConflictDoNothing();
}

/** n-th free slot of a line, `daysAhead` days from now. */
async function futureSlot(entry, daysAhead, nth = 0) {
  const date = NOW.plus({ days: daysAhead }).toISODate();
  const result = await db.execute(sql`
    select * from appointment_slots
    where line_id = ${entry.line.id} and local_date >= ${date} and is_open and reserved_count < capacity and starts_at > now()
    order by starts_at offset ${nth} limit 1`);
  const row = result.rows[0];
  // Raw queries return timestamps as strings — convert for the typed insert.
  return row && { id: row.id, startsAt: new Date(row.starts_at), localDate: row.local_date, localTime: row.local_time };
}

const byName = (branchSlug, lineName) => allLines.find((e) => e.branch.slug === branchSlug && e.line.name === lineName);
const pediatrics = byName('arz-hamra', 'عيادة الأطفال');
const cardiology = byName('arz-hamra', 'عيادة القلب');
const lab = byName('arz-hamra', 'المختبر');
const jounieh = byName('arz-jounieh', 'الطب العام');
const tripoli = byName('nokhba-tripoli', 'المعاملات العامة');
const saida = byName('nokhba-saida', 'المعاملات العامة');

// ── Upcoming appointments in every state ─────────────────────────
console.log('Creating upcoming appointments…');
async function upcoming(entry, customer, daysAhead, nth, kind) {
  const slot = await futureSlot(entry, daysAhead, nth);
  if (!slot) return null;
  const bookedAt = NOW.minus({ hours: int(2, 30) });
  const base = { createdAt: bookedAt.toJSDate() };
  let fields;
  if (kind === 'confirmed') {
    fields = { ...base, status: 'confirmed', paymentStatus: 'confirmed', paymentConfirmedById: admin.id, paymentConfirmedAt: bookedAt.plus({ hours: 1 }).toJSDate(), confirmedAt: bookedAt.plus({ hours: 1 }).toJSDate() };
  } else if (kind === 'awaiting') {
    fields = { ...base, status: 'held', paymentStatus: 'awaiting_verification', holdExpiresAt: null };
  } else {
    fields = { ...base, createdAt: NOW.minus({ minutes: 5 }).toJSDate(), status: 'held', paymentStatus: 'unpaid', holdExpiresAt: NOW.plus({ minutes: 25 }).toJSDate() };
  }
  const a = await createAppointment(entry, slot, customer, fields);
  await reserve(slot);
  const events = [{ type: 'held', actorUserId: customer.id, createdAt: fields.createdAt }];
  if (kind !== 'held') {
    const submittedAt = bookedAt.plus({ minutes: 10 });
    await db.insert(s.paymentSubmissions).values({
      appointmentId: a.id,
      customerId: customer.id,
      transactionRef: txRef(),
      status: kind === 'confirmed' ? 'confirmed' : 'pending',
      reviewedById: kind === 'confirmed' ? admin.id : null,
      reviewedAt: kind === 'confirmed' ? bookedAt.plus({ hours: 1 }).toJSDate() : null,
      createdAt: submittedAt.toJSDate(),
    });
    events.push({ type: 'payment_submitted', actorUserId: customer.id, createdAt: submittedAt.toJSDate() });
    if (kind === 'confirmed') events.push({ type: 'payment_confirmed', actorUserId: admin.id, createdAt: bookedAt.plus({ hours: 1 }).toJSDate() });
  }
  await addEvents(a.id, events);
  return a;
}

// Demo customer (محمد): one confirmed, one waiting for the admin's verification.
const demoConfirmed = await upcoming(cardiology, demoCustomer, 2, 0, 'confirmed');
await upcoming(pediatrics, demoCustomer, 4, 1, 'awaiting');
// Others: a fresh unpaid hold and more submissions for the admin queue.
await upcoming(tripoli, customers[1], 1, 0, 'held');
await upcoming(tripoli, customers[2], 3, 2, 'awaiting');
await upcoming(jounieh, customers[3], 2, 3, 'awaiting');
await upcoming(saida, customers[4], 1, 1, 'confirmed');
for (const [i, entry] of [pediatrics, cardiology, jounieh, tripoli].entries()) {
  for (let k = 0; k < 3; k += 1) await upcoming(entry, customers[5 + ((i + k) % 7)], 1 + k, 4 + k, 'confirmed');
}

// Notes with different visibility on the demo customer's confirmed appointment.
if (demoConfirmed) {
  const hamraOperator = (await db.execute(sql`select id from users where email = 'reem@arz.test'`)).rows[0];
  await db.insert(s.notes).values([
    { businessId: demoConfirmed.businessId, branchId: demoConfirmed.branchId, appointmentId: demoConfirmed.id, authorId: demoCustomer.id, kind: 'customer', body: 'أرجو إحضار نتائج تخطيط القلب السابق إن لزم.' },
    { businessId: demoConfirmed.businessId, branchId: demoConfirmed.branchId, appointmentId: demoConfirmed.id, authorId: hamraOperator.id, kind: 'shared', body: 'نعم، يرجى إحضار التخطيط السابق وقائمة الأدوية الحالية. الحضور قبل الموعد بـ 15 دقيقة.' },
    { businessId: demoConfirmed.businessId, branchId: demoConfirmed.branchId, appointmentId: demoConfirmed.id, authorId: hamraOperator.id, kind: 'internal', body: 'ملاحظة داخلية: المريض لديه حساسية من البنسلين — لا تظهر للزبون.' },
  ]);
}

// ── Today's live lines (Hamra hospital is open 24/7) ─────────────
console.log('Filling today\'s live lines…');
async function liveLine(entry, { served, called, waiting, includeDemo = false, appointmentHolder = null }) {
  const { line } = entry;
  const pace = line.avgMinutesPerCustomer / line.countersCount;
  const rows = [];
  let clock = NOW.minus({ minutes: Math.round(served * pace + 20) });
  // Served earlier today (gives the "live" estimate real data).
  for (let i = 0; i < served; i += 1) {
    const calledAt = clock.plus({ minutes: pace * between(0.7, 1.3) });
    const joinedAt = calledAt.minus({ minutes: int(8, 35) });
    clock = calledAt;
    rows.push({ status: 'completed', joinedAt, calledAt, doneAt: calledAt.plus({ minutes: line.avgMinutesPerCustomer * between(0.7, 1.2) }), guestName: pick(guestNames) });
  }
  for (let i = 0; i < called; i += 1) {
    rows.push({ status: 'called', joinedAt: NOW.minus({ minutes: int(20, 40) }), calledAt: NOW.minus({ minutes: int(1, 5) }), guestName: pick(guestNames), counter: line.countersCount > 1 ? `شباك ${i + 1}` : 'العيادة' });
  }
  // Random customers in the line (never the demo customer or the appointment holder —
  // one person can only hold one active ticket per line).
  const waitingCustomers = customers.slice(1).filter((c) => c.id !== appointmentHolder?.customer?.id && chance(0.5));
  for (let i = 0; i < waiting; i += 1) {
    const joinedAt = NOW.minus({ minutes: (waiting - i) * int(4, 8) });
    const isDemo = includeDemo && i === Math.min(3, waiting - 1);
    const customer = isDemo ? demoCustomer : chance(0.5) ? waitingCustomers.shift() ?? null : null;
    rows.push({ status: 'waiting', joinedAt, customer, guestName: customer ? null : pick(guestNames) });
  }
  if (appointmentHolder) rows.push({ status: 'waiting', ...appointmentHolder });

  rows.sort((a, b) => a.joinedAt - b.joinedAt);
  const inserted = [];
  for (const r of rows) {
    const number = nextNumber(line.id, TODAY);
    const ahead = rows.filter((o) => o.joinedAt < r.joinedAt && (!o.calledAt || o.calledAt > r.joinedAt)).length;
    const [low, high] = estimateAtJoin(ahead, line);
    const [ticket] = await db
      .insert(s.queueTickets)
      .values({
        businessId: line.businessId,
        branchId: line.branchId,
        lineId: line.id,
        serviceDate: TODAY,
        number,
        displayCode: ticketDisplayCode(line.codePrefix, number),
        source: r.appointment ? 'appointment' : 'walk_in',
        appointmentId: r.appointment?.id ?? null,
        customerId: r.customer?.id ?? null,
        guestName: r.customer ? null : r.guestName,
        phone: r.customer?.phone ?? null,
        priorityGroup: r.appointment ? 'appointment' : 'walk_in',
        sortAt: (r.appointment ? DateTime.fromJSDate(r.appointment.startsAt) : r.joinedAt).toJSDate(),
        status: r.status,
        joinedAt: r.joinedAt.toJSDate(),
        firstCalledAt: r.calledAt?.toJSDate() ?? null,
        lastCalledAt: r.calledAt?.toJSDate() ?? null,
        counterLabel: r.counter ?? (r.calledAt ? 'العيادة' : null),
        completedAt: r.doneAt?.toJSDate() ?? null,
        trackingToken: randomToken(),
        alertLeadMinutes: line.defaultAlertLeadMinutes,
        estimateLowMin: low,
        estimateHighMin: high,
        estimateMethod: 'configured',
        actualWaitSeconds: r.calledAt ? Math.round(r.calledAt.diff(r.joinedAt, 'seconds').seconds) : null,
      })
      .returning();
    inserted.push(ticket);
  }
  return inserted;
}

// An appointment holder who already checked in for pediatrics today.
let checkedIn = null;
const todaySlotStart = NOW.plus({ minutes: 10 }).startOf('minute');
const todaySlot = await ensureSlot(pediatrics, todaySlotStart, 20, 1);
if (todaySlot) {
  await reserve(todaySlot);
  checkedIn = await createAppointment(pediatrics, todaySlot, customers[6], {
    status: 'checked_in',
    paymentStatus: 'confirmed',
    paymentConfirmedById: admin.id,
    paymentConfirmedAt: NOW.minus({ days: 1 }).toJSDate(),
    confirmedAt: NOW.minus({ days: 1 }).toJSDate(),
    checkedInAt: NOW.minus({ minutes: 6 }).toJSDate(),
    createdAt: NOW.minus({ days: 2 }).toJSDate(),
  });
  await addEvents(checkedIn.id, [
    { type: 'held', actorUserId: customers[6].id, createdAt: NOW.minus({ days: 2 }).toJSDate() },
    { type: 'payment_confirmed', actorUserId: admin.id, createdAt: NOW.minus({ days: 1 }).toJSDate() },
    { type: 'checked_in', actorUserId: customers[6].id, createdAt: NOW.minus({ minutes: 6 }).toJSDate() },
  ]);
}

const pediatricsTickets = await liveLine(pediatrics, {
  served: 9,
  called: 1,
  waiting: 6,
  includeDemo: true,
  appointmentHolder: checkedIn ? { appointment: { ...checkedIn, startsAt: todaySlotStart.toJSDate() }, customer: customers[6], joinedAt: NOW.minus({ minutes: 6 }) } : null,
});
await liveLine(cardiology, { served: 5, called: 1, waiting: 3 });
await liveLine(lab, { served: 14, called: 2, waiting: 5 });

// Keep the database's ticket counters in step with the numbers we used.
for (const [key, lastNumber] of counters) {
  const [lineId, serviceDate] = key.split('|');
  await db.insert(s.queueCounters).values({ lineId: Number(lineId), serviceDate, lastNumber }).onConflictDoUpdate({ target: [s.queueCounters.lineId, s.queueCounters.serviceDate], set: { lastNumber } });
}

// ── A few audit entries so the log is not empty ──────────────────
await db.insert(s.auditLogs).values([
  { actorUserId: admin.id, action: 'platform.settings.update', entityType: 'platform_settings', entityId: 1, after: { defaultHoldMinutes: 30 } },
  { actorUserId: owners['arz-hospital'].id, businessId: owners['arz-hospital'].businessId, action: 'slots.generate', entityType: 'line', entityId: pediatrics.line.id, after: { weekdays: [1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '13:00', slotMinutes: 20 } },
]);

const demoTicket = pediatricsTickets.find((tk) => tk.customerId === demoCustomer.id);
console.log(`
✅ Demo data ready (${reviewsCount} reviews, 30 days of history).

Staff logins (/staff/login):
  Platform admin   admin@dawri.test   / Admin@2026
  Owner (hospital) owner@arz.test     / Owner@2026
  Owner (center)   owner@nokhba.test  / Owner@2026
  Operator         reem@arz.test      / Operator@2026   (Hamra)
  Operator         jad@arz.test       / Operator@2026   (Hamra + Jounieh)
  Operator         omar@nokhba.test   / Operator@2026   (Tripoli + Saida)

Customer login (/login): phone 70 123 401 → the code appears on /dev/notifications
Demo customer's live ticket: /t/${demoTicket?.trackingToken ?? '—'}
`);
await pool.end();

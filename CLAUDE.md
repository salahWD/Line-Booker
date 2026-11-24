# CLAUDE.md

Context for Claude Code sessions in this repo. Human-facing docs (demo accounts, things to try, Firebase setup) are in [README.md](README.md).

## What this app is
An Arabic-first (RTL), mobile-first booking app called **دوري** (Dawri). The whole app serves two features:

1. **Take a number in a line.** A customer takes a ticket in a branch line (for example a hospital clinic). They see how many people are ahead, the average time per customer and an estimated wait, so they can leave. A Firebase push (with SMS fallback) alerts them before their turn and again when called.
2. **Paid date-and-time appointments.** The owner publishes free slots. The customer picks one, and the slot is held while they pay the branch's fee through the **platform's** Whish Money link. Only the **platform admin** verifies the money arrived and confirms. Owners and operators can see payment status but can never confirm it.

Roles: `platform_admin`, `owner` (one business), `operator` (assigned branches), `customer` (phone + SMS OTP). There are no services, no employee selection and no employee assignment.

## Decisions already made with the user (don't revisit)
- Stack: Express 5 + EJS (express-ejs-layouts), PostgreSQL, **Drizzle ORM** (not Knex), pg-boss, Zod 4, SSE, Tailwind v4, Alpine.js (**CSP build**), GSAP (subtle), Chart.js. No React/Vue/Angular/Svelte/Next/Nuxt. **No Vite**: browsers load native ES modules.
- Dev database is **embedded-postgres** (npm), port 5433, data in `.pgdata/`.
- **Arabic-only UI** but i18n-ready: every UI string lives in [src/locales/ar.js](src/locales/ar.js). Use `t()` in views and services. Browser scripts get the `client` subset.
- Fees go to the platform's Whish account. A fee of 0 confirms instantly.
- Slot hold: held for N minutes (`branches.hold_minutes`, else `platform_settings.default_hold_minutes`). Once the customer submits a transfer, the hold no longer expires and waits for the admin.
- A branch can have several named lines.
- Alerts: FCM web push first, SMS fallback.
- Date-only bookings were dropped. Appointments are always a date and a time.
- Whish has no API: the app uses a manual link + QR code. Never invent a Whish API.
- The spec says "no tests needed". [scripts/check-critical-flows.js](scripts/check-critical-flows.js) (`npm run check`) is the safety net and must stay green (34 checks).

## Commands
```
npm install
npm run db:start      # embedded Postgres; keep this terminal open
npm run db:reset      # drop everything, migrate, seed Arabic demo data
npm run css:build     # src/public/css/input.css -> app.css (app.css is gitignored)
npm run dev           # css watch + node --watch, http://localhost:3000
npm run check         # critical-flow checks against the dev DB
npm run db:generate   # after editing src/models/schema/*, generates SQL in database/migrations
npm run db:migrate
npm run worker        # jobs only (set RUN_JOBS=false on web processes in production)
```
- `.env` is not in git. Copy `.env.example` and set random `SESSION_SECRET` and `OTP_SECRET`.
- The seed is tied to today's date (live queues, slots, appointments). Run `npm run db:reset` again before a demo.
- With the mock SMS/push providers, OTP codes and messages appear at `/dev/notifications` and in the console.

## Architecture (MVC + service layer)
- `src/routes` → thin `src/controllers` (parse with Zod, call a service, render or JSON) → `src/services` (all business rules) → `src/models` (queries only).
- Model functions take an optional `tx` as the last argument. Services own the transactions.
- Use `transaction(work)` from [src/config/db.js](src/config/db.js) instead of `db.transaction` when anything must run after commit. Register that work with `tx.afterCommit(fn)`.
- Errors: throw `badRequest` / `forbidden` / `notFound` / `conflict` / `validationError` from [src/utils/errors.js](src/utils/errors.js) with Arabic messages. [src/middleware/errorHandler.js](src/middleware/errorHandler.js) answers JSON for API calls. For form posts it redirects back with a flash message and the old input. Express 5 forwards async errors, so controllers have no try/catch.
- **Isolation:** go through [src/services/access.service.js](src/services/access.service.js) (`accessibleBranchIds`, `getBranchForStaff`, `getLineForStaff`, `assertRecordAccess`). `business_id` always comes from the session, never the request. An out-of-scope record returns **404, not 403**, so IDs can't be probed.
- Route params named `id`, `lineId`, `branchId`, `ticketId`, `slotId`, `holidayId` are checked as numeric by [src/middleware/params.js](src/middleware/params.js). Add new id param names there.

### Live lines (concurrency rules)
- Every queue mutation goes through `lineChange(line, type, work)` in [src/services/line.service.js](src/services/line.service.js). It takes `pg_advisory_xact_lock(line_id)`, runs the work, calls `pg_notify` inside the transaction, then after commit invalidates the estimate cache and triggers the alert check.
- Status changes use conditional updates (`transition(id, fromStatuses, …)`). An invalid transition returns 409.
- **Lock order is always the line first, then the appointment.** `cancelByStaff` and `markNoShow` call `lockTicketLine()` first for this reason. Keep that order or you'll create deadlocks.
- Partial unique indexes are the final guard: one active ticket per customer per line, one per appointment, and one active appointment per customer/line/day.
- Ordering policies (`fifo`, `booked_first`, `interleave`) are a pure function in [src/services/queueOrder.service.js](src/services/queueOrder.service.js).
- Estimates ([src/services/estimate.service.js](src/services/estimate.service.js)) try the live pace first, then history (same weekday over the last 4 weeks), then the configured average. Results are cached for 15 s.
- Realtime: SSE + Postgres LISTEN/NOTIFY ([src/services/realtime.service.js](src/services/realtime.service.js)). Events carry **no data**. Clients refetch their own permission-checked JSON. The public display (`/display/:token`) must never show names, phones, notes or payments.

### Appointments and payments
- Slot reservation is one atomic `UPDATE … WHERE is_open AND reserved_count < capacity`. Every release (expiry, rejection, cancellation) decrements `reserved_count` in the **same transaction** as the status change.
- Appointment status (`held|confirmed|checked_in|completed|cancelled|no_show|expired`) and payment status (`not_required|unpaid|awaiting_verification|confirmed|rejected`) are separate fields.
- `confirmPayment` / `rejectPayment` in [src/services/payment.service.js](src/services/payment.service.js) are platform-admin only and audited. Payment proofs live in `uploads/` and are served only through an authorized route (admin or the uploader).

### Notifications
- Outbox pattern: notification rows are inserted inside the business transaction, then the pg-boss `notify-send` job sends them with retries. A one-minute sweep re-enqueues stuck rows. Push falls back to SMS.
- Providers are replaceable: [src/integrations/sms](src/integrations/sms) (mock, twilio) and [src/integrations/push](src/integrations/push) (mock, fcm). Push uses FCM when `FIREBASE_PROJECT_ID` is set, otherwise the mock.
- OTP codes are stored as an HMAC hash. The plain code is only kept in `secretBody` until sent, then cleared.

### Notes privacy
Note kinds are `customer`, `internal` and `shared`. Customers may only write `customer` notes. Customer-facing queries return only `customer` + `shared`. Never leak `internal`.

## Gotchas (each one has bitten before)
- **Alpine CSP build:** no inline expressions that need `eval`. Register components with `Alpine.data(...)` in [src/public/js/app.js](src/public/js/app.js). Templates can use simple property access, literals, ternaries, `===`, method calls with arguments and assignments, nothing fancier.
- **Tailwind v4:** configured with `@source` / `@theme` in `input.css`. `@apply` of your own custom classes fails, so spell the utilities out.
- **Luxon:** the default locale is `en-GB` with Western (`latn`) digits on purpose. Use the Arabic locale (`ar-LB`, latn) only for human-readable dates via helpers in [src/utils/dates.js](src/utils/dates.js). Arabic-Indic digits in machine formats broke SQL before.
- **Drizzle:** `casing: 'snake_case'` (JS camelCase ↔ DB snake_case). Raw `db.execute(sql…)` returns snake_case keys and **timestamps as strings**. Wrap them in `new Date(...)`. Postgres `date` columns are parsed as plain `YYYY-MM-DD` strings.
- **embedded-postgres must be UTF-8** (`initdbFlags` in [scripts/db-start.js](scripts/db-start.js)). If Arabic inserts fail with a WIN1252 error, delete `.pgdata/` and start again.
- **CSRF:** synchronizer token (hidden `_csrf` field or `X-CSRF-Token` header). For multipart forms it is checked after multer runs. Webhooks are mounted before CSRF.
- **CSP (helmet):** scripts load from `'self'` + gstatic only. Vendor libraries are served from `node_modules` under `/vendor/*`. No inline scripts; pass data through `data-*` attributes or JSON script tags.
- **Windows:** Git Bash mangles Arabic in curl arguments (`?????`), so test Arabic input with Node `fetch` instead. Stopping a dev server from a tool can leave orphan `node` / `postgres` processes. Check the port and stop Postgres with `pg_ctl stop -m fast` on `.pgdata`.

## Status (end of the first build)
- All 5 build stages are done. `npm run check` passes 34/34. The main flows were exercised end to end over HTTP: OTP login, take a number, call/complete, booking + hold expiry, payment submit/confirm/reject, upload safety, CSRF, SSE, CSV export.
- **Mocked or untested:**
  - SMS uses the mock provider. The Twilio adapter is written but has never been run against a real account.
  - Real FCM push has never been tested (it needs Firebase keys in `.env`).
  - The Whish link in the seed is a placeholder. Set the real one in Admin → Settings.
- **Not verified in a real browser yet:**
  - the Alpine screens (ticket tracker + alarm, operator console, display board, report charts)
  - phone-width layout
  - sounds and vibration

  This is the most useful next step.
- Known limits:
  - Rate limits are in memory, so they work for a single process only.
  - "Ringing" is a high-priority push + an in-page looping alarm. It cannot place a real phone call.
  - iPhone web push needs the app added to the home screen.

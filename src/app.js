// Express application: security headers, static files, sessions, CSRF, routes, errors.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import expressLayouts from 'express-ejs-layouts';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { loadUser } from './middleware/auth.js';
import { locals, flashHelper } from './middleware/locals.js';
import { csrfProtection } from './middleware/csrf.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { webhookRoutes } from './routes/webhooks.routes.js';
import { routes } from './routes/index.js';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const nodeModules = path.resolve(srcDir, '..', 'node_modules');

export const app = express();
app.set('trust proxy', env.TRUST_PROXY);
app.disable('x-powered-by');

// ── Views (EJS + layouts) ────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(srcDir, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true); // page <script> tags are moved to the end of the layout

// ── Security headers (strict Content-Security-Policy) ───────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // gstatic = Firebase web SDK (push notifications). No inline scripts, no eval.
        scriptSrc: ["'self'", 'https://www.gstatic.com'],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", 'https://*.googleapis.com', 'https://www.gstatic.com'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: env.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// ── Static files (before sessions, so assets never touch the session store) ──
const staticOptions = { maxAge: env.isProduction ? '7d' : 0 };
app.use(express.static(path.join(srcDir, 'public'), staticOptions));
app.use('/vendor/alpine', express.static(path.join(nodeModules, '@alpinejs/csp/dist'), staticOptions));
app.use('/vendor/gsap', express.static(path.join(nodeModules, 'gsap/dist'), staticOptions));
app.use('/vendor/chart', express.static(path.join(nodeModules, 'chart.js/dist'), staticOptions));
app.use('/fonts', express.static(path.join(nodeModules, '@fontsource/ibm-plex-sans-arabic/files'), staticOptions));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ── Body parsing ─────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// ── Sessions stored in PostgreSQL ────────────────────────────────
const PgStore = connectPgSimple(session);
app.use(
  session({
    name: 'sid',
    store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
      maxAge: 30 * 24 * 3600_000, // customers stay signed in for 30 days (staff: 12 h, set at login)
    },
  }),
);

app.use(flashHelper);
app.use(loadUser);
app.use(locals);

// Provider callbacks authenticate with a shared secret instead of a CSRF token.
app.use('/webhooks', webhookRoutes);

app.use(csrfProtection);
app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);

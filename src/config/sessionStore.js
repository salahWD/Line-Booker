// express-session store backed by the `sessions` table (MySQL).
// Expired rows are ignored on read and deleted by the hourly cleanup job.
import session from 'express-session';
import { eq, gt, and, lt } from 'drizzle-orm';
import { db } from './db.js';
import { sessions } from '../models/schema/index.js';

const DEFAULT_TTL_MS = 24 * 3600_000;

const expiryOf = (sess) => {
  const expires = sess?.cookie?.expires;
  return expires ? new Date(expires) : new Date(Date.now() + DEFAULT_TTL_MS);
};

/** Wraps an async function into express-session's callback style. */
const callbackify = (fn) => (...args) => {
  const cb = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
  fn(...args).then((value) => cb(null, value), (err) => cb(err));
};

export class MySqlSessionStore extends session.Store {
  get = callbackify(async (sid) => {
    const [row] = await db
      .select({ sess: sessions.sess })
      .from(sessions)
      .where(and(eq(sessions.sid, sid), gt(sessions.expire, new Date())));
    return row?.sess ?? null;
  });

  set = callbackify(async (sid, sess) => {
    const expire = expiryOf(sess);
    await db.insert(sessions).values({ sid, sess, expire }).onDuplicateKeyUpdate({ set: { sess, expire } });
  });

  destroy = callbackify(async (sid) => {
    await db.delete(sessions).where(eq(sessions.sid, sid));
  });

  // Called on requests that did not change the session: only extends its expiry.
  touch = callbackify(async (sid, sess) => {
    await db.update(sessions).set({ expire: expiryOf(sess) }).where(eq(sessions.sid, sid));
  });
}

/** Deletes expired sessions (hourly cleanup job). */
export async function deleteExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expire, new Date()));
}

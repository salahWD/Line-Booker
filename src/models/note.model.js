// Notes on appointments and tickets. Visibility is decided by `kinds` — callers
// building customer pages must pass ['customer', 'shared'] (see note.service).
import { and, eq, inArray, asc } from 'drizzle-orm';
import { notes, users } from './schema/index.js';
import { exec, one, insertOne, updateOne, affected } from './db-helpers.js';

export async function create(data, tx) {
  return insertOne(notes, data, tx);
}

export async function list({ appointmentId, ticketId, kinds }, tx) {
  const target = appointmentId ? eq(notes.appointmentId, appointmentId) : eq(notes.ticketId, ticketId);
  return exec(tx)
    .select({
      id: notes.id,
      kind: notes.kind,
      body: notes.body,
      createdAt: notes.createdAt,
      authorId: notes.authorId,
      authorName: users.name,
      authorRole: users.role,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .where(and(target, inArray(notes.kind, kinds)))
    .orderBy(asc(notes.createdAt));
}

// Answers to logbook checks the User gives by deciding something else (ADR 0038): splitting a Recording off its Dive, or
// making a Dive of a Recording that might have belonged to another, says "these are two dives". Kept like an answer
// given on the logbook, so the pair isn't asked about right after the decision. Restoring a Dive that is probably no dive
// says "keep it" the same way.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { dive, logbookCheckAnswer, logbookCheckDiveAnswer, recording } from '../db/schema.js';
import { ordered, probablyNoDive, ruleFor } from './logbook-check-rules.js';

/** Records that the Dive and each of the others it breaks a rule with are two dives. */
export async function keepApart(tx: Tx, userId: string, diveId: string, otherIds: string[]): Promise<void> {
  const ids = [...new Set([diveId, ...otherIds])];
  if (ids.length < 2) return;
  const rows = await tx.select({
    d: dive,
    recordings: sql<number>`(select count(*)::int from ${recording} where ${recording.diveId} = ${dive.id} and ${recording.deletedAt} is null)`,
  }).from(dive).where(and(inArray(dive.id, ids), isNull(dive.deletedAt)));
  const dives = rows.map(({ d, recordings }) => ({ ...d, recordings }));
  const self = dives.find((d) => d.id === diveId);
  if (!self) return;
  for (const other of dives) {
    const rule = ruleFor(self, other);
    if (!rule) continue;
    const [a, b] = ordered(self.id, other.id).map((id) => dives.find((d) => d.id === id)!) as [typeof self, typeof self];
    await tx.insert(logbookCheckAnswer).values({ rule, diveA: a.id, diveB: b.id, startsA: a.startsAt, startsB: b.startsAt, answeredBy: userId })
      .onConflictDoUpdate({ target: [logbookCheckAnswer.diveA, logbookCheckAnswer.diveB], set: { rule, startsA: a.startsAt, startsB: b.startsAt, answeredBy: userId } });
  }
}

/** Records "keep it" for a Dive with the duration and depth it has now. */
export async function keepDive(q: Db | Tx, userId: string, d: { id: string; durationSeconds: number; maxDepthM: number | null }): Promise<void> {
  const answer = { rule: 'short_shallow_dive', durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, answeredBy: userId };
  await q.insert(logbookCheckDiveAnswer).values({ diveId: d.id, ...answer })
    .onConflictDoUpdate({ target: [logbookCheckDiveAnswer.diveId, logbookCheckDiveAnswer.rule], set: answer });
}

/** A Dive just restored: if it is probably no dive, the User wanted it back, so it isn't offered for deleting again. */
export async function keepRestored(tx: Tx, userId: string, diveId: string): Promise<void> {
  const [d] = await tx.select().from(dive).where(eq(dive.id, diveId));
  const recordings = await tx.$count(recording, and(eq(recording.diveId, diveId), isNull(recording.deletedAt)));
  if (d && probablyNoDive({ ...d, recordings })) await keepDive(tx, userId, d);
}

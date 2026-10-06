// Answers to logbook checks the User gives by deciding something else (ADR 0038): splitting a Recording off its Dive, or
// making a Dive of a Recording that might have belonged to another, says "these are two dives". Kept like an answer
// given on the logbook, so the pair isn't asked about right after the decision.
import { and, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { dive, logbookCheckAnswer, recording } from '../db/schema.js';
import { ordered, ruleFor } from './logbook-check-rules.js';

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

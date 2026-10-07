// Logbook checks (ADR 0038): what in a logbook can't be right as it stands, found by fixed rules over the Dives as they
// are now. Computed each time, never stored; only the User's answer is kept: "these are two dives" per rule and pair,
// while neither Dive's time changes, and "keep it" for a Dive that is probably no dive, while its duration and depth
// stay. The pair rules use the import's own matching, so a check never disagrees with what a fresh import would have done.
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dive, diveSite, logbookCheckAnswer, logbookCheckDiveAnswer, recording } from '../db/schema.js';
import { DiveError, managedDiverIds } from './dive-service.js';
import { keepDive } from './logbook-check-answers.js';
import { findChecks, ordered, ruleFor, suggestsDeleting, type CheckedDive, type LogbookCheck } from './logbook-check-rules.js';

export { LOGBOOK_CHECK_RULES } from './logbook-check-rules.js';

/** Which of these Dives are at a Provider (the Pushes know). */
type AtProvider = (diveIds: string[]) => Promise<Set<string>>;

export function createLogbookChecks(db: Db) {
  /** The live Dives of these Divers as the rules see them, with their sites' names. */
  async function divesOf(diverIds: string[]) {
    if (diverIds.length === 0) return [];
    const rows = await db.select({
      d: dive, siteName: diveSite.name,
      recordings: sql<number>`(select count(*)::int from ${recording} where ${recording.diveId} = ${dive.id} and ${recording.deletedAt} is null)`,
    }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId))
      .where(and(inArray(dive.diverId, diverIds), isNull(dive.deletedAt)));
    return rows.map(({ d, siteName, recordings }) => ({ ...d, siteName, recordings }));
  }

  /** The answers that still hold for these Dives: given while both started when they start now. */
  async function answered(dives: { id: string; startsAt: Date }[]) {
    const ids = dives.map((d) => d.id);
    if (ids.length === 0) return new Set<string>();
    const rows = await db.select().from(logbookCheckAnswer)
      .where(or(inArray(logbookCheckAnswer.diveA, ids), inArray(logbookCheckAnswer.diveB, ids)));
    const start = new Map(dives.map((d) => [d.id, d.startsAt.getTime()]));
    return new Set(rows
      .filter((r) => start.get(r.diveA) === r.startsA.getTime() && start.get(r.diveB) === r.startsB.getTime())
      .map((r) => `${r.rule}:${r.diveA}:${r.diveB}`));
  }
  const keyOf = (c: LogbookCheck) => `${c.rule}:${ordered(c.dives[0].id, c.dives[1].id).join(':')}`;

  /** Of these Dives, those the User said to keep, with the duration and depth they have now. */
  async function kept(dives: { id: string; durationSeconds: number; maxDepthM: number | null }[]) {
    if (dives.length === 0) return new Set<string>();
    const rows = await db.select().from(logbookCheckDiveAnswer).where(inArray(logbookCheckDiveAnswer.diveId, dives.map((d) => d.id)));
    const now = new Map(dives.map((d) => [d.id, d]));
    return new Set(rows
      .filter((r) => now.get(r.diveId)!.durationSeconds === r.durationSeconds && now.get(r.diveId)!.maxDepthM === r.maxDepthM)
      .map((r) => r.diveId));
  }

  return {
    /**
     * The checks in the logbooks the User keeps: the open ones, or those answered "these are two dives" (to ask again).
     */
    async list(userId: string, status: 'open' | 'answered' = 'open') {
      const dives = await divesOf([...(await managedDiverIds(db, userId))]);
      const checks = findChecks(dives);
      const done = await answered(checks.flatMap((c) => c.dives));
      const row = (id: string) => dives.find((d) => d.id === id)!;
      return checks.filter((c) => done.has(keyOf(c)) === (status === 'answered'))
        .map((c) => ({ rule: c.rule, obvious: c.obvious, dives: [row(c.dives[0].id), row(c.dives[1].id)] as const }));
    },

    /**
     * The Dives in the User's logbooks that are probably no dive (`short_shallow_dive`): the open ones, or those answered
     * "keep it". `atProvider` says which of some Dives are at a Provider; those are never offered for deleting.
     */
    async shortDives(userId: string, atProvider: AtProvider, status: 'open' | 'answered' = 'open') {
      const dives = (await divesOf([...(await managedDiverIds(db, userId))])).filter((d) => suggestsDeleting(d, false));
      const linked = await atProvider(dives.map((d) => d.id));
      const found = dives.filter((d) => !linked.has(d.id));
      const done = await kept(found);
      return found.filter((d) => done.has(d.id) === (status === 'answered'))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
    },

    /** "Keep it" for a Dive offered for deleting (kept until its duration or depth changes), or `null` to be asked again. */
    async keep(userId: string, diveId: string, atProvider: AtProvider, answer: 'keep' | null) {
      const d = (await divesOf([...(await managedDiverIds(db, userId))])).find((row) => row.id === diveId);
      if (!d) throw new DiveError('dive_not_found');
      if (!suggestsDeleting(d, (await atProvider([d.id])).has(d.id))) throw new DiveError('check_not_found');
      await db.delete(logbookCheckDiveAnswer).where(eq(logbookCheckDiveAnswer.diveId, d.id));
      if (answer) await keepDive(db, userId, d);
    },

    /** Of these Dives of one Diver, those the Dive breaks a rule with, and whether the User answered that pair. */
    async against(diveId: string, others: CheckedDive[], self: CheckedDive) {
      const pairs = others.flatMap((o) => { const rule = ruleFor(self, o); return rule ? [{ rule, other: o }] : []; });
      const done = await answered([self, ...pairs.map((p) => p.other)]);
      return pairs.map((p) => ({ ...p, answered: done.has(`${p.rule}:${ordered(diveId, p.other.id).join(':')}`) }));
    },

    /**
     * The User's answer to a check: "these are two dives" (kept until one of them changes its time), or `null` to be
     * asked again. Both Dives must be in logbooks the User keeps and break a rule together.
     */
    async answer(userId: string, diveIds: [string, string], answer: 'two_dives' | null) {
      const managed = await managedDiverIds(db, userId);
      const dives = (await divesOf([...managed])).filter((d) => diveIds.includes(d.id));
      const [a, b] = ordered(diveIds[0], diveIds[1]).map((id) => dives.find((d) => d.id === id));
      if (!a || !b) throw new DiveError('dive_not_found');
      const rule = ruleFor(a, b);
      if (!rule) throw new DiveError('check_not_found');
      await db.delete(logbookCheckAnswer).where(and(eq(logbookCheckAnswer.diveA, a.id), eq(logbookCheckAnswer.diveB, b.id)));
      if (answer) {
        await db.insert(logbookCheckAnswer).values({ rule, diveA: a.id, diveB: b.id, startsA: a.startsAt, startsB: b.startsAt, answeredBy: userId });
      }
    },
  };
}

export type LogbookChecks = ReturnType<typeof createLogbookChecks>;

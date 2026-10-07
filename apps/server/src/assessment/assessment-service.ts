// Keeping every Dive's assessment (ADR 0036): findings are stored with the engine version and the Primary recording
// they came from, and computed again when either changes or when the Diver's dives around a Dive change. Users put a
// finding aside on one Dive (dismiss) or a rule aside for a Diver (mute); they never change what was computed.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import {
  dive, diveAssessment, diveFinding, diver, diverManagement, findingDismissal, mutedRule, recording, recordingEvent, sampleSeries,
  type RecordingSummary,
} from '../db/schema.js';
import { computerEventOf } from '../imports/computer-events.js';
import type { ComputerEvent } from '../vocabulary.js';
import { sketchOf } from './sketch.js';
import { ENGINE_VERSION, RULES, RULE_IDS, assessProfile, assessSeries, noFlyAfter, type Finding, type RuleId, type SeriesDive } from './rules.js';

export class AssessmentError extends Error {
  constructor(readonly code: 'dive_not_found' | 'diver_not_found' | 'finding_not_found') {
    super(code);
  }
}

/** Sample channels the rules read. */
const CHANNELS = ['depth', 'ndl', 'nextStopDepth', 'ceiling', 'po2', 'cns'] as const;
/** Dive modes the rules don't cover (ADR 0036): no findings, and they don't count for the dives around them. */
const NOT_COVERED = ['apnea', 'ccr', 'scr'];

/** A Dive as the rules across dives see it; its day is the local one where the offset is known. */
function seriesDive(d: { id: string; startsAt: Date; utcOffsetSeconds: number | null; durationSeconds: number; maxDepthM: number | null }, enteredDeco: boolean): SeriesDive {
  const local = new Date(d.startsAt.getTime() + (d.utcOffsetSeconds ?? 0) * 1000);
  return {
    id: d.id, startMs: d.startsAt.getTime(), endMs: d.startsAt.getTime() + d.durationSeconds * 1000,
    day: local.toISOString().slice(0, 10), maxDepthM: d.maxDepthM, enteredDeco,
  };
}

const isRule = (rule: string): rule is RuleId => (RULE_IDS as string[]).includes(rule);
const same = (a: Pick<Finding, 'severity' | 'values'>, b: Pick<Finding, 'severity' | 'values'>) =>
  a.severity === b.severity && JSON.stringify(a.values) === JSON.stringify(b.values);

export function createAssessmentService(db: Db) {
  /**
   * Brings the assessments of one Diver's Dives up to date. Cheap when nothing changed: Dives whose engine version
   * and Primary recording are as stored are not read again; the series rules run over the dive list alone.
   */
  async function refreshDiver(diverId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // One refresh per Diver at a time; a second one waits and then finds nothing to do.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`assess:${diverId}`}))`);
      const dives = await tx.select({
        id: dive.id, startsAt: dive.startsAt, utcOffsetSeconds: dive.utcOffsetSeconds, durationSeconds: dive.durationSeconds,
        maxDepthM: dive.maxDepthM, recordingId: recording.id, stamp: recording.updatedAt, summary: recording.summary,
      }).from(dive)
        .leftJoin(recording, and(eq(recording.id, dive.primaryRecordingId), isNull(recording.deletedAt)))
        .where(and(eq(dive.diverId, diverId), isNull(dive.deletedAt)));
      if (dives.length === 0) return;
      const ids = dives.map((d) => d.id);
      const known = new Map((await tx.select().from(diveAssessment).where(inArray(diveAssessment.diveId, ids))).map((a) => [a.diveId, a]));
      const stored = await tx.select().from(diveFinding).where(inArray(diveFinding.diveId, ids));

      const enteredDeco = new Map<string, boolean>();
      const covered = new Set<string>();
      for (const d of dives) {
        const applies = !NOT_COVERED.includes((d.summary as RecordingSummary | null)?.diveMode ?? '');
        if (applies) covered.add(d.id);
        const was = known.get(d.id);
        const fresh = was && was.engineVersion === ENGINE_VERSION && was.applies === applies && was.recordingId === d.recordingId
          && (was.recordingStamp?.getTime() ?? null) === (d.stamp?.getTime() ?? null);
        if (fresh) {
          enteredDeco.set(d.id, was.enteredDeco);
          continue;
        }
        const rows = d.recordingId ? await readSeries(tx, d.recordingId) : [];
        const assessed = applies ? assessRows(rows) : null;
        // The sketch is for every Dive with a depth profile, also those the rules don't cover.
        const depth = rows.find((r) => r.channel === 'depth');
        const profile = depth ? sketchOf(depth) : null;
        await replaceFindings(tx, d.id, 'profile', assessed?.findings ?? [], d.recordingId);
        const row = {
          engineVersion: ENGINE_VERSION, recordingId: d.recordingId, recordingStamp: d.stamp, applies,
          enteredDeco: assessed?.enteredDeco ?? false, sampleIntervalS: assessed?.sampleIntervalS ?? null,
          ascentBands: assessed?.ascentBands ?? [], profile, computedAt: new Date(),
        };
        await tx.insert(diveAssessment).values({ diveId: d.id, ...row }).onConflictDoUpdate({ target: diveAssessment.diveId, set: row });
        enteredDeco.set(d.id, row.enteredDeco);
      }

      // The dives in relation to each other: cheap, so always computed, and written only where something differs.
      const series = assessSeries(dives.filter((d) => covered.has(d.id)).map((d) => seriesDive(d, enteredDeco.get(d.id) ?? false)));
      for (const d of dives) {
        const now = series.get(d.id) ?? [];
        const before = stored.filter((f) => f.diveId === d.id && isRule(f.rule) && RULES[f.rule].scope === 'series');
        const unchanged = before.length === now.length && now.every((f) => before.some((b) => b.rule === f.rule && same(b, f)));
        if (!unchanged) await replaceFindings(tx, d.id, 'series', now, null);
      }

      // A dismissal goes with its finding.
      await tx.execute(sql`delete from finding_dismissal x where x.dive_id in (select id from dive where diver_id = ${diverId}::uuid)
        and not exists (select 1 from dive_finding f where f.dive_id = x.dive_id and f.rule = x.rule)`);
    });
  }

  async function readSeries(tx: Tx, recordingId: string) {
    return tx.select().from(sampleSeries).where(and(eq(sampleSeries.recordingId, recordingId), inArray(sampleSeries.channel, [...CHANNELS])));
  }

  function assessRows(rows: Awaited<ReturnType<typeof readSeries>>) {
    const series = (channel: (typeof CHANNELS)[number]) => {
      const found = rows.find((r) => r.channel === channel);
      return found && { offsetsMs: found.offsetsMs, values: found.values };
    };
    const depth = series('depth');
    return depth ? assessProfile({ depth, ndl: series('ndl'), nextStopDepth: series('nextStopDepth') ?? series('ceiling'), po2: series('po2'), cns: series('cns') }) : null;
  }

  async function replaceFindings(tx: Tx, diveId: string, scope: 'profile' | 'series', findings: Finding[], recordingId: string | null) {
    const rules = RULE_IDS.filter((rule) => RULES[rule].scope === scope);
    await tx.delete(diveFinding).where(and(eq(diveFinding.diveId, diveId), inArray(diveFinding.rule, rules)));
    if (findings.length === 0) return;
    await tx.insert(diveFinding).values(findings.map((f) => ({
      diveId, recordingId: scope === 'profile' ? recordingId : null, rule: f.rule, severity: f.severity, startS: f.startS, endS: f.endS,
      values: f.values, engineVersion: ENGINE_VERSION,
    })));
  }

  /** The Dive if the User manages its Diver and it isn't deleted; not managed and not found look the same. */
  async function managedDive(userId: string, diveId: string) {
    const [row] = await db.select({ id: dive.id, diverId: dive.diverId, primaryRecordingId: dive.primaryRecordingId }).from(dive)
      .innerJoin(diverManagement, and(eq(diverManagement.diverId, dive.diverId), eq(diverManagement.userId, userId)))
      .where(and(eq(dive.id, diveId), isNull(dive.deletedAt)));
    if (!row) throw new AssessmentError('dive_not_found');
    return row;
  }

  return {
    refreshDiver,

    /** After something of a User's logbook changed: every Diver they manage (each cheap when nothing changed). */
    async refreshUser(userId: string): Promise<void> {
      const divers = await db.select({ id: diverManagement.diverId }).from(diverManagement).where(eq(diverManagement.userId, userId));
      for (const d of divers) await refreshDiver(d.id);
    },

    /** Every Diver with Dives: after a start, which may have brought a new engine version. Returns how many Divers. */
    async refreshAll(): Promise<number> {
      const divers = await db.selectDistinct({ id: dive.diverId }).from(dive).where(isNull(dive.deletedAt));
      for (const d of divers) await refreshDiver(d.id);
      return divers.length;
    },

    /** A Dive's assessment as its User sees it: the findings with what the User did about them, and the computer's own events. */
    async of(userId: string, diveId: string) {
      const d = await managedDive(userId, diveId);
      // Whatever changed the logbook should have refreshed it; this covers anything that didn't.
      await refreshDiver(d.diverId);
      return read(db, d);
    },

    /** Puts a finding on this Dive aside, or brings it back. */
    async dismiss(userId: string, diveId: string, rule: string, dismissed: boolean): Promise<void> {
      await managedDive(userId, diveId);
      const [found] = await db.select({ id: diveFinding.id }).from(diveFinding).where(and(eq(diveFinding.diveId, diveId), eq(diveFinding.rule, rule)));
      if (!found) throw new AssessmentError('finding_not_found');
      if (dismissed) await db.insert(findingDismissal).values({ diveId, rule, dismissedBy: userId }).onConflictDoNothing();
      else await db.delete(findingDismissal).where(and(eq(findingDismissal.diveId, diveId), eq(findingDismissal.rule, rule)));
    },

    /** Hides a rule's findings on every Dive of a Diver the User manages, or shows them again. */
    async mute(userId: string, diverId: string, rule: string, muted: boolean): Promise<void> {
      const [managed] = await db.select({ id: diver.id }).from(diverManagement).innerJoin(diver, eq(diver.id, diverManagement.diverId))
        .where(and(eq(diverManagement.userId, userId), eq(diverManagement.diverId, diverId), isNull(diver.deletedAt)));
      if (!managed) throw new AssessmentError('diver_not_found');
      if (!isRule(rule)) throw new AssessmentError('finding_not_found');
      if (muted) await db.insert(mutedRule).values({ diverId, rule, mutedBy: userId }).onConflictDoNothing();
      else await db.delete(mutedRule).where(and(eq(mutedRule.diverId, diverId), eq(mutedRule.rule, rule)));
    },
  };
}

/** What is stored about a Dive's assessment. Reads only: the MCP tool calls it inside its read-only transaction. */
export async function read(tx: Tx | Db, d: { id: string; diverId: string; primaryRecordingId: string | null }) {
  const [assessment] = await tx.select().from(diveAssessment).where(eq(diveAssessment.diveId, d.id));
  const findings = await tx.select().from(diveFinding).where(eq(diveFinding.diveId, d.id));
  const dismissed = new Set((await tx.select({ rule: findingDismissal.rule }).from(findingDismissal).where(eq(findingDismissal.diveId, d.id))).map((r) => r.rule));
  const muted = new Set((await tx.select({ rule: mutedRule.rule }).from(mutedRule).where(eq(mutedRule.diverId, d.diverId))).map((r) => r.rule));
  const events = d.primaryRecordingId
    ? await tx.select().from(recordingEvent).where(eq(recordingEvent.recordingId, d.primaryRecordingId)).orderBy(recordingEvent.offsetMs)
    : [];
  // DAN's no-fly time, from the Diver's dives of this day and the day before (those the rules cover).
  const around = (assessment?.applies ?? true) ? await tx.select({
    id: dive.id, startsAt: dive.startsAt, utcOffsetSeconds: dive.utcOffsetSeconds, durationSeconds: dive.durationSeconds, maxDepthM: dive.maxDepthM,
    enteredDeco: diveAssessment.enteredDeco, applies: diveAssessment.applies,
  }).from(dive).leftJoin(diveAssessment, eq(diveAssessment.diveId, dive.id))
    .where(and(eq(dive.diverId, d.diverId), isNull(dive.deletedAt),
      sql`${dive.startsAt} between (select starts_at - interval '3 days' from dive where id = ${d.id}::uuid) and (select starts_at + interval '2 days' from dive where id = ${d.id}::uuid)`))
    : [];
  const noFly = noFlyAfter(around.filter((x) => x.applies !== false).map((x) => seriesDive(x, x.enteredDeco ?? false)), d.id);
  const order = (f: { rule: string; startS: number | null }) => [f.startS ?? Number.MAX_SAFE_INTEGER, RULE_IDS.indexOf(f.rule as RuleId)] as const;
  return {
    engineVersion: assessment?.engineVersion ?? ENGINE_VERSION,
    /** False until the Dive was assessed with this engine version (a start after an update catches up in the background). */
    current: assessment?.engineVersion === ENGINE_VERSION,
    applies: assessment?.applies ?? true,
    recordingId: assessment?.recordingId ?? null,
    sampleIntervalS: assessment?.sampleIntervalS ?? null,
    ascentBands: assessment?.ascentBands ?? [],
    profile: assessment?.profile ?? null,
    findings: findings.filter((f) => isRule(f.rule)).map((f) => ({
      rule: f.rule as RuleId, severity: f.severity, startS: f.startS, endS: f.endS, values: f.values,
      dismissed: dismissed.has(f.rule), muted: muted.has(f.rule),
    })).sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1]),
    noFly,
    computerEvents: events.flatMap((e): { atS: number; event: ComputerEvent }[] => {
      const event = computerEventOf(e.type, e.data);
      return event ? [{ atS: Math.round(e.offsetMs / 1000), event }] : [];
    }),
  };
}

export type AssessmentService = ReturnType<typeof createAssessmentService>;
export type AssessmentView = Awaited<ReturnType<typeof read>>;

// The logbook's reads for the API (ADR 0017, 0040, 0042, 0053): the list of Dives with its counts, totals and months, the
// neighbours of one Dive in that list, a Recording's sample series, and the reads behind a Dive's own routes (the Dive
// a User manages, its Recordings and site, the Dive before it, its Cylinders, Lead and Participants, its version, the deleted Dives, its Revisions). Who may see what is decided by the caller, which
// passes the Divers the User manages. A lookup that may find nothing answers null; one whose thing must exist throws (as
// lockManagedDive in dive-service.ts does).
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { PARTICIPANT_ROLES, device, dive, diveAssessment, diveSite, diver, diverManagement, importJob, participant, recording, revision, sampleSeries, user } from '../db/schema.js';
import { cylindersOf } from './cylinders.js';
import { participantsOf } from './dive-service.js';
import { managedDiverIds, managesDiveDiver } from '../divers/management.js';
import { diveListFilter, FINDINGS_SHOWN } from './list-filter.js';
import { leadOf } from './weighting.js';

export const DIVE_SORTS = ['startsAt', 'number', 'maxDepth', 'duration'] as const;
export type DiveSort = (typeof DIVE_SORTS)[number];

/** What the list shows and in which order: the Diver, search and filters, shared by the page and a Dive's neighbours (ADR 0042). */
export interface ListScope {
  userId: string;
  diverIds: string[];
  siteId?: string | undefined;
  q?: string | undefined;
  only?: string | undefined;
  /** The Dives that changed since they were sent; see `DiveListFilter`. */
  changedIds?: string[] | undefined;
  sort?: DiveSort | undefined;
  order?: 'asc' | 'desc' | undefined;
}

/** The local month of a Dive, as the logbook groups it: an unknown offset keeps the wall-clock time as it is. */
const LOCAL_MONTH = sql<string>`to_char("dive"."starts_at" at time zone 'UTC' + make_interval(secs => coalesce("dive"."utc_offset_seconds", 0)), 'YYYY-MM')`;

const ROLE_ORDER = Object.fromEntries(PARTICIPANT_ROLES.map((r, i) => [r, i]));

export interface RowExtras {
  recordings: number;
  gases: { o2: number; he: number }[];
  surfaceIntervalSeconds: number | null;
  participants: { diverId: string; name: string; role: (typeof PARTICIPANT_ROLES)[number] }[];
  profile: { depthsM: number[]; spanSeconds: number; ascentBands: [number, number, 1 | 2 | 3][] } | null;
}

/** The stored sketch, only while it is of the Dive's current Primary recording (a change is assessed again shortly). */
const sketchOfDive = (
  d: typeof dive.$inferSelect,
  a: { recordingId: string | null; profile: { depthsM: number[]; spanSeconds: number } | null; ascentBands: [number, number, 1 | 2 | 3][] } | undefined,
): RowExtras['profile'] =>
  a?.profile && a.recordingId === d.primaryRecordingId ? { ...a.profile, ascentBands: a.ascentBands } : null;

export function createLogbookService(db: Db) {
  /** The Divers the User manages: every logbook read is scoped to them. */
  const managedDivers = async (userId: string) => [...await managedDiverIds(db, userId)];
  const scopeOf = ({ userId, diverIds, siteId, q, only, changedIds, sort = 'startsAt', order = 'desc' }: ListScope) => {
    const { filters, base, where } = diveListFilter({ userId, diverIds, siteId, q, only, changedIds });
    const column = { startsAt: dive.startsAt, number: dive.number, maxDepth: dive.maxDepthM, duration: dive.durationSeconds }[sort];
    // Dives without a value (no number, no depth) go last either way; the start time breaks ties.
    const direction = order === 'asc' ? sql`asc nulls last` : sql`desc nulls last`;
    const orderBy = [sql`${column} ${direction}`, desc(dive.startsAt), desc(dive.id)];
    return { filters, base, where, orderBy };
  };

  /** A page of the list, with the counts of each filter, the Diver's whole-logbook totals and the months of the page. Needs at least one Diver. */
  async function listDives(scope: ListScope, { limit, offset }: { limit: number; offset: number }) {
    const { diverIds, sort = 'startsAt' } = scope;
    const { filters, base, where, orderBy } = scopeOf(scope);
    const [rows, [counted], [counts], [totals]] = await Promise.all([
      db.select({ d: dive, siteName: diveSite.name, findings: FINDINGS_SHOWN }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(where)
        .orderBy(...orderBy)
        .limit(limit).offset(offset),
      db.select({ n: count() }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(where),
      db.select({
        noRecording: sql<number>`(count(*) filter (where ${filters['no-recording']}))::int`,
        noSite: sql<number>`(count(*) filter (where ${filters['no-site']}))::int`,
        withFindings: sql<number>`(count(*) filter (where ${filters['with-findings']}))::int`,
        notAtProvider: sql<number>`(count(*) filter (where ${filters['not-at-provider']}))::int`,
        changedSinceSent: sql<number>`(count(*) filter (where ${filters['changed-since-sent']}))::int`,
      }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(base),
      db.select({
        dives: count(), durationSeconds: sql<number>`coalesce(sum(${dive.durationSeconds}), 0)`.mapWith(Number),
        deepestM: sql<number | null>`max(${dive.maxDepthM})`, lastDiveAt: sql<Date | null>`max(${dive.startsAt})`.mapWith((v) => (v ? new Date(v) : null)),
      }).from(dive).where(and(inArray(dive.diverId, diverIds), isNull(dive.deletedAt))),
    ]);

    const pageIds = rows.map((r) => r.d.id);
    const primaryIds = rows.flatMap((r) => (r.d.primaryRecordingId ? [r.d.primaryRecordingId] : []));
    const [recordingCounts, primaries, people, assessments] = pageIds.length === 0 ? [[], [], [], []] : await Promise.all([
      db.select({ diveId: recording.diveId, n: count() }).from(recording)
        .where(and(inArray(recording.diveId, pageIds), isNull(recording.deletedAt))).groupBy(recording.diveId),
      primaryIds.length === 0 ? [] : db.select({ id: recording.id, summary: recording.summary }).from(recording).where(inArray(recording.id, primaryIds)),
      db.select({ diveId: participant.diveId, diverId: participant.diverId, name: diver.name, role: participant.role }).from(participant)
        .innerJoin(diver, eq(diver.id, participant.diverId)).where(and(inArray(participant.diveId, pageIds), isNull(diver.deletedAt))),
      db.select({ diveId: diveAssessment.diveId, recordingId: diveAssessment.recordingId, profile: diveAssessment.profile, ascentBands: diveAssessment.ascentBands })
        .from(diveAssessment).where(inArray(diveAssessment.diveId, pageIds)),
    ]);
    const recordingsOf = new Map(recordingCounts.map((c) => [c.diveId, c.n]));
    const summaryOf = new Map(primaries.map((p) => [p.id, p.summary]));
    const primary = (d: typeof dive.$inferSelect) => (d.primaryRecordingId ? summaryOf.get(d.primaryRecordingId) : undefined);
    const assessmentOf = new Map(assessments.map((a) => [a.diveId, a]));
    const peopleOf = new Map<string, typeof people>();
    for (const p of people.toSorted((a, b) => ROLE_ORDER[a.role]! - ROLE_ORDER[b.role]! || a.name.localeCompare(b.name))) {
      peopleOf.set(p.diveId, [...(peopleOf.get(p.diveId) ?? []), p]);
    }

    // The months of this page, with every matching Dive of each month (not only this page's share).
    let months: { month: string; dives: number; durationSeconds: number }[] = [];
    if (sort === 'startsAt' && rows.length > 0) {
      const monthOf = (d: typeof dive.$inferSelect) => new Date(d.startsAt.getTime() + (d.utcOffsetSeconds ?? 0) * 1000).toISOString().slice(0, 7);
      const onPage = [...new Set(rows.map((r) => monthOf(r.d)))];
      const sums = await db.select({ month: LOCAL_MONTH, dives: count(), durationSeconds: sql<number>`sum(${dive.durationSeconds})`.mapWith(Number) })
        .from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(and(where, sql`${LOCAL_MONTH} in ${onPage}`)).groupBy(LOCAL_MONTH);
      const byMonth = new Map(sums.map((m) => [m.month, m]));
      months = onPage.flatMap((month) => byMonth.get(month) ?? []);
    }

    return {
      rows: rows.map((r) => ({
        d: r.d, siteName: r.siteName, findings: r.findings,
        extras: {
          recordings: recordingsOf.get(r.d.id) ?? 0,
          gases: (primary(r.d)?.gases ?? []).map(({ o2, he }) => ({ o2, he })),
          surfaceIntervalSeconds: primary(r.d)?.surfaceIntervalSeconds ?? null,
          participants: (peopleOf.get(r.d.id) ?? []).map(({ diverId, name, role }) => ({ diverId, name, role })),
          profile: sketchOfDive(r.d, assessmentOf.get(r.d.id)),
        } satisfies RowExtras,
      })),
      total: counted?.n ?? 0,
      counts: counts!,
      totals: totals!,
      months,
    };
  }

  /** The id of this Dive when one of these Divers owns it and it is not deleted; null otherwise. */
  async function ownDiveId(diveId: string, diverIds: string[]) {
    if (diverIds.length === 0) return null;
    const [own] = await db.select({ id: dive.id }).from(dive)
      .where(and(eq(dive.id, diveId), inArray(dive.diverId, diverIds), isNull(dive.deletedAt)));
    return own?.id ?? null;
  }

  /** The Dives before and after one in the list's order; the position and neighbours are null when the list does not show it. */
  async function neighbours(diveId: string, scope: ListScope) {
    const { where, orderBy } = scopeOf(scope);
    const window = sql`over (order by ${sql.join(orderBy, sql`, `)})`;
    const shown = db.select({
      id: dive.id,
      position: sql<number>`(row_number() ${window})::int`.as('position'),
      previous: sql<string | null>`lag(${dive.id}) ${window}`.as('previous'),
      next: sql<string | null>`lead(${dive.id}) ${window}`.as('next'),
    }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(where).as('shown');
    const [[row], [counted]] = await Promise.all([
      db.select().from(shown).where(eq(shown.id, diveId)),
      db.select({ n: count() }).from(dive).leftJoin(diveSite, eq(diveSite.id, dive.siteId)).where(where),
    ]);
    return { previous: row?.previous ?? null, next: row?.next ?? null, position: row?.position ?? null, total: counted?.n ?? 0 };
  }

  /** The id of this Recording when it is on a Dive of one of these Divers and not deleted; null otherwise. */
  async function ownRecordingId(recordingId: string, diverIds: string[]) {
    if (diverIds.length === 0) return null;
    const [rec] = await db.select({ id: recording.id }).from(recording)
      .innerJoin(dive, eq(dive.id, recording.diveId))
      .where(and(eq(recording.id, recordingId), inArray(dive.diverId, diverIds), isNull(recording.deletedAt)));
    return rec?.id ?? null;
  }

  /** The Recording's stored sample series, all or only these channels. */
  const samplesOf = (recordingId: string, channels?: string[]) =>
    db.select().from(sampleSeries).where(and(
      eq(sampleSeries.recordingId, recordingId),
      ...(channels?.length ? [inArray(sampleSeries.channel, channels)] : []),
    ));

  /** The Dive if the User manages its Diver and it isn't deleted; null otherwise. */
  async function findManagedDive(userId: string, id: string) {
    const [row] = await db.select({ d: dive }).from(dive)
      .innerJoin(diverManagement, managesDiveDiver(userId))
      .where(and(eq(dive.id, id), isNull(dive.deletedAt)));
    return row?.d ?? null;
  }

  /** A Dive's live Recordings with their Device and sample channels, earliest first, and its Dive site. */
  async function recordingsAndSite(row: typeof dive.$inferSelect) {
    const recordings = await db.select({
      r: recording,
      d: device,
      channels: sql<string[]>`coalesce((select array_agg(channel order by channel) from ${sampleSeries} where ${sampleSeries.recordingId} = ${recording.id}), '{}')`,
    }).from(recording).leftJoin(device, eq(device.id, recording.deviceId))
      .where(and(eq(recording.diveId, row.id), isNull(recording.deletedAt))).orderBy(recording.startsAt);
    const [site] = row.siteId
      ? await db.select({ id: diveSite.id, name: diveSite.name, waterType: diveSite.waterType }).from(diveSite).where(eq(diveSite.id, row.siteId))
      : [];
    return { recordings, site };
  }

  /** The Dive of the same Diver just before this one, not counting deleted ones; null for the Diver's first. */
  async function previousDive(row: typeof dive.$inferSelect) {
    const [previous] = await db.select().from(dive)
      .where(and(eq(dive.diverId, row.diverId), isNull(dive.deletedAt), lt(dive.startsAt, row.startsAt)))
      .orderBy(desc(dive.startsAt), desc(dive.id)).limit(1);
    return previous ?? null;
  }

  /** A Dive's Cylinders and Lead, each in its order. */
  async function partsOf(diveId: string) {
    return { cylinders: await cylindersOf(db, diveId), lead: await leadOf(db, diveId) };
  }

  /** A Dive's Participants with their names (ADR 0028). */
  const participantsOfDive = (diveId: string) => participantsOf(db, diveId);

  /** The stored version of a Dive, whether it is deleted or not; null when there is no such Dive. */
  async function versionOf(id: string) {
    const [row] = await db.select({ version: dive.version }).from(dive).where(eq(dive.id, id));
    return row?.version ?? null;
  }

  /** The deleted Dives of the Divers the User manages, most recently deleted first; where a merge or move sent each. */
  async function deletedDives(userId: string, limit: number) {
    const rows = await db.select({ d: dive, siteName: diveSite.name }).from(dive)
      .innerJoin(diverManagement, managesDiveDiver(userId))
      .leftJoin(diveSite, eq(diveSite.id, dive.siteId))
      .where(isNotNull(dive.deletedAt))
      .orderBy(desc(dive.deletedAt), desc(dive.id)).limit(limit);
    // Why it is gone, when it wasn't deleted by hand: the latest Revision names the Dive it went into.
    const last = rows.length === 0 ? [] : await db.selectDistinctOn([revision.entityId], { id: revision.entityId, changes: revision.changes })
      .from(revision).where(and(eq(revision.entityType, 'dive'), inArray(revision.entityId, rows.map((r) => r.d.id))))
      .orderBy(revision.entityId, desc(revision.at), desc(revision.id));
    const went = (id: string, key: 'mergedInto' | 'movedTo') => {
      const to = last.find((r) => r.id === id)?.changes[key]?.to;
      return typeof to === 'string' ? to : null;
    };
    return rows.map(({ d, siteName }) => ({ d, siteName, mergedInto: went(d.id, 'mergedInto'), movedTo: went(d.id, 'movedTo') }));
  }

  /** The Revisions of a Dive and of its Recordings, newest first (at most 200), with the name of who made each. */
  async function revisionsOfDive(diveId: string) {
    const recIds = (await db.select({ id: recording.id }).from(recording).where(eq(recording.diveId, diveId))).map((r) => r.id);
    return db.select({
      r: revision,
      userName: user.name,
      uploadName: importJob.uploadName,
    }).from(revision)
      .leftJoin(user, and(eq(revision.actorType, 'user'), sql`${user.id}::text = ${revision.actorId}`))
      .leftJoin(importJob, and(eq(revision.actorType, 'import'), sql`${importJob.id}::text = ${revision.actorId}`))
      .where(or(
        and(eq(revision.entityType, 'dive'), eq(revision.entityId, diveId)),
        ...(recIds.length ? [and(eq(revision.entityType, 'recording'), inArray(revision.entityId, recIds))] : []),
      ))
      .orderBy(desc(revision.at), desc(revision.id)).limit(200);
  }

  return { managedDivers, listDives, ownDiveId, neighbours, ownRecordingId, samplesOf, findManagedDive, recordingsAndSite, previousDive, partsOf, participantsOfDive, versionOf, deletedDives, revisionsOfDive };
}

export type LogbookService = ReturnType<typeof createLogbookService>;

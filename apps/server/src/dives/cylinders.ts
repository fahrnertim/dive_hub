// The Cylinders of a Dive (ADR 0031, 0045): the Dive's own values, set as one list. A Cylinder may be tied to one
// pressure series of one of the Dive's Recordings; an import makes them from a tank pod's data where the Dive has none.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { cylinder, dive, recording, revision, sampleSeries, type CylinderMaterial } from '../db/schema.js';
import type { ProviderCylinder } from '../providers/provider.js';
import { writeRevision, type Actor, type Changes, type RevisionCause } from './revisions.js';

export class CylinderError extends Error {
  constructor(readonly code: 'cylinder_invalid' | 'cylinder_series_not_found') {
    super(code);
  }
}

export interface CylinderInput {
  volumeL?: number | null;
  workingPressureBar?: number | null;
  material?: CylinderMaterial | null;
  /** In percent. */
  gas?: { o2: number; he: number } | null;
  startPressureBar?: number | null;
  endPressureBar?: number | null;
  /** The pressure series of one of the Dive's Recordings that measured this Cylinder. */
  series?: { recordingId: string; channel: string } | null;
}

export interface Cylinder extends Required<CylinderInput> {
  /** An import made it from a tank pod's data, and it still has the pod's series. */
  fromPod: boolean;
}

/** A tank pod's pressure: `tankPressure`, further pods `tankPressure:<n>` (ADR 0037). */
const PRESSURE_CHANNEL = /^tankPressure(?::(\d+))?$/;

const sameSeries = (a: Cylinder['series'], b: Cylinder['series']) =>
  !!a && !!b && a.recordingId === b.recordingId && a.channel === b.channel;

/** A Dive's Cylinders in their order. */
export async function cylindersOf(tx: Tx | Db, diveId: string): Promise<Cylinder[]> {
  const rows = await tx.select().from(cylinder).where(eq(cylinder.diveId, diveId)).orderBy(asc(cylinder.position));
  return rows.map((r) => ({
    volumeL: r.volumeL, workingPressureBar: r.workingPressureBar, material: r.material,
    gas: r.o2 === null || r.he === null ? null : { o2: r.o2, he: r.he },
    startPressureBar: r.startPressureBar, endPressureBar: r.endPressureBar, fromPod: r.fromPod,
    series: r.recordingId && r.channel ? { recordingId: r.recordingId, channel: r.channel } : null,
  }));
}

async function write(tx: Tx, diveId: string, list: Cylinder[]) {
  await tx.delete(cylinder).where(eq(cylinder.diveId, diveId));
  if (list.length === 0) return;
  await tx.insert(cylinder).values(list.map((c, position) => ({
    diveId, position, volumeL: c.volumeL, workingPressureBar: c.workingPressureBar, material: c.material,
    o2: c.gas?.o2 ?? null, he: c.gas?.he ?? null, startPressureBar: c.startPressureBar, endPressureBar: c.endPressureBar,
    fromPod: c.fromPod, recordingId: c.series?.recordingId ?? null, channel: c.series?.channel ?? null,
  })));
}

/**
 * Replaces the Dive's Cylinders with `list` and answers the change for the Dive's Revision (empty when nothing differs).
 * The caller holds the Dive's lock, raises its version and writes the Revision.
 */
export async function setCylinders(tx: Tx, diveId: string, list: CylinderInput[]): Promise<Changes> {
  const before = await cylindersOf(tx, diveId);
  const next: Cylinder[] = list.map((c) => {
    const series = c.series ?? null;
    return {
      volumeL: c.volumeL ?? null, workingPressureBar: c.workingPressureBar ?? null, material: c.material ?? null,
      gas: c.gas ?? null, startPressureBar: c.startPressureBar ?? null, endPressureBar: c.endPressureBar ?? null,
      fromPod: before.some((b) => b.fromPod && sameSeries(b.series, series)), series,
    };
  });
  if (JSON.stringify(before) === JSON.stringify(next)) return {};
  for (const c of next) {
    if (c.startPressureBar !== null && c.endPressureBar !== null && c.endPressureBar > c.startPressureBar) throw new CylinderError('cylinder_invalid');
    if (c.gas && c.gas.o2 + c.gas.he > 100) throw new CylinderError('cylinder_invalid');
  }
  const tied = next.flatMap((c) => (c.series ? [c.series] : []));
  if (tied.some((s, i) => tied.findIndex((o) => sameSeries(o, s)) !== i)) throw new CylinderError('cylinder_invalid');
  if (tied.length > 0) {
    const found = await tx.select({ recordingId: sampleSeries.recordingId, channel: sampleSeries.channel }).from(sampleSeries)
      .innerJoin(recording, eq(recording.id, sampleSeries.recordingId))
      .where(and(eq(recording.diveId, diveId), isNull(recording.deletedAt), inArray(sampleSeries.recordingId, tied.map((s) => s.recordingId))));
    if (!tied.every((s) => PRESSURE_CHANNEL.test(s.channel) && found.some((f) => sameSeries(f, s)))) throw new CylinderError('cylinder_series_not_found');
  }
  await write(tx, diveId, next);
  return { cylinders: { from: before, to: next } };
}

/**
 * Where the Dive has no Cylinders, makes them from what a Recording that just came to it knows of its tanks (ADR 0045):
 * one per gas the computer gives a start or an end pressure for, with its size, and one per pressure series of a tank
 * pod. The first series is `tankPressure` whatever its gas's number, so the series in their order belong to the gases
 * that carry pressures, in theirs; such a Cylinder is tied to its series and marked as from the pod, and takes the
 * first and last reading where the computer sums up no pressure. A gas without a pressure makes none: a computer lists
 * every gas it was set to. Answers the change for the caller's Revision (empty when nothing was made).
 */
export async function fillCylindersFromRecording(tx: Tx, diveId: string, rec: Pick<typeof recording.$inferSelect, 'id' | 'summary'>): Promise<Changes> {
  const order = (channel: string) => Number(PRESSURE_CHANNEL.exec(channel)?.[1] ?? 0);
  const series = (await tx.select().from(sampleSeries).where(eq(sampleSeries.recordingId, rec.id)))
    .filter((s) => PRESSURE_CHANNEL.test(s.channel) && s.values.length > 0)
    .sort((a, b) => order(a.channel) - order(b.channel));
  const measured = (rec.summary.gases ?? []).filter((g) => g.startPressureBar !== undefined || g.endPressureBar !== undefined);
  const count = Math.max(series.length, measured.length);
  if (count === 0) return {};
  const [has] = await tx.select({ position: cylinder.position }).from(cylinder).where(eq(cylinder.diveId, diveId)).limit(1);
  if (has) return {};
  const made: Cylinder[] = Array.from({ length: count }, (_, i) => {
    const gas = measured[i];
    const s = series[i];
    return {
      volumeL: gas?.tankVolumeL ?? null, workingPressureBar: null, material: null, gas: gas ? { o2: gas.o2, he: gas.he } : null,
      startPressureBar: gas?.startPressureBar ?? s?.values[0] ?? null, endPressureBar: gas?.endPressureBar ?? s?.values.at(-1) ?? null,
      fromPod: !!s, series: s ? { recordingId: rec.id, channel: s.channel } : null,
    };
  });
  await write(tx, diveId, made);
  return { cylinders: { from: [], to: made } };
}

/** Raises the Dive's version and writes one Revision for a change to its Cylinders alone. The caller holds its lock. */
export async function reviseDive(tx: Tx, diveId: string, actor: Actor, cause: RevisionCause, changes: Changes): Promise<void> {
  await tx.update(dive).set({ version: sql`${dive.version} + 1`, updatedAt: new Date() }).where(eq(dive.id, diveId));
  await writeRevision(tx, 'dive', diveId, actor, cause, changes);
}

/**
 * Dives imported before Cylinders were kept get them from what their Recordings know of their tanks (ADR 0045): every
 * Dive without Cylinders whose history never spoke of any, so one a User emptied stays empty. By the hub itself, one Revision each.
 * Returns how many Dives got Cylinders.
 */
export async function fillMissingCylinders(db: Db): Promise<number> {
  const candidates = await db.selectDistinct({ id: dive.id }).from(dive)
    .innerJoin(recording, and(eq(recording.diveId, dive.id), isNull(recording.deletedAt)))
    .where(and(
      isNull(dive.deletedAt),
      sql`(exists (select 1 from ${sampleSeries} where ${sampleSeries.recordingId} = ${recording.id} and ${sampleSeries.channel} ~ '^tankPressure(:[0-9]+)?$')
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(${recording.summary} -> 'gases') = 'array' then ${recording.summary} -> 'gases' else '[]'::jsonb end) g
          where jsonb_exists(g, 'startPressureBar') or jsonb_exists(g, 'endPressureBar')))`,
      sql`not exists (select 1 from ${cylinder} where ${cylinder.diveId} = ${dive.id})`,
      sql`not exists (select 1 from ${revision} where ${revision.entityType} = 'dive' and ${revision.entityId} = ${dive.id} and jsonb_exists(${revision.changes}, 'cylinders'))`,
    ));
  let filled = 0;
  for (const { id } of candidates) {
    filled += await db.transaction(async (tx) => {
      await tx.select({ id: dive.id }).from(dive).where(eq(dive.id, id)).for('update');
      const recordings = await tx.select().from(recording)
        .where(and(eq(recording.diveId, id), isNull(recording.deletedAt))).orderBy(asc(recording.createdAt));
      for (const rec of recordings) {
        const changes = await fillCylindersFromRecording(tx, id, rec);
        if (Object.keys(changes).length === 0) continue;
        await reviseDive(tx, id, { type: 'system', id: 'fill-cylinders' }, 'fill', changes);
        return 1;
      }
      return 0;
    });
  }
  return filled;
}

/** A Cylinder in the values a Provider's logbook keeps for its one tank (ADR 0031). */
export const providerCylinderOf = ({ volumeL, material, startPressureBar, endPressureBar, gas }: Cylinder): ProviderCylinder =>
  ({ volumeL, material, startPressureBar, endPressureBar, gas });

/**
 * The one tank typed at a Provider, on a Dive (ADR 0045, amended). `fill`: a Dive without Cylinders gets it as one,
 * unless its history spoke of Cylinders (one a User emptied stays empty), and a Dive's only Cylinder takes the values
 * it lacks. `take`: the only Cylinder takes every value the Provider has, a Dive without Cylinders gets one. What the
 * Provider doesn't keep stays (working pressure, the series, "from the pod"), and so does a value it has none for.
 * With several Cylinders nothing: the tank can't be told to be one of them. Pressures that would end above their
 * start are left as they were. Answers the change for the caller's Revision (empty when nothing differs).
 */
export async function mergeProviderCylinder(tx: Tx, diveId: string, tank: ProviderCylinder, how: 'fill' | 'take'): Promise<Changes> {
  const before = await cylindersOf(tx, diveId);
  if (before.length > 1) return {};
  const only = before[0];
  if (!only && how === 'fill') {
    const [spoken] = await tx.select({ id: revision.id }).from(revision)
      .where(and(eq(revision.entityType, 'dive'), eq(revision.entityId, diveId), sql`jsonb_exists(${revision.changes}, 'cylinders')`)).limit(1);
    if (spoken) return {};
  }
  const base: Cylinder = only ?? {
    volumeL: null, workingPressureBar: null, material: null, gas: null, startPressureBar: null, endPressureBar: null, fromPod: false, series: null,
  };
  const pick = <T>(here: T | null, theirs: T | null) => (how === 'fill' ? here ?? theirs : theirs ?? here);
  const next: Cylinder = {
    ...base, volumeL: pick(base.volumeL, tank.volumeL), material: pick(base.material, tank.material), gas: pick(base.gas, tank.gas),
    startPressureBar: pick(base.startPressureBar, tank.startPressureBar), endPressureBar: pick(base.endPressureBar, tank.endPressureBar),
  };
  if (next.startPressureBar !== null && next.endPressureBar !== null && next.endPressureBar > next.startPressureBar) {
    next.startPressureBar = base.startPressureBar;
    next.endPressureBar = base.endPressureBar;
  }
  if (JSON.stringify(base) === JSON.stringify(next)) return {};
  await write(tx, diveId, [next]);
  return { cylinders: { from: before, to: [next] } };
}

/** A Recording left the Dive: the Cylinders tied to its series stay, without the series. Answers the change for the Revision. */
export async function untieRecording(tx: Tx, diveId: string, recordingId: string): Promise<Changes> {
  const before = await cylindersOf(tx, diveId);
  if (!before.some((c) => c.series?.recordingId === recordingId)) return {};
  await tx.update(cylinder).set({ recordingId: null, channel: null, fromPod: false })
    .where(and(eq(cylinder.diveId, diveId), eq(cylinder.recordingId, recordingId)));
  return { cylinders: { from: before, to: await cylindersOf(tx, diveId) } };
}

/**
 * A Recording was imported again: a Cylinder tied to a series it no longer has stays, without the series, or nothing
 * about the Dive's Cylinders could be saved. Answers the change for the Revision.
 */
export async function untieLostSeries(tx: Tx, diveId: string, recordingId: string): Promise<Changes> {
  const before = await cylindersOf(tx, diveId);
  const tied = before.flatMap((c) => (c.series?.recordingId === recordingId ? [c.series.channel] : []));
  if (tied.length === 0) return {};
  const has = (await tx.select({ channel: sampleSeries.channel }).from(sampleSeries).where(eq(sampleSeries.recordingId, recordingId))).map((s) => s.channel);
  const lost = tied.filter((channel) => !has.includes(channel));
  if (lost.length === 0) return {};
  await tx.update(cylinder).set({ recordingId: null, channel: null, fromPod: false })
    .where(and(eq(cylinder.diveId, diveId), eq(cylinder.recordingId, recordingId), inArray(cylinder.channel, lost)));
  return { cylinders: { from: before, to: await cylindersOf(tx, diveId) } };
}

/** Merging two Dives (ADR 0038): the kept Dive takes the other's Cylinders where it has none. Answers the change for the Revision. */
export async function takeCylinders(tx: Tx, keptId: string, otherId: string): Promise<Changes> {
  if ((await cylindersOf(tx, keptId)).length > 0) return {};
  const moved = await tx.update(cylinder).set({ diveId: keptId }).where(eq(cylinder.diveId, otherId)).returning({ position: cylinder.position });
  return moved.length === 0 ? {} : { cylinders: { from: [], to: await cylindersOf(tx, keptId) } };
}

/** What "same as last dive" copies of a Cylinder: what it is and what it held, not what was breathed from it. */
export const withoutPressures = ({ volumeL, workingPressureBar, material, gas }: Cylinder) => ({ volumeL, workingPressureBar, material, gas });

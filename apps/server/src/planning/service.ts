// What the routes and the MCP tool answer (ADR 0032, slice 21): gas numbers, and bottom time with its defaults from the
// Diver's own logbook. Computed on request, nothing stored. Limits from the Diver's own input and settings, not advice.
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { cylinder, dive, diveSite, recording } from '../db/schema.js';
import { sacOfDive } from '../dives/sac.js';
import { bottomTime } from './bottom-time.js';
import { type GasRule } from './gas-plan.js';
import { DEFAULT_PLANNING_SAC_LPM, planningSac } from './planning-sac.js';
import { ambientPressureBar, bestMixPercent, eadMetres, endMetres, isHypoxic, modMetres, type Conditions } from './gas.js';

/** Defaults that no source overrides (ADR 0032). */
export const DEFAULT_GF_HIGH = 85;
export const DEFAULT_PPO2 = { working: 1.4, contingency: 1.6 };
/** How many of a Diver's latest Dives are looked through for the 20 that have a SAC. */
const SAC_LOOKBACK_DIVES = 100;
const RECENT_DIVE_HOURS = 48;

/** The rules a single bottom time can be limited by (turn rules need a group and a return, ADR 0033). */
export const BOTTOM_TIME_RULES = ['rock_bottom', 'reserve', 'ascent_pressure'] as const;

export const PLANNING_WATERS = ['fresh', 'salt', 'en13319'] as const;
export type PlanningWaterName = (typeof PLANNING_WATERS)[number];

export class PlanningError extends Error {
  constructor(readonly code: 'invalid_input' | 'gas_not_breathable' | 'diver_not_found' | 'site_not_found') {
    super(code);
  }
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
/** Depth limits are rounded down: a figure may be shallower than the exact one, never deeper. */
export const floorTenth = (n: number) => Math.floor(n * 10 + 1e-9) / 10;

export interface GasQuery {
  o2: number;
  he?: number | undefined;
  depth?: number | undefined;
  water?: PlanningWaterName | undefined;
  altitude?: number | undefined;
  ppo2Working?: number | undefined;
  ppo2Contingency?: number | undefined;
  oxygenNarcotic?: boolean | undefined;
}

export function gasNumbers(q: GasQuery) {
  const gas = { o2: q.o2, he: q.he ?? 0 };
  if (gas.o2 + gas.he > 100) throw new PlanningError('invalid_input');
  // Below 0.16 bar of oxygen at the surface a mix is not breathable.
  if (gas.o2 < 16) throw new PlanningError('gas_not_breathable');
  const conditions: Conditions = { water: q.water ?? 'salt', altitudeM: q.altitude ?? 0 };
  const ppO2Limits = { working: q.ppo2Working ?? DEFAULT_PPO2.working, contingency: q.ppo2Contingency ?? DEFAULT_PPO2.contingency };
  const oxygenNarcotic = q.oxygenNarcotic ?? true;
  return {
    gas, hypoxic: isHypoxic(gas), ppO2Limits,
    modWorkingM: floorTenth(modMetres(gas, ppO2Limits.working, conditions)),
    modContingencyM: floorTenth(modMetres(gas, ppO2Limits.contingency, conditions)),
    atDepth: q.depth === undefined ? null : {
      depthM: q.depth,
      ppO2: round((gas.o2 / 100) * ambientPressureBar(q.depth, conditions), 2),
      bestMixPercent: bestMixPercent(q.depth, ppO2Limits.working, conditions),
      eadM: round(eadMetres(gas, q.depth, conditions), 1),
      endM: round(endMetres(gas, q.depth, conditions, { oxygenNarcotic }), 1),
    },
    conditions, oxygenNarcotic,
  };
}

export interface BottomTimeQuery {
  depth: number;
  o2: number;
  he?: number | undefined;
  volume?: number | undefined;
  pressure?: number | undefined;
  sac?: number | undefined;
  rule?: (typeof BOTTOM_TIME_RULES)[number] | undefined;
  bar?: number | undefined;
  gfHigh?: number | undefined;
  water?: PlanningWaterName | undefined;
  altitude?: number | undefined;
  ppo2Working?: number | undefined;
  ppo2Contingency?: number | undefined;
  diverId?: string | undefined;
  siteId?: string | undefined;
}

export type Source = 'request' | 'recording' | 'logbook' | 'site' | 'default';

/** The SAC of each of a Diver's latest Dives, newest first: from its Cylinders, else a tank pod's on its Recording (ADR 0033). */
export async function diveSacs(reader: Queryable, diverId: string): Promise<{ sacLpm: number | null }[]> {
  const dives = await reader.select({ id: dive.id, durationSeconds: dive.durationSeconds, avgDepthM: dive.avgDepthM }).from(dive)
    .where(and(eq(dive.diverId, diverId), isNull(dive.deletedAt))).orderBy(desc(dive.startsAt)).limit(SAC_LOOKBACK_DIVES);
  if (dives.length === 0) return [];
  const ids = dives.map((d) => d.id);
  const cylinders = await reader.select().from(cylinder).where(inArray(cylinder.diveId, ids)).orderBy(cylinder.position);
  const recordings = await reader.select({ diveId: recording.diveId, summary: recording.summary }).from(recording)
    .where(and(inArray(recording.diveId, ids), isNull(recording.deletedAt))).orderBy(desc(recording.startsAt));
  return dives.map((d) => {
    const own = cylinders.filter((c) => c.diveId === d.id).map((c) => ({
      volumeL: c.volumeL, startPressureBar: c.startPressureBar, endPressureBar: c.endPressureBar,
      gas: c.o2 === null || c.he === null ? null : { o2: c.o2, he: c.he },
    }));
    const fromCylinders = sacOfDive(d, own).sac?.litresPerMinute;
    const fromPod = recordings.find((r) => r.diveId === d.id && r.summary.sacLpm !== undefined)?.summary.sacLpm;
    return { sacLpm: fromCylinders ?? fromPod ?? null };
  });
}

/** When the Diver's Dive within the last 48 hours ended, if there is one: the real limit is then shorter than shown. */
export async function recentDiveEnd(reader: Queryable, diverId: string): Promise<Date | null> {
  const now = Date.now();
  const dives = await reader.select({ startsAt: dive.startsAt, durationSeconds: dive.durationSeconds }).from(dive)
    .where(and(eq(dive.diverId, diverId), isNull(dive.deletedAt), gte(dive.startsAt, new Date(now - (RECENT_DIVE_HOURS + 12) * 3600_000))));
  let latest: Date | null = null;
  for (const d of dives) {
    const end = d.startsAt.getTime() + d.durationSeconds * 1000;
    if (end <= now && end >= now - RECENT_DIVE_HOURS * 3600_000 && (!latest || end > latest.getTime())) latest = new Date(end);
  }
  return latest;
}

/** The planned site's water; brackish counts as salt for the limit. */
export async function siteWaterOf(reader: Queryable, siteId: string | undefined): Promise<'fresh' | 'salt' | undefined> {
  if (!siteId) return undefined;
  const [site] = await reader.select({ waterType: diveSite.waterType }).from(diveSite).where(eq(diveSite.id, siteId));
  if (!site) throw new PlanningError('site_not_found');
  if (!site.waterType) return undefined;
  return site.waterType === 'fresh' ? 'fresh' : 'salt';
}

/** `managedDiverIds` are the Divers the signed-in User manages: a Diver outside them is "not found". */
export async function planBottomTime(reader: Queryable, managedDiverIds: readonly string[], q: BottomTimeQuery) {
  const gas = { o2: q.o2, he: q.he ?? 0 };
  if (gas.o2 + gas.he > 100) throw new PlanningError('invalid_input');
  if ((q.volume === undefined) !== (q.pressure === undefined)) throw new PlanningError('invalid_input');
  // Reserve and ascent pressure need their bar.
  if ((q.rule === 'reserve' || q.rule === 'ascent_pressure') && q.bar === undefined) throw new PlanningError('invalid_input');

  // What the Diver's own computer and logbook say, where the User manages the Diver.
  let gfFromRecording: number | undefined;
  let logbookSac: ReturnType<typeof planningSac> | undefined;
  let recentDiveEndedAt: Date | null = null;
  if (q.diverId) {
    if (!managedDiverIds.includes(q.diverId)) throw new PlanningError('diver_not_found');
    const recent = await reader.select({ summary: recording.summary }).from(recording)
      .innerJoin(dive, eq(dive.id, recording.diveId))
      .where(and(eq(dive.diverId, q.diverId), isNull(recording.deletedAt), isNull(dive.deletedAt)))
      .orderBy(desc(recording.startsAt)).limit(100);
    gfFromRecording = recent.find((r) => r.summary.gfHigh !== undefined)?.summary.gfHigh;
    logbookSac = planningSac(await diveSacs(reader, q.diverId));
    recentDiveEndedAt = await recentDiveEnd(reader, q.diverId);
  }

  const siteWater = await siteWaterOf(reader, q.siteId);

  const pick = <T>(requested: T | undefined, found: [T | undefined, Source] | undefined, fallback: T): { value: T; source: Source } =>
    requested !== undefined ? { value: requested, source: 'request' }
      : found?.[0] !== undefined ? { value: found[0], source: found[1] }
      : { value: fallback, source: 'default' };
  const used = {
    gfHigh: pick(q.gfHigh, [gfFromRecording, 'recording'], DEFAULT_GF_HIGH),
    sacLpm: {
      ...pick(q.sac, logbookSac?.source === 'logbook' ? [logbookSac.lpm, 'logbook'] : undefined, DEFAULT_PLANNING_SAC_LPM),
      // How many Dives the logbook's planning SAC rests on, also when it is too few and the default stands.
      ...(logbookSac && q.sac === undefined ? { basedOn: logbookSac.basedOn } : {}),
    },
    water: pick<PlanningWaterName>(q.water, [siteWater, 'site'], 'salt'),
    altitudeM: pick(q.altitude, undefined, 0),
    gasRule: ((): { value: { kind: (typeof BOTTOM_TIME_RULES)[number]; bar: number | null }; source: Source } => {
      if (q.rule === undefined) return { value: { kind: 'rock_bottom', bar: null }, source: 'default' };
      return { value: { kind: q.rule, bar: q.rule === 'rock_bottom' ? null : q.bar! }, source: 'request' };
    })(),
  };

  const result = bottomTime({
    gas, depthM: q.depth, gfHigh: used.gfHigh.value,
    conditions: { water: used.water.value, altitudeM: used.altitudeM.value },
    cylinder: q.volume !== undefined ? { volumeL: q.volume, startPressureBar: q.pressure! } : null,
    sacLpm: used.sacLpm.value, rule: used.gasRule.value.kind === 'rock_bottom' ? { kind: 'rock_bottom' } : { kind: used.gasRule.value.kind, bar: used.gasRule.value.bar! } as GasRule,
    ppO2: { working: q.ppo2Working ?? DEFAULT_PPO2.working, contingency: q.ppo2Contingency ?? DEFAULT_PPO2.contingency },
  });
  const common = { used, gas, depthM: q.depth, recentDiveEndedAt: recentDiveEndedAt?.toISOString() ?? null };
  if (result.status === 'outside_limits') {
    return { status: result.status, reason: result.reason, modM: result.modM === null ? null : floorTenth(result.modM), ...common };
  }
  const finite = (n: number) => (Number.isFinite(n) ? round(n, 1) : null);
  return {
    status: result.status, minutes: result.minutes, binding: result.binding,
    limits: { ndl: finite(result.limits.ndl), oxygen: finite(result.limits.oxygen), gas: result.limits.gas === null ? null : finite(result.limits.gas) },
    ascentPressureBar: result.ascentPressureBar === null ? null : round(result.ascentPressureBar, 1),
    otu: round(result.otu, 1), ppO2AtDepth: round(result.ppO2AtDepth, 2), ppO2AboveWorking: result.ppO2AboveWorking,
    ...common,
  };
}

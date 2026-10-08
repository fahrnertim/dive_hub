// What the routes and the MCP tool answer (ADR 0032, slice 21): gas numbers, and bottom time with its defaults from the
// Diver's own logbook. Computed on request, nothing stored. Limits from the Diver's own input and settings, not advice.
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dive, diveSite, recording } from '../db/schema.js';
import { bottomTime } from './bottom-time.js';
import { ambientPressureBar, bestMixPercent, eadMetres, endMetres, isHypoxic, modMetres, type Conditions } from './gas.js';

/** Defaults that no source overrides (ADR 0032). */
export const DEFAULT_GF_HIGH = 85;
export const DEFAULT_SAC_LPM = 20;
export const DEFAULT_RESERVE_BAR = 50;
export const DEFAULT_PPO2 = { working: 1.4, contingency: 1.6 };
/** Recordings whose SAC counts towards the median. */
const SAC_RECORDINGS = 10;
const RECENT_DIVE_HOURS = 48;

export const PLANNING_WATERS = ['fresh', 'salt', 'en13319'] as const;
export type PlanningWaterName = (typeof PLANNING_WATERS)[number];

export type PlanningError = 'invalid_input' | 'gas_not_breathable' | 'diver_not_found' | 'site_not_found';
export type Answer<T> = { ok: true; value: T } | { ok: false; code: PlanningError };

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
  if (gas.o2 + gas.he > 100) return { ok: false, code: 'invalid_input' } as const;
  // Below 0.16 bar of oxygen at the surface a mix is not breathable.
  if (gas.o2 < 16) return { ok: false, code: 'gas_not_breathable' } as const;
  const conditions: Conditions = { water: q.water ?? 'salt', altitudeM: q.altitude ?? 0 };
  const ppO2Limits = { working: q.ppo2Working ?? DEFAULT_PPO2.working, contingency: q.ppo2Contingency ?? DEFAULT_PPO2.contingency };
  const oxygenNarcotic = q.oxygenNarcotic ?? true;
  return {
    ok: true,
    value: {
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
    },
  } as const;
}

export interface BottomTimeQuery {
  depth: number;
  o2: number;
  he?: number | undefined;
  volume?: number | undefined;
  pressure?: number | undefined;
  sac?: number | undefined;
  reserve?: number | undefined;
  gfHigh?: number | undefined;
  water?: PlanningWaterName | undefined;
  altitude?: number | undefined;
  ppo2Working?: number | undefined;
  ppo2Contingency?: number | undefined;
  diverId?: string | undefined;
  siteId?: string | undefined;
}

type Source = 'request' | 'recording' | 'recordings' | 'site' | 'default';

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** `managedDiverIds` are the Divers the signed-in User manages: a Diver outside them is "not found". */
export async function planBottomTime(reader: Pick<Db, 'select'>, managedDiverIds: readonly string[], q: BottomTimeQuery) {
  const gas = { o2: q.o2, he: q.he ?? 0 };
  if (gas.o2 + gas.he > 100) return { ok: false, code: 'invalid_input' } as const;
  if ((q.volume === undefined) !== (q.pressure === undefined)) return { ok: false, code: 'invalid_input' } as const;

  // What the Diver's own computer and logbook say, where the User manages the Diver.
  let gfFromRecording: number | undefined;
  let sacFromRecordings: number | undefined;
  let recentDiveEndedAt: Date | null = null;
  if (q.diverId) {
    if (!managedDiverIds.includes(q.diverId)) return { ok: false, code: 'diver_not_found' } as const;
    const recent = await reader.select({ summary: recording.summary }).from(recording)
      .innerJoin(dive, eq(dive.id, recording.diveId))
      .where(and(eq(dive.diverId, q.diverId), isNull(recording.deletedAt), isNull(dive.deletedAt)))
      .orderBy(desc(recording.startsAt)).limit(100);
    gfFromRecording = recent.find((r) => r.summary.gfHigh !== undefined)?.summary.gfHigh;
    const sacs = recent.flatMap((r) => (r.summary.sacLpm !== undefined ? [r.summary.sacLpm] : [])).slice(0, SAC_RECORDINGS);
    if (sacs.length > 0) sacFromRecordings = round(median(sacs), 1);
    const now = Date.now();
    const dives = await reader.select({ startsAt: dive.startsAt, durationSeconds: dive.durationSeconds }).from(dive)
      .where(and(inArray(dive.diverId, [q.diverId]), isNull(dive.deletedAt), gte(dive.startsAt, new Date(now - (RECENT_DIVE_HOURS + 12) * 3600_000))));
    for (const d of dives) {
      const end = d.startsAt.getTime() + d.durationSeconds * 1000;
      if (end <= now && end >= now - RECENT_DIVE_HOURS * 3600_000 && (!recentDiveEndedAt || end > recentDiveEndedAt.getTime())) recentDiveEndedAt = new Date(end);
    }
  }

  // The planned site's water; brackish counts as salt for the limit.
  let siteWater: 'fresh' | 'salt' | undefined;
  if (q.siteId) {
    const [site] = await reader.select({ waterType: diveSite.waterType }).from(diveSite).where(eq(diveSite.id, q.siteId));
    if (!site) return { ok: false, code: 'site_not_found' } as const;
    if (site.waterType) siteWater = site.waterType === 'fresh' ? 'fresh' : 'salt';
  }

  const pick = <T>(requested: T | undefined, found: [T | undefined, Source] | undefined, fallback: T): { value: T; source: Source } =>
    requested !== undefined ? { value: requested, source: 'request' }
      : found?.[0] !== undefined ? { value: found[0], source: found[1] }
      : { value: fallback, source: 'default' };
  const used = {
    gfHigh: pick(q.gfHigh, [gfFromRecording, 'recording'], DEFAULT_GF_HIGH),
    sacLpm: pick(q.sac, [sacFromRecordings, 'recordings'], DEFAULT_SAC_LPM),
    water: pick<PlanningWaterName>(q.water, [siteWater, 'site'], 'salt'),
    altitudeM: pick(q.altitude, undefined, 0),
    reserveBar: pick(q.reserve, undefined, DEFAULT_RESERVE_BAR),
  };

  const result = bottomTime({
    gas, depthM: q.depth, gfHigh: used.gfHigh.value,
    conditions: { water: used.water.value, altitudeM: used.altitudeM.value },
    cylinder: q.volume !== undefined ? { volumeL: q.volume, startPressureBar: q.pressure! } : null,
    sacLpm: used.sacLpm.value, reserveBar: used.reserveBar.value,
    ppO2: { working: q.ppo2Working ?? DEFAULT_PPO2.working, contingency: q.ppo2Contingency ?? DEFAULT_PPO2.contingency },
  });
  const common = { used, gas, depthM: q.depth, recentDiveEndedAt: recentDiveEndedAt?.toISOString() ?? null };
  if (result.status === 'outside_limits') {
    return { ok: true, value: { status: result.status, reason: result.reason, modM: result.modM === null ? null : floorTenth(result.modM), ...common } } as const;
  }
  const finite = (n: number) => (Number.isFinite(n) ? round(n, 1) : null);
  return {
    ok: true,
    value: {
      status: result.status, minutes: result.minutes, binding: result.binding,
      limits: { ndl: finite(result.limits.ndl), oxygen: finite(result.limits.oxygen), gas: result.limits.gas === null ? null : finite(result.limits.gas) },
      otu: round(result.otu, 1), ppO2AtDepth: round(result.ppO2AtDepth, 2), ppO2AboveWorking: result.ppO2AboveWorking,
      ...common,
    },
  } as const;
}

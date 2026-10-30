// What the bottom time route and the MCP tool answer (ADR 0032, slice 21): bottom time with its defaults from the
// Diver's own logbook. Computed on request, nothing stored. Limits from the Diver's own input and settings, not advice.
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { dive, recording } from '../db/schema.js';
import { bottomTime } from './bottom-time.js';
import { DEFAULT_PPO2, floorTenth } from './gas-numbers.js';
import { type GasRule } from './gas-plan.js';
import type { PlanningWater } from './gas.js';
import { diveSacs, recentDiveEnd, siteWaterOf } from './logbook-inputs.js';
import { PlanningError } from './planning-error.js';
import { DEFAULT_PLANNING_SAC_LPM, planningSac } from './planning-sac.js';

/** Defaults that no source overrides (ADR 0032). */
export const DEFAULT_GF_HIGH = 85;

/** The rules a single bottom time can be limited by (turn rules need a group and a return, ADR 0033). */
export const BOTTOM_TIME_RULES = ['rock_bottom', 'reserve', 'ascent_pressure'] as const;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

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
  water?: PlanningWater | undefined;
  altitude?: number | undefined;
  ppo2Working?: number | undefined;
  ppo2Contingency?: number | undefined;
  diverId?: string | undefined;
  siteId?: string | undefined;
}

export type Source = 'request' | 'recording' | 'logbook' | 'site' | 'default';

/** What the Diver's own computer and logbook say; a Diver the User doesn't manage is "not found". */
async function diverLogbook(reader: Queryable, managedIds: readonly string[], diverId: string) {
  if (!managedIds.includes(diverId)) throw new PlanningError('diver_not_found');
  const recent = await reader.select({ summary: recording.summary }).from(recording)
    .innerJoin(dive, eq(dive.id, recording.diveId))
    .where(and(eq(dive.diverId, diverId), isNull(recording.deletedAt), isNull(dive.deletedAt)))
    .orderBy(desc(recording.startsAt)).limit(100);
  return {
    gfFromRecording: recent.find((r) => r.summary.gfHigh !== undefined)?.summary.gfHigh,
    logbookSac: planningSac(await diveSacs(reader, diverId)),
    recentDiveEndedAt: await recentDiveEnd(reader, diverId),
  };
}

export async function planBottomTime(reader: Queryable, managedIds: readonly string[], query: BottomTimeQuery) {
  const gas = { o2: query.o2, he: query.he ?? 0 };
  if (gas.o2 + gas.he > 100) throw new PlanningError('invalid_input');
  if ((query.volume === undefined) !== (query.pressure === undefined)) throw new PlanningError('invalid_input');
  // Reserve and ascent pressure need their bar.
  if ((query.rule === 'reserve' || query.rule === 'ascent_pressure') && query.bar === undefined) throw new PlanningError('invalid_input');

  // What the Diver's own computer and logbook say, where the User manages the Diver.
  const logbook = query.diverId ? await diverLogbook(reader, managedIds, query.diverId) : undefined;
  const logbookSac = logbook?.logbookSac;

  const siteWater = await siteWaterOf(reader, query.siteId);

  const pick = <T>(requested: T | undefined, found: [T | undefined, Source] | undefined, fallback: T): { value: T; source: Source } =>
    requested !== undefined ? { value: requested, source: 'request' }
      : found?.[0] !== undefined ? { value: found[0], source: found[1] }
      : { value: fallback, source: 'default' };
  const used = {
    gfHigh: pick(query.gfHigh, [logbook?.gfFromRecording, 'recording'], DEFAULT_GF_HIGH),
    sacLpm: {
      ...pick(query.sac, logbookSac?.source === 'logbook' ? [logbookSac.lpm, 'logbook'] : undefined, DEFAULT_PLANNING_SAC_LPM),
      // How many Dives the logbook's planning SAC rests on, also when it is too few and the default stands.
      ...(logbookSac && query.sac === undefined ? { basedOn: logbookSac.basedOn } : {}),
    },
    water: pick<PlanningWater>(query.water, [siteWater, 'site'], 'salt'),
    altitudeM: pick(query.altitude, undefined, 0),
    gasRule: ((): { value: { kind: (typeof BOTTOM_TIME_RULES)[number]; bar: number | null }; source: Source } => {
      if (query.rule === undefined) return { value: { kind: 'rock_bottom', bar: null }, source: 'default' };
      return { value: { kind: query.rule, bar: query.rule === 'rock_bottom' ? null : query.bar! }, source: 'request' };
    })(),
  };

  const result = bottomTime({
    gas, depthM: query.depth, gfHigh: used.gfHigh.value,
    conditions: { water: used.water.value, altitudeM: used.altitudeM.value },
    cylinder: query.volume !== undefined ? { volumeL: query.volume, startPressureBar: query.pressure! } : null,
    sacLpm: used.sacLpm.value, rule: used.gasRule.value.kind === 'rock_bottom' ? { kind: 'rock_bottom' } : { kind: used.gasRule.value.kind, bar: used.gasRule.value.bar! } as GasRule,
    ppO2: { working: query.ppo2Working ?? DEFAULT_PPO2.working, contingency: query.ppo2Contingency ?? DEFAULT_PPO2.contingency },
  });
  const common = { used, gas, depthM: query.depth, recentDiveEndedAt: logbook?.recentDiveEndedAt?.toISOString() ?? null };
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

// What the gas plan route and the MCP tool answer (ADR 0033, slice 22): the plan's litres and pressures per Diver, with
// where each value came from. Computed on request, nothing stored; any Diver of the instance can be named by id (ADR 0028),
// and only of a Diver the User manages a logbook value is read: the others plan with what is typed or the default. Limits from the Diver's own input and settings, not advice.
import type { Db } from '../db/client.js';
import { ASCENT_RATE_M_PER_MIN, planGas, type GasRule } from './gas-plan.js';
import { DESCENT_RATE_M_PER_MIN } from './ndl.js';
import { DEFAULT_PLANNING_SAC_LPM, planningSac } from './planning-sac.js';
import { DEFAULT_PPO2, diveSacs, recentDiveEnd, siteWaterOf, type PlanningError, type PlanningWaterName } from './service.js';

export const PLAN_RULES = ['rock_bottom', 'reserve', 'ascent_pressure', 'halves', 'thirds', 'sixths'] as const;
export type PlanRuleName = (typeof PLAN_RULES)[number];

export interface GasPlanQuery {
  o2: number;
  he?: number | undefined;
  levels: { depth: number; minutes: number }[];
  divers: { name: string; volume: number; pressure: number; sac?: number | undefined; diverId?: string | undefined }[];
  rule?: PlanRuleName | undefined;
  bar?: number | undefined;
  water?: PlanningWaterName | undefined;
  altitude?: number | undefined;
  ppo2Contingency?: number | undefined;
  siteId?: string | undefined;
  /** Metres a minute. */
  descentRate?: number | undefined;
  ascentRate?: number | undefined;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

export async function planGasPlan(reader: Pick<Db, 'select'>, managedDiverIds: readonly string[], q: GasPlanQuery): Promise<
  | { ok: false; code: PlanningError }
  | { ok: true; value: Record<string, unknown> }
> {
  const gas = { o2: q.o2, he: q.he ?? 0 };
  if (gas.o2 + gas.he > 100) return { ok: false, code: 'invalid_input' };
  if ((q.rule === 'reserve' || q.rule === 'ascent_pressure') && q.bar === undefined) return { ok: false, code: 'invalid_input' };

  const site = await siteWaterOf(reader, q.siteId);
  if (!site.ok) return site;

  const rule: GasRule = q.rule === undefined || q.rule === 'rock_bottom' ? { kind: 'rock_bottom' }
    : q.rule === 'reserve' || q.rule === 'ascent_pressure' ? { kind: q.rule, bar: q.bar! }
    : { kind: q.rule };
  const water: { value: PlanningWaterName; source: string } =
    q.water !== undefined ? { value: q.water, source: 'request' } : site.water ? { value: site.water, source: 'site' } : { value: 'salt', source: 'default' };
  const used = {
    water,
    altitudeM: q.altitude !== undefined ? { value: q.altitude, source: 'request' } : { value: 0, source: 'default' },
    gasRule: { value: { kind: rule.kind, bar: 'bar' in rule ? rule.bar : null }, source: q.rule === undefined ? 'default' : 'request' },
    descentRateMPerMin: q.descentRate !== undefined ? { value: q.descentRate, source: 'request' } : { value: DESCENT_RATE_M_PER_MIN, source: 'default' },
    ascentRateMPerMin: q.ascentRate !== undefined ? { value: q.ascentRate, source: 'request' } : { value: ASCENT_RATE_M_PER_MIN, source: 'default' },
  };

  // Each Diver's SAC: typed, else the planning SAC of a Diver the User manages, else the default.
  const divers: { input: GasPlanQuery['divers'][number]; sac: { value: number; source: 'request' | 'logbook' | 'default'; basedOn?: number }; recentDiveEndedAt: string | null }[] = [];
  for (const d of q.divers) {
    let sac: { value: number; source: 'request' | 'logbook' | 'default'; basedOn?: number };
    let recentDiveEndedAt: string | null = null;
    if (d.diverId !== undefined && managedDiverIds.includes(d.diverId)) {
      const logbook = planningSac(await diveSacs(reader, d.diverId));
      sac = d.sac !== undefined ? { value: d.sac, source: 'request' }
        : logbook.source === 'logbook' ? { value: logbook.lpm, source: 'logbook', basedOn: logbook.basedOn }
        : { value: DEFAULT_PLANNING_SAC_LPM, source: 'default', basedOn: logbook.basedOn };
      recentDiveEndedAt = (await recentDiveEnd(reader, d.diverId))?.toISOString() ?? null;
    } else {
      sac = d.sac !== undefined ? { value: d.sac, source: 'request' } : { value: DEFAULT_PLANNING_SAC_LPM, source: 'default' };
    }
    divers.push({ input: d, sac, recentDiveEndedAt });
  }

  const result = planGas({
    gas, conditions: { water: water.value, altitudeM: used.altitudeM.value }, levels: q.levels.map((l) => ({ depthM: l.depth, minutes: l.minutes })),
    divers: divers.map((d) => ({ name: d.input.name, volumeL: d.input.volume, startPressureBar: d.input.pressure, sacLpm: d.sac.value })),
    rule, ppO2Contingency: q.ppo2Contingency ?? DEFAULT_PPO2.contingency,
    descentRateMPerMin: used.descentRateMPerMin.value, ascentRateMPerMin: used.ascentRateMPerMin.value,
  });
  const common = { gas, used, rule: used.gasRule.value };
  if (result.status === 'outside_limits') return { ok: true, value: { status: result.status, reason: result.reason, levelIndex: result.levelIndex, ...common } };
  return {
    ok: true,
    value: {
      status: 'ok', ...common,
      runtimeMinutes: round(result.runtimeMinutes, 1),
      segments: result.segments.map((s) => ({ kind: s.kind, fromDepthM: s.fromDepthM, depthM: s.depthM, minutes: round(s.minutes, 1), ambientBar: round(s.ambientBar, 3) })),
      divers: result.divers.map((p, i) => ({
        name: p.name, diverId: divers[i]!.input.diverId ?? null, sacLpm: divers[i]!.sac,
        volumeL: divers[i]!.input.volume, startPressureBar: divers[i]!.input.pressure,
        litres: round(p.litres, 1), endPressureBar: round(p.endPressureBar, 1),
        rockBottom: p.rockBottom.map((r) => ({ depthM: r.depthM, pressureBar: round(r.pressureBar, 1) })),
        ascentPressureBar: round(p.ascentPressureBar, 1),
        turnPressureBar: p.turnPressureBar === null ? null : round(p.turnPressureBar, 1),
        belowRockBottom: p.belowRockBottom, atAscentStartBar: round(p.atAscentStartBar, 1), marginBar: round(p.marginBar, 1),
        marginMinutes: round(p.marginMinutes, 1), controlling: p.controlling, recentDiveEndedAt: divers[i]!.recentDiveEndedAt,
        pressuresBar: p.pressuresBar.map((bar) => round(bar, 1)),
      })),
      controllingIndex: result.controllingIndex, fits: result.fits, leaveLastLevelAtMinute: round(result.leaveLastLevelAtMinute, 1),
    },
  };
}

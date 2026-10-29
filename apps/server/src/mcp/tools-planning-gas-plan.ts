// MCP tool for gas plans (ADR 0033, ADR 0035): the same answer as POST /tools/gas-plan (planning/plan-service.ts), with the
// assumptions and the notice in every result: never a bare number.
import { Type } from 'typebox';
import { PLAN_RULES, planGasPlan } from '../planning/plan-service.js';
import { PLANNING_WATERS } from '../planning/service.js';
import { NOTICE, planning } from './tools-planning.js';
import { Id, Nullable, defineTool } from './tool.js';

const Input = Type.Object({
  o2: Type.Number({ minimum: 1, maximum: 100, description: 'Oxygen in the mix, percent (air is 21). Air and nitrox 21-40 % only' }),
  he: Type.Optional(Type.Number({ minimum: 0, maximum: 100, description: 'Helium, percent. Default 0; a plan is answered for air and nitrox only' })),
  levels: Type.Array(Type.Object({
    depth_m: Type.Number({ minimum: 1, maximum: 300 }),
    minutes: Type.Number({ minimum: 0, maximum: 600, description: 'Minutes at this depth after arriving (the descent comes on top)' }),
  }), { minItems: 1, maxItems: 8, description: 'In order; the last is left for the ascent (9 m/min unless ascent_rate_m_per_min says otherwise, safety stop 3 min at 5 m)' }),
  divers: Type.Array(Type.Object({
    name: Type.String({ maxLength: 80 }),
    cylinder_volume_l: Type.Number({ minimum: 1, maximum: 60 }),
    cylinder_pressure_bar: Type.Number({ minimum: 1, maximum: 350, description: 'Fill pressure' }),
    sac_l_per_min: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: 'Default: the planning SAC of the Diver when diver_id is given and has 5 dives with a SAC, else 20' })),
    diver_id: Type.Optional(Id('A Diver of the user (from divers_list): the planning SAC comes from their dives. For anyone else it changes nothing')),
  }), { minItems: 1, maxItems: 8, description: 'Everyone in the group; the plan follows whoever runs out of margin first' }),
  gas_rule: Type.Optional(Type.Enum([...PLAN_RULES], { description: 'Default rock_bottom: ascend at rock bottom, never below 50 bar' })),
  rule_bar: Type.Optional(Type.Number({ minimum: 0, maximum: 350, description: 'Bar for gas_rule reserve (left at the end) or ascent_pressure (where the ascent starts)' })),
  water: Type.Optional(Type.Enum([...PLANNING_WATERS], { description: 'salt (default), fresh or en13319' })),
  altitude_m: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
  ppo2_contingency: Type.Optional(Type.Number({ minimum: 1, maximum: 2, description: 'Default 1.6: the MOD limit of a plan' })),
  descent_rate_m_per_min: Type.Optional(Type.Number({ minimum: 3, maximum: 30, description: 'Default 18' })),
  ascent_rate_m_per_min: Type.Optional(Type.Number({ minimum: 3, maximum: 18, description: 'Default 9. Rock bottom follows a slower one, never a faster one' })),
}, { additionalProperties: false });

const Used = (value: ReturnType<typeof Type.Number> | ReturnType<typeof Type.String> | ReturnType<typeof Type.Object>) => Type.Object({
  value, source: Type.Enum(['request', 'site', 'default']),
});

export const planGasPlanTool = defineTool({
  name: 'planning_gas_plan',
  title: 'Gas plan for a dive of one Diver or a group',
  description: `Plans the gas of a dive with one or more levels for one Diver or a group, from the inputs and the Diver's own settings: the litres of each Diver (descent, levels, ascent and a safety stop), their pressure at the end, rock bottom at every level, and the pressure at which each must start up by the chosen gas rule. The plan follows the controlling Diver, who runs out of margin first. It checks the gas, the MOD and 40 m, not the no-decompression limit over several levels: say so with the plan.

Gas rules (gas_rule): rock_bottom (default): start up at rock bottom - two divers' trouble at that depth, at twice the SAC for a minute, then a direct ascent, plus 10 bar - and never below 50 bar. reserve: finish the dive with rule_bar left. ascent_pressure: start up at rule_bar (for example 100). halves, thirds, sixths: turn rules for dives that come back the way they went, matched by litres, the smaller supply sets the turn; thirds and sixths are for overhead diving with training, not open water. Rock bottom is always shown, and below_rock_bottom says when the rule leaves less.

Returns { status, assumptions, run_time_minutes, segments, divers, controlling_diver, fits, leave_last_level_at_minute, notice }. status is "ok" or "outside_recreational_limits" (reason: depth, mod or gas; level_index; no numbers): more than 40 m, beyond the MOD at the contingency ppO2, or a mix other than air and nitrox 21-40 %. fits is false when the plan overdraws the ascent pressure; leave_last_level_at_minute is the run time to leave the last level by. When a Diver's recent_dive_ended_at is set they dived within 48 hours.

Always pass on the notice and the assumptions (where each SAC came from) with the numbers: this is an estimate, not advice, and the dive computer and training govern. Dive Hub plans no decompression dives.`,
  scope: 'logbook:read',
  input: Input,
  output: () => Type.Object({
    status: Type.Enum(['ok', 'outside_recreational_limits']),
    reason: Type.Optional(Type.Enum(['depth', 'mod', 'gas'], { description: 'depth: deeper than 40 m; mod: beyond the MOD at the contingency ppO2; gas: not air or nitrox 21-40 %' })),
    level_index: Type.Optional(Nullable(Type.Integer({ description: 'The first level that is outside the limits; null for the mix' }))),
    gas: Type.Object({ o2: Type.Number(), he: Type.Number() }),
    assumptions: Type.Object({
      water: Used(Type.String()), altitude_m: Used(Type.Number()),
      gas_rule: Used(Type.Object({ kind: Type.Enum([...PLAN_RULES]), bar: Nullable(Type.Number()) })),
      descent_rate_m_per_min: Used(Type.Number()), ascent_rate_m_per_min: Used(Type.Number()),
    }),
    run_time_minutes: Type.Optional(Type.Number()),
    segments: Type.Optional(Type.Array(Type.Object({
      kind: Type.Enum(['descent', 'level', 'ascent', 'safety_stop']), from_depth_m: Type.Number(), depth_m: Type.Number(), minutes: Type.Number(), ambient_bar: Type.Number(),
    }))),
    divers: Type.Optional(Type.Array(Type.Object({
      name: Type.String(),
      diver_id: Nullable(Type.String()),
      sac_l_per_min: Type.Object({
        value: Type.Number(), source: Type.Enum(['request', 'logbook', 'default']),
        based_on_dives: Type.Optional(Type.Integer({ description: 'How many dives the planning SAC rests on' })),
      }),
      cylinder_volume_l: Type.Number(), start_pressure_bar: Type.Number(),
      litres: Type.Number({ description: 'At the surface pressure, over the whole plan' }),
      end_pressure_bar: Type.Number(),
      rock_bottom: Type.Array(Type.Object({ depth_m: Type.Number(), pressure_bar: Type.Number() })),
      ascent_pressure_bar: Type.Number({ description: 'Start up at this pressure, by the gas rule' }),
      turn_pressure_bar: Nullable(Type.Number({ description: 'Under halves, thirds and sixths' })),
      below_rock_bottom: Type.Boolean(),
      at_ascent_start_bar: Type.Number({ description: 'The pressure at the end of the last level' }),
      margin_bar: Type.Number(),
      margin_minutes: Type.Number({ description: 'More minutes at the last level before the ascent pressure; negative when the plan stays too long' }),
      controlling: Type.Boolean(),
      recent_dive_ended_at: Nullable(Type.String({ description: 'The Diver dived within 48 hours: the real limit is shorter than shown' })),
      pressures_bar: Type.Array(Type.Number(), { description: 'At the start and at the end of every segment, in their order' }),
    }))),
    controlling_diver: Type.Optional(Type.String()),
    fits: Type.Optional(Type.Boolean()),
    leave_last_level_at_minute: Type.Optional(Type.Number()),
    notice: Type.String(),
  }),
  async run(ctx, args) {
    const v = await planning(() => planGasPlan(ctx.tx, ctx.diverIds, {
      o2: args.o2, he: args.he, levels: args.levels.map((l) => ({ depth: l.depth_m, minutes: l.minutes })),
      divers: args.divers.map((d) => ({ name: d.name, volume: d.cylinder_volume_l, pressure: d.cylinder_pressure_bar, sac: d.sac_l_per_min, diverId: d.diver_id })),
      rule: args.gas_rule, bar: args.rule_bar, water: args.water, altitude: args.altitude_m, ppo2Contingency: args.ppo2_contingency,
      descentRate: args.descent_rate_m_per_min, ascentRate: args.ascent_rate_m_per_min,
    }));
    const assumptions = {
      water: v.used.water, altitude_m: v.used.altitudeM, gas_rule: v.used.gasRule,
      descent_rate_m_per_min: v.used.descentRateMPerMin, ascent_rate_m_per_min: v.used.ascentRateMPerMin,
    };
    if (v.status === 'outside_limits') {
      return { output: { status: 'outside_recreational_limits' as const, reason: v.reason, level_index: v.levelIndex, gas: v.gas, assumptions, notice: NOTICE }, rows: 0 };
    }
    return {
      output: {
        status: 'ok' as const, gas: v.gas, assumptions, run_time_minutes: v.runtimeMinutes,
        segments: v.segments.map((s) => ({ kind: s.kind, from_depth_m: s.fromDepthM, depth_m: s.depthM, minutes: s.minutes, ambient_bar: s.ambientBar })),
        divers: v.divers.map((d) => ({
          name: d.name, diver_id: d.diverId,
          sac_l_per_min: { value: d.sacLpm.value, source: d.sacLpm.source, ...(d.sacLpm.basedOn !== undefined && { based_on_dives: d.sacLpm.basedOn }) },
          cylinder_volume_l: d.volumeL, start_pressure_bar: d.startPressureBar, litres: d.litres, end_pressure_bar: d.endPressureBar,
          rock_bottom: d.rockBottom.map((r) => ({ depth_m: r.depthM, pressure_bar: r.pressureBar })),
          ascent_pressure_bar: d.ascentPressureBar, turn_pressure_bar: d.turnPressureBar, below_rock_bottom: d.belowRockBottom,
          at_ascent_start_bar: d.atAscentStartBar, margin_bar: d.marginBar, margin_minutes: d.marginMinutes, controlling: d.controlling,
          recent_dive_ended_at: d.recentDiveEndedAt, pressures_bar: d.pressuresBar,
        })),
        controlling_diver: v.divers[v.controllingIndex]!.name, fits: v.fits, leave_last_level_at_minute: v.leaveLastLevelAtMinute, notice: NOTICE,
      },
      rows: 0,
    };
  },
});

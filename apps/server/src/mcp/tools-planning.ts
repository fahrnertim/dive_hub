// MCP tool for the Tools page's gas numbers and bottom time (ADR 0032, ADR 0035). The same answer as the routes
// (planning/service.ts), with the assumptions and the notice in every result: never a bare number.
import { Type } from 'typebox';
import { PLANNING_WATERS, gasNumbers, planBottomTime } from '../planning/service.js';
import { Id, Nullable, ToolError, defineTool } from './tool.js';

/** Fixed text in every answer (ADR 0032: always visible; the limits are the Diver's own input, not advice). */
const NOTICE = 'An estimate from the inputs and settings shown, not advice: limits computed from the Diver\'s own input and settings. '
  + 'The dive computer and the Diver\'s training govern, and no model guarantees safety. Say so when passing these numbers on.';

const Input = Type.Object({
  o2: Type.Number({ minimum: 1, maximum: 100, description: 'Oxygen in the mix, percent (air is 21)' }),
  he: Type.Optional(Type.Number({ minimum: 0, maximum: 100, description: 'Helium, percent. Default 0. Bottom time is answered for air and nitrox only' })),
  depth: Type.Optional(Type.Number({ minimum: 1, maximum: 300, description: 'Planned depth, metres. Without it only the gas numbers are answered' })),
  water: Type.Optional(Type.Enum([...PLANNING_WATERS], { description: 'salt (default), fresh or en13319' })),
  altitude_m: Type.Optional(Type.Number({ minimum: 0, maximum: 5000, description: 'Altitude of the water surface; default sea level' })),
  ppo2_working: Type.Optional(Type.Number({ minimum: 1, maximum: 2, description: 'Default 1.4' })),
  ppo2_contingency: Type.Optional(Type.Number({ minimum: 1, maximum: 2, description: 'Default 1.6' })),
  oxygen_narcotic: Type.Optional(Type.Boolean({ description: 'Count oxygen as narcotic for END. Default true' })),
  cylinder_volume_l: Type.Optional(Type.Number({ minimum: 1, maximum: 60, description: 'With cylinder_pressure_bar: adds the gas limit to the bottom time' })),
  cylinder_pressure_bar: Type.Optional(Type.Number({ minimum: 1, maximum: 350 })),
  sac_l_per_min: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: 'Gas use at the surface. Default: the median of the Diver\'s recent dives, else 20' })),
  reserve_bar: Type.Optional(Type.Number({ minimum: 0, maximum: 200, description: 'Default 50' })),
  gf_high: Type.Optional(Type.Number({ minimum: 20, maximum: 100, description: 'Gradient factor high. Default: from the Diver\'s latest Recording that has one, else 85' })),
  diver_id: Type.Optional(Id('Start from this Diver\'s computer GF, SAC and last Dive (from divers_list)')),
}, { additionalProperties: false });

const Used = (value: ReturnType<typeof Type.Number> | ReturnType<typeof Type.String>) => Type.Object({
  value,
  source: Type.Enum(['request', 'recording', 'recordings', 'site', 'default'], { description: 'recording: the Diver\'s latest Recording with a GF; recordings: the median SAC of their Recordings' }),
});

export const planGasAndBottomTime = defineTool({
  name: 'planning_gas_and_bottom_time',
  title: 'Gas numbers and bottom time for a planned dive',
  description: `Computes limits for a planned dive from the inputs and the Diver's own settings: MOD of a gas mix at the working and the contingency ppO2, and for a depth the ppO2, best mix, EAD and END. With a depth, air or nitrox 21-40 %, no more than 40 m and within the MOD, also a bottom time: the shortest of the no-decompression limit (Bühlmann ZHL-16C with the gradient factor, clean tissues), the oxygen limit and the gas above the reserve (when a cylinder is given), and which limit binds.

Returns { gas, hypoxic, ppo2_limits, mod_working_m, mod_contingency_m, at_depth, conditions, oxygen_narcotic, bottom_time, notice }. bottom_time is null without a depth. Its status is "ok" (minutes, binding, limits, otu, assumptions with where each value came from) or "outside_recreational_limits" (reason: depth, mod or gas; no number). When recent_dive_ended_at is set the Diver dived within 48 hours and the real limit is shorter than shown.

Always pass on the notice and the assumptions with the numbers: this is an estimate, not advice, and the dive computer and training govern. Dive Hub plans no decompression dives.`,
  scope: 'logbook:read',
  input: Input,
  output: () => Type.Object({
    gas: Type.Object({ o2: Type.Number(), he: Type.Number() }),
    hypoxic: Type.Boolean({ description: 'Under 18 % oxygen at the surface' }),
    ppo2_limits: Type.Object({ working: Type.Number(), contingency: Type.Number() }),
    mod_working_m: Type.Number({ description: 'Rounded down to 0.1 m' }),
    mod_contingency_m: Type.Number(),
    at_depth: Nullable(Type.Object({
      depth_m: Type.Number(), ppo2: Type.Number(), best_mix_percent: Type.Integer(), ead_m: Type.Number(), end_m: Type.Number(),
    })),
    conditions: Type.Object({ water: Type.Enum([...PLANNING_WATERS]), altitude_m: Type.Number() }),
    oxygen_narcotic: Type.Boolean(),
    bottom_time: Nullable(Type.Object({
      status: Type.Enum(['ok', 'outside_recreational_limits']),
      reason: Type.Optional(Type.Enum(['depth', 'mod', 'gas'], { description: 'depth: deeper than 40 m; mod: beyond the MOD at the contingency ppO2; gas: not air or nitrox 21-40 %' })),
      mod_m: Type.Optional(Nullable(Type.Number())),
      minutes: Type.Optional(Type.Integer({ description: 'Whole minutes from leaving the surface to leaving the depth' })),
      binding: Type.Optional(Type.Array(Type.Enum(['ndl', 'oxygen', 'gas']), { description: 'Several when the limits bind together' })),
      limits: Type.Optional(Type.Object({
        ndl: Nullable(Type.Number()), oxygen: Nullable(Type.Number()), gas: Nullable(Type.Number({ description: 'Null without a cylinder' })),
      }, { description: 'Minutes; null where the depth does not limit' })),
      otu: Type.Optional(Type.Number()),
      ppo2_at_depth: Type.Optional(Type.Number()),
      ppo2_above_working: Type.Optional(Type.Boolean()),
      assumptions: Type.Object({
        gf_high: Used(Type.Number()), sac_l_per_min: Used(Type.Number()), water: Used(Type.String()),
        altitude_m: Used(Type.Number()), reserve_bar: Used(Type.Number()),
      }),
      recent_dive_ended_at: Nullable(Type.String({ description: 'The Diver dived within 48 hours: the real limit is shorter than shown' })),
    })),
    notice: Type.String(),
  }),
  async run(ctx, args) {
    const gas = gasNumbers({
      o2: args.o2, he: args.he, depth: args.depth, water: args.water, altitude: args.altitude_m,
      ppo2Working: args.ppo2_working, ppo2Contingency: args.ppo2_contingency, oxygenNarcotic: args.oxygen_narcotic,
    });
    if (!gas.ok) {
      throw new ToolError(gas.code, gas.code === 'gas_not_breathable'
        ? 'A mix with under 16 % oxygen can\'t be breathed at the surface. Give o2 of 16 or more.'
        : 'Oxygen and helium together are over 100 %.');
    }
    let bottomTime = null;
    if (args.depth !== undefined) {
      const answer = await planBottomTime(ctx.tx, ctx.diverIds, {
        depth: args.depth, o2: args.o2, he: args.he, volume: args.cylinder_volume_l, pressure: args.cylinder_pressure_bar, sac: args.sac_l_per_min,
        reserve: args.reserve_bar, gfHigh: args.gf_high, water: args.water, altitude: args.altitude_m,
        ppo2Working: args.ppo2_working, ppo2Contingency: args.ppo2_contingency, diverId: args.diver_id,
      });
      if (!answer.ok) {
        throw new ToolError(answer.code, answer.code === 'diver_not_found'
          ? 'No Diver of the user has this diver_id. Call divers_list for the Divers whose Dives this access can read.'
          : 'Give cylinder_volume_l and cylinder_pressure_bar together, or neither.');
      }
      const v = answer.value;
      const assumptions = {
        gf_high: v.used.gfHigh, sac_l_per_min: v.used.sacLpm, water: v.used.water, altitude_m: v.used.altitudeM, reserve_bar: v.used.reserveBar,
      };
      bottomTime = v.status === 'outside_limits'
        ? { status: 'outside_recreational_limits' as const, reason: v.reason, mod_m: v.modM, assumptions, recent_dive_ended_at: v.recentDiveEndedAt }
        : {
          status: 'ok' as const, minutes: v.minutes, binding: v.binding, limits: v.limits, otu: v.otu, ppo2_at_depth: v.ppO2AtDepth,
          ppo2_above_working: v.ppO2AboveWorking, assumptions, recent_dive_ended_at: v.recentDiveEndedAt,
        };
    }
    const g = gas.value;
    const output = {
      gas: g.gas, hypoxic: g.hypoxic, ppo2_limits: g.ppO2Limits, mod_working_m: g.modWorkingM, mod_contingency_m: g.modContingencyM,
      at_depth: g.atDepth && {
        depth_m: g.atDepth.depthM, ppo2: g.atDepth.ppO2, best_mix_percent: g.atDepth.bestMixPercent, ead_m: g.atDepth.eadM, end_m: g.atDepth.endM,
      },
      conditions: { water: g.conditions.water, altitude_m: g.conditions.altitudeM }, oxygen_narcotic: g.oxygenNarcotic,
      bottom_time: bottomTime, notice: NOTICE,
    };
    return { output, rows: 0 };
  },
});

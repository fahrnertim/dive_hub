// Bottom time for a planned dive (ADR 0032, slice 21): the shortest of the no-decompression limit, the oxygen limit and
// the gas down to the ascent pressure of a gas rule (ADR 0033), and which one binds. An estimate from the Diver's own input and settings, not advice;
// the dive computer and training govern. Air and nitrox 21 to 40 % only, no-stop only, at most 40 m.
import { ambientPressureBar, modMetres, type Conditions, type GasMix } from './gas.js';
import { MAX_DEPTH_M, planGas, type GasRule } from './gas-plan.js';
import { ndlMinutes } from './ndl.js';
import { otu, oxygenLimitMinutes } from './oxygen.js';


export type Limit = 'ndl' | 'oxygen' | 'gas';

export interface BottomTimeInput {
  gas: GasMix;
  depthM: number;
  gfHigh: number;
  conditions: Conditions;
  /** Null: no gas limit. */
  cylinder: { volumeL: number; startPressureBar: number } | null;
  /** Litres a minute at the surface. */
  sacLpm: number;
  /** Where the gas ends: the ascent pressure of this rule (ADR 0033). */
  rule: GasRule;
  ppO2: { working: number; contingency: number };
}

export type BottomTime =
  | {
      status: 'ok';
      /** Whole minutes from leaving the surface to leaving the depth. */
      minutes: number;
      /** The limits that equal `minutes`: more than one when they bind together. Minutes; the gas limit is null without a Cylinder. */
      binding: Limit[];
      limits: { ndl: number; oxygen: number; gas: number | null };
      otu: number;
      ppO2AtDepth: number;
      /** The pressure the gas limit ends at; null without a Cylinder. */
      ascentPressureBar: number | null;
      /** Above the working ppO2 limit, within the contingency one. */
      ppO2AboveWorking: boolean;
    }
  | { status: 'outside_limits'; reason: 'depth' | 'mod' | 'gas'; modM: number | null };

export function bottomTime(input: BottomTimeInput): BottomTime {
  const { gas, depthM, conditions, sacLpm } = input;
  const supported = gas.he === 0 && gas.o2 >= 21 && gas.o2 <= 40;
  const modM = supported ? modMetres(gas, input.ppO2.contingency, conditions) : null;
  if (!supported) return { status: 'outside_limits', reason: 'gas', modM };
  if (depthM > MAX_DEPTH_M) return { status: 'outside_limits', reason: 'depth', modM };
  if (depthM > modM!) return { status: 'outside_limits', reason: 'mod', modM };

  const ambientBar = ambientPressureBar(depthM, conditions);
  const ppO2AtDepth = (gas.o2 / 100) * ambientBar;

  const ndl = ndlMinutes({ gas, depthM, gfHigh: input.gfHigh, conditions });
  const oxygen = oxygenLimitMinutes(ppO2AtDepth);

  // The gas limit is the minute to leave the depth by in a plan of one Diver at this depth (ADR 0033).
  let gasLimit: number | null = null;
  let ascentPressureBar: number | null = null;
  if (input.cylinder) {
    const plan = planGas({
      gas, conditions, levels: [{ depthM, minutes: 0 }], rule: input.rule, ppO2Contingency: input.ppO2.contingency,
      divers: [{ name: '', ...input.cylinder, sacLpm }],
    });
    if (plan.status === 'ok') {
      gasLimit = Math.max(0, plan.leaveLastLevelAtMinute);
      ascentPressureBar = plan.divers[0]!.ascentPressureBar;
    }
  }

  const limits = { ndl, oxygen, gas: gasLimit };
  const entries = (Object.entries(limits) as [Limit, number | null][]).filter((e): e is [Limit, number] => e[1] !== null);
  const minutes = Math.floor(Math.min(...entries.map(([, v]) => v)));
  const binding = entries.filter(([, v]) => Math.floor(v) === minutes).map(([k]) => k);
  return {
    status: 'ok',
    minutes,
    binding,
    limits,
    ascentPressureBar,
    otu: otu(ppO2AtDepth, minutes),
    ppO2AtDepth,
    ppO2AboveWorking: ppO2AtDepth > input.ppO2.working + 1e-9,
  };
}

// Bottom time for a planned dive (ADR 0032, slice 21): the shortest of the no-decompression limit, the oxygen limit and
// the gas above the reserve, and which one binds. An estimate from the Diver's own input and settings, not advice;
// the dive computer and training govern. Air and nitrox 21 to 40 % only, no-stop only, at most 40 m.
import { surfaceLitres } from '../dives/real-gas.js';
import { ambientPressureBar, modMetres, type Conditions, type GasMix } from './gas.js';
import { DESCENT_RATE_M_PER_MIN, ndlMinutes } from './ndl.js';
import { otu, oxygenLimitMinutes } from './oxygen.js';

/** Deeper than this is never answered (ADR 0032). */
export const MAX_DEPTH_M = 40;
export const ASCENT_RATE_M_PER_MIN = 9;
export const SAFETY_STOP = { depthM: 5, minutes: 3 };

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
  reserveBar: number;
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
      /** Above the working ppO2 limit, within the contingency one. */
      ppO2AboveWorking: boolean;
    }
  | { status: 'outside_limits'; reason: 'depth' | 'mod' | 'gas'; modM: number | null };

/** Litres at the surface's pressure breathed over a stretch of depth, at an average pressure. */
const stretchLitres = (sacLpm: number, minutes: number, fromBar: number, toBar: number) => sacLpm * minutes * ((fromBar + toBar) / 2);

export function bottomTime(input: BottomTimeInput): BottomTime {
  const { gas, depthM, conditions, sacLpm } = input;
  const supported = gas.he === 0 && gas.o2 >= 21 && gas.o2 <= 40;
  const modM = supported ? modMetres(gas, input.ppO2.contingency, conditions) : null;
  if (!supported) return { status: 'outside_limits', reason: 'gas', modM };
  if (depthM > MAX_DEPTH_M) return { status: 'outside_limits', reason: 'depth', modM };
  if (depthM > modM!) return { status: 'outside_limits', reason: 'mod', modM };

  const ambientBar = ambientPressureBar(depthM, conditions);
  const surfaceBar = ambientPressureBar(0, conditions);
  const ppO2AtDepth = (gas.o2 / 100) * ambientBar;

  const ndl = ndlMinutes({ gas, depthM, gfHigh: input.gfHigh, conditions });
  const oxygen = oxygenLimitMinutes(ppO2AtDepth);

  let gasLimit: number | null = null;
  if (input.cylinder) {
    const { volumeL, startPressureBar } = input.cylinder;
    const usable = surfaceLitres(volumeL, startPressureBar, gas) - surfaceLitres(volumeL, input.reserveBar, gas);
    const descentMinutes = depthM / DESCENT_RATE_M_PER_MIN;
    const ascentMinutes = depthM / ASCENT_RATE_M_PER_MIN;
    const stopBar = ambientPressureBar(SAFETY_STOP.depthM, conditions);
    const wayDown = stretchLitres(sacLpm, descentMinutes, surfaceBar, ambientBar);
    const wayUp = stretchLitres(sacLpm, ascentMinutes, ambientBar, surfaceBar) + sacLpm * SAFETY_STOP.minutes * stopBar;
    const atDepthMinutes = (usable - wayDown - wayUp) / (sacLpm * ambientBar);
    gasLimit = Math.max(0, atDepthMinutes + descentMinutes);
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
    otu: otu(ppO2AtDepth, minutes),
    ppO2AtDepth,
    ppO2AboveWorking: ppO2AtDepth > input.ppO2.working + 1e-9,
  };
}

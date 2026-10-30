// The gas numbers the route and the MCP tool answer (ADR 0032, slice 21): MOD, ppO2, best mix, EAD and END of a mix.
// Computed from the request alone, nothing stored. Limits from the Diver's own input and settings, not advice.
import { PlanningError } from './planning-error.js';
import { ambientPressureBar, bestMixPercent, eadMetres, endMetres, isHypoxic, modMetres, type Conditions, type PlanningWater } from './gas.js';

/** Defaults that no source overrides (ADR 0032). */
export const DEFAULT_PPO2 = { working: 1.4, contingency: 1.6 };

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
/** Depth limits are rounded down: a figure may be shallower than the exact one, never deeper. */
export const floorTenth = (n: number) => Math.floor(n * 10 + 1e-9) / 10;

export interface GasQuery {
  o2: number;
  he?: number | undefined;
  depth?: number | undefined;
  water?: PlanningWater | undefined;
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

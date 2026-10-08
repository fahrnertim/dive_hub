// Gas numbers for a planned dive (ADR 0032, slice 21): pressure from depth, water and altitude, and MOD.
// Clean-room from the formulas in docs/research/2026-10-06-gas-and-ndl-tools.md; no GPL code.
// These are limits from the Diver's own input and settings, not advice (ADR 0032).

export interface GasMix {
  /** Percent. */
  o2: number;
  /** Percent. */
  he: number;
}

export type PlanningWater = 'fresh' | 'salt' | 'en13319';

export interface Conditions {
  water: PlanningWater;
  /** Altitude of the surface in metres above sea level. */
  altitudeM: number;
  /** Overrides the density of `water` in kg/m³ (tests compare with a reference that uses 1030 for salt water). */
  densityKgM3?: number | undefined;
}

const DENSITY: Record<PlanningWater, number> = { fresh: 1000, salt: 1025, en13319: 1020 };
const GRAVITY = 9.80665;
const SEA_LEVEL_BAR = 1.01325;

/** Surface pressure in bar from the standard atmosphere. */
export function surfacePressureBar(altitudeM: number): number {
  return SEA_LEVEL_BAR * (1 - 2.25577e-5 * altitudeM) ** 5.25588;
}

/** Metres of water per bar of pressure. */
export function metresPerBar(conditions: Conditions): number {
  return 1e5 / ((conditions.densityKgM3 ?? DENSITY[conditions.water]) * GRAVITY);
}

/** Maximum operating depth in metres: where the mix reaches the ppO2 limit (bar). */
export function modMetres(gas: GasMix, ppO2Limit: number, conditions: Conditions): number {
  const ambientBar = ppO2Limit / (gas.o2 / 100);
  return (ambientBar - surfacePressureBar(conditions.altitudeM)) * metresPerBar(conditions);
}

/** Ambient pressure in bar at a depth in metres. */
export function ambientPressureBar(depthM: number, conditions: Conditions): number {
  return surfacePressureBar(conditions.altitudeM) + depthM / metresPerBar(conditions);
}

/** Depth at which an ambient pressure is reached. */
function depthOfPressure(bar: number, conditions: Conditions): number {
  return (bar - surfacePressureBar(conditions.altitudeM)) * metresPerBar(conditions);
}

/** The richest oxygen percent (whole, rounded down) whose ppO2 stays within the limit at the depth; at most 100. */
export function bestMixPercent(depthM: number, ppO2Limit: number, conditions: Conditions): number {
  return Math.min(100, Math.floor((ppO2Limit / ambientPressureBar(depthM, conditions)) * 100));
}

/** Equivalent air depth: the depth on air with the same nitrogen pressure (helium counts as no nitrogen). */
export function eadMetres(gas: GasMix, depthM: number, conditions: Conditions): number {
  const n2 = (100 - gas.o2 - gas.he) / 100;
  return depthOfPressure((ambientPressureBar(depthM, conditions) * n2) / 0.79, conditions);
}

/** Equivalent narcotic depth. Oxygen counts as narcotic by default (the more cautious reading); only helium is not. */
export function endMetres(gas: GasMix, depthM: number, conditions: Conditions, options: { oxygenNarcotic: boolean }): number {
  if (!options.oxygenNarcotic) return eadMetres(gas, depthM, conditions);
  return depthOfPressure(ambientPressureBar(depthM, conditions) * (1 - gas.he / 100), conditions);
}

/** Below 18 % oxygen at the surface a mix is hypoxic. */
export function isHypoxic(gas: GasMix): boolean {
  return gas.o2 < 18;
}

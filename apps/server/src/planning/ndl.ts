// No-decompression limit (ADR 0032, slice 21): Bühlmann ZHL-16C for nitrogen with gradient factors.
// Clean-room from the published coefficients and formulas, not from any GPL implementation:
//   - Bühlmann, "Tauchmedizin" (ZHL-16C half-times and a/b values), as tabulated in
//     https://en.wikipedia.org/wiki/B%C3%BChlmann_decompression_algorithm
//   - Haldane (constant depth) and Schreiner (changing depth) equations; water vapour 0.0627 bar
//   - Baker, "Understanding M-values" and "Clearing up the confusion about deep stops": gradient factors, tolerated
//     ambient pressure Pamb = (Pt − GF·a) / (GF/b − GF + 1).
// The limit is the actual one (ADR 0032): the time from leaving the surface until any compartment's tolerated
// pressure at GF high rises above the surface pressure, the descent included, in whole minutes rounded down.
// No credit for the ascent. One minute is taken off (ADR 0046, amending ADR 0032), the margin the reference
// implementations carry. Estimate from the Diver's own settings, not advice.
import { ambientPressureBar, metresPerBar, surfacePressureBar, type Conditions, type GasMix } from './gas.js';

/** [half-time in minutes, a, b] for the 16 compartments (ZHL-16C, compartment 1b: 5.0 min). */
const COMPARTMENTS: readonly (readonly [number, number, number])[] = [
  [5.0, 1.1696, 0.5578], [8.0, 1.0, 0.6514], [12.5, 0.8618, 0.7222], [18.5, 0.7562, 0.7825],
  [27.0, 0.62, 0.8126], [38.3, 0.5043, 0.8434], [54.3, 0.441, 0.8693], [77.0, 0.4, 0.891],
  [109.0, 0.375, 0.9092], [146.0, 0.35, 0.9222], [187.0, 0.3295, 0.9319], [239.0, 0.3065, 0.9403],
  [305.0, 0.2835, 0.9477], [390.0, 0.261, 0.9544], [498.0, 0.248, 0.9602], [635.0, 0.2327, 0.9653],
];

const WATER_VAPOUR_BAR = 0.0627;
/** Descent rate, metres per minute (ADR 0032). */
export const DESCENT_RATE_M_PER_MIN = 18;
const STEP_SECONDS = 1;
/** Beyond this the depth is not limiting and the answer is Infinity. */
const SEARCH_LIMIT_MINUTES = 1000;

export interface NdlInput {
  gas: GasMix;
  depthM: number;
  /** Gradient factor high in percent (for a no-stop dive only this one matters). */
  gfHigh: number;
  conditions: Conditions;
}

/** Whole minutes from leaving the surface until the first stop would be needed, less one; Infinity when it never is. */
export function ndlMinutes(input: NdlInput): number {
  const { gas, depthM, conditions } = input;
  const gf = input.gfHigh / 100;
  const fN2 = (100 - gas.o2 - gas.he) / 100;
  const surface = surfacePressureBar(conditions.altitudeM);
  const barPerMetre = 1 / metresPerBar(conditions);
  const descentSeconds = (depthM / DESCENT_RATE_M_PER_MIN) * 60;
  // Clean tissues: saturated with air at the surface.
  const tissue = COMPARTMENTS.map(() => 0.79 * (surface - WATER_VAPOUR_BAR));
  const stepMinutes = STEP_SECONDS / 60;
  const rateBarPerMin = DESCENT_RATE_M_PER_MIN * barPerMetre;

  let t = 0;
  while (t < SEARCH_LIMIT_MINUTES * 60) {
    const descending = t < descentSeconds - 1e-9;
    const dt = descending ? Math.min(STEP_SECONDS, descentSeconds - t) / 60 : stepMinutes;
    const depthNow = descending ? Math.min(depthM, (t / 60) * DESCENT_RATE_M_PER_MIN) : depthM;
    const ambient = ambientPressureBar(depthNow, conditions);
    const inspired = (ambient - WATER_VAPOUR_BAR) * fN2;
    const rate = descending ? rateBarPerMin * fN2 : 0;
    for (let i = 0; i < COMPARTMENTS.length; i++) {
      const k = Math.LN2 / COMPARTMENTS[i]![0];
      // Schreiner; with rate 0 it is Haldane's.
      tissue[i] = inspired + rate * (dt - 1 / k) - (inspired - tissue[i]! - rate / k) * Math.exp(-k * dt);
    }
    t += dt * 60;
    if (t >= descentSeconds - 1e-9) {
      // Tolerated ambient pressure per compartment at GF high; a stop is needed once one exceeds the surface's.
      for (let i = 0; i < COMPARTMENTS.length; i++) {
        const [, a, b] = COMPARTMENTS[i]!;
        const tolerated = (tissue[i]! - gf * a) / (gf / b - gf + 1);
        if (tolerated > surface + 1e-9) return Math.max(0, Math.floor(t / 60) - 1);
      }
    }
  }
  return Infinity;
}

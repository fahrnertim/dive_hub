// Real gas in a Cylinder (ADR 0045, slice 3; ADR 0033): a full cylinder holds less than pressure × volume says, about
// 3 % less at 200 bar and 10 % at 300 bar for air. The compressibility factor Z is a cubic in the pressure per gas,
// Z = 1 + a·p + b·p² + c·p³, mixed by the gas's fractions.
// The coefficients are our own least-squares fit through NIST's isotherms at 20 °C from 1 to 351 bar, within 0.2 % of
// them (scripts/fit-compressibility.mjs; NIST Chemistry WebBook, Thermophysical Properties of Fluid Systems).

type Cubic = readonly [number, number, number];
const O2: Cubic = [-7.698130e-4, 2.362918e-6, -9.607164e-11];
const N2: Cubic = [-2.850092e-4, 3.167268e-6, -2.215000e-9];
const HE: Cubic = [4.869641e-4, -6.053372e-8, 2.456439e-11];
/** The fit's range: above it the cubic is not to be trusted, so Z stays what it is here. */
const MAX_BAR = 351;
const AIR = { o2: 21, he: 0 };

const minusOne = ([a, b, c]: Cubic, bar: number) => a * bar + b * bar ** 2 + c * bar ** 3;

/** The compressibility factor of a gas (in percent; air when unknown) at a pressure in bar, at 20 °C. */
export function compressibility(bar: number, gas: { o2: number; he: number } | null): number {
  const { o2, he } = gas ?? AIR;
  const p = Math.min(Math.max(bar, 0), MAX_BAR);
  return 1 + (o2 * minusOne(O2, p) + he * minusOne(HE, p) + (100 - o2 - he) * minusOne(N2, p)) / 100;
}

/** The litres at the surface's pressure that a cylinder of `volumeL` holds at `bar`. */
export const surfaceLitres = (volumeL: number, bar: number, gas: { o2: number; he: number } | null) =>
  (volumeL * bar) / compressibility(bar, gas);

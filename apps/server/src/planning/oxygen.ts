// Oxygen exposure (ADR 0032, slice 21). Clean-room from published tables and formulas.

/**
 * NOAA Diving Manual (4th ed.) single-exposure limits: [ppO2 in bar, minutes], as printed by Shearwater
 * ("Shearwater and the CNS oxygen clock"). Between two rows the limit is linear.
 */
const NOAA_ROWS: readonly (readonly [number, number])[] = [
  [0.6, 720], [0.7, 570], [0.8, 450], [0.9, 360], [1.0, 300], [1.1, 240],
  [1.2, 210], [1.3, 180], [1.4, 150], [1.5, 120], [1.6, 45],
];

/** Minutes one exposure may last at a ppO2: 0 above 1.6 bar, unlimited below the table's first row. */
export function oxygenLimitMinutes(ppO2: number): number {
  const first = NOAA_ROWS[0]!;
  const last = NOAA_ROWS[NOAA_ROWS.length - 1]!;
  if (ppO2 > last[0] + 1e-9) return 0;
  if (ppO2 < first[0] - 1e-9) return Infinity;
  for (let i = 1; i < NOAA_ROWS.length; i++) {
    const [p1, m1] = NOAA_ROWS[i]!;
    const [p0, m0] = NOAA_ROWS[i - 1]!;
    if (ppO2 <= p1 + 1e-9) return m0 + ((ppO2 - p0) / (p1 - p0)) * (m1 - m0);
  }
  return last[1];
}

/** Oxygen toxicity units (Hamilton, REPEX, SPUMS J 27(1)): minutes × ((ppO2 − 0.5) / 0.5)^0.83. */
export function otu(ppO2: number, minutes: number): number {
  if (ppO2 <= 0.5) return 0;
  return minutes * ((ppO2 - 0.5) / 0.5) ** 0.83;
}

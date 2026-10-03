// Dive Hub's own words for values that dive computers record (ADR 0015). Every Source adapter maps
// its vocabulary onto these; the API publishes them as enums and clients translate them.
// Names follow UDDF where it has a term (ADR 0003).

export const WATER_TYPES = ['fresh', 'salt', 'brackish', 'en13319', 'custom'] as const;
export type WaterType = (typeof WATER_TYPES)[number];

export const DIVE_MODES = ['open_circuit', 'ccr', 'scr', 'gauge', 'apnea'] as const;
export type DiveMode = (typeof DIVE_MODES)[number];

/** Decompression models are proper names; clients show them, they don't translate them. */
export const DECO_MODELS = ['buhlmann_zhl16c'] as const;
export type DecoModel = (typeof DECO_MODELS)[number];

/** Whether a gas is breathed directly or is a rebreather's diluent. */
export const GAS_CIRCUITS = ['open_circuit', 'diluent'] as const;
export type GasCircuit = (typeof GAS_CIRCUITS)[number];

// Dive Hub's own words for values that dive computers record (ADR 0015). Every Source adapter maps
// its vocabulary onto these; the API publishes them as enums and clients translate them.
// Names follow UDDF where it has a term (ADR 0003).

export const WATER_TYPES = ['fresh', 'salt', 'brackish', 'en13319', 'custom'] as const;
export type WaterType = (typeof WATER_TYPES)[number];

/**
 * The water at a Dive site (ADR 0025). A Dive's water type is its site's; the device-only settings
 * (EN 13319, custom density) stay on the Recording as the computer's setting.
 */
export const SITE_WATER_TYPES = ['fresh', 'salt', 'brackish'] as const satisfies readonly WaterType[];
export type SiteWaterType = (typeof SITE_WATER_TYPES)[number];

/** Density in kg/m³ that a computer assumes for each setting (Garmin's FIT profile: salt 1025, EN 13319 1020). */
export const WATER_DENSITY: Partial<Record<WaterType, number>> = { fresh: 1000, salt: 1025, en13319: 1020 };

export const DIVE_MODES = ['open_circuit', 'ccr', 'scr', 'gauge', 'apnea'] as const;
export type DiveMode = (typeof DIVE_MODES)[number];

/** Decompression models are proper names; clients show them, they don't translate them. */
export const DECO_MODELS = ['buhlmann_zhl16c'] as const;
export type DecoModel = (typeof DECO_MODELS)[number];

/** Whether a gas is breathed directly or is a rebreather's diluent. */
export const GAS_CIRCUITS = ['open_circuit', 'diluent'] as const;
export type GasCircuit = (typeof GAS_CIRCUITS)[number];

/**
 * What a dive computer itself noted during a dive (ADR 0036), shown beside Dive Hub's findings, never merged with
 * them. Alerts that say nothing about the dive (dismissed, battery, setpoint switches, the User's own time and depth
 * alarms) have no word here and are left out.
 */
export const COMPUTER_EVENTS = [
  'ascent_critical', 'safety_stop_started', 'safety_stop_broken', 'safety_stop_complete', 'approaching_ndl', 'ndl_reached',
  'approaching_first_stop', 'ceiling_broken', 'deco_stop_cleared', 'deco_complete', 'po2_warning', 'po2_high', 'po2_low',
  'cns_warning', 'cns_critical', 'otu_warning', 'otu_critical',
] as const;
export type ComputerEvent = (typeof COMPUTER_EVENTS)[number];

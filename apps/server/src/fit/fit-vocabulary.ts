// Garmin FIT values (snake_case as fit-file-parser delivers them) → our vocabulary (ADR 0015).
// Unmapped values return undefined; the adapter keeps them as raw extras instead of guessing.
import type { ComputerEvent, DecoModel, DiveMode, GasCircuit, WaterType } from '../vocabulary.js';

const WATER_TYPE: Record<string, WaterType> = { fresh: 'fresh', salt: 'salt', en13319: 'en13319', custom: 'custom' };

const DIVE_MODE: Record<string, DiveMode> = {
  single_gas_diving: 'open_circuit',
  multi_gas_diving: 'open_circuit',
  gauge_diving: 'gauge',
  ccr_diving: 'ccr',
  apnea_diving: 'apnea',
  apnea_hunting: 'apnea',
  dynamic_apnea: 'apnea',
};

const DECO_MODEL: Record<string, DecoModel> = { zhl16c: 'buhlmann_zhl16c' };

const CIRCUIT: Record<string, GasCircuit> = { open_circuit: 'open_circuit', closed_circuit_diluent: 'diluent' };

const lookup = <T>(table: Record<string, T>) => (value: string | undefined): T | undefined =>
  value !== undefined && Object.hasOwn(table, value) ? table[value] : undefined;

export const waterTypeFromFit = lookup(WATER_TYPE);
export const diveModeFromFit = lookup(DIVE_MODE);
export const decoModelFromFit = lookup(DECO_MODEL);
export const circuitFromFit = lookup(CIRCUIT);

/** Garmin's `dive_alert` codes (FIT profile) that say something about the dive; the rest stay unmapped. */
const DIVE_ALERT: Record<number, ComputerEvent> = {
  0: 'ndl_reached', 3: 'approaching_ndl', 4: 'po2_warning', 5: 'po2_high', 6: 'po2_low', 9: 'ceiling_broken', 10: 'deco_complete',
  11: 'safety_stop_broken', 12: 'safety_stop_complete', 13: 'cns_warning', 14: 'cns_critical', 15: 'otu_warning', 16: 'otu_critical',
  17: 'ascent_critical', 22: 'safety_stop_started', 23: 'approaching_first_stop', 34: 'deco_stop_cleared',
};

/** A stored Recording event (`type`, `data.data`) as a computer event in our vocabulary, if it is one. */
export function computerEventFromFit(type: string, data: Record<string, unknown>): ComputerEvent | undefined {
  return type === 'dive_alert' && typeof data.data === 'number' ? DIVE_ALERT[data.data] : undefined;
}

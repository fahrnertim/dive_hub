// Garmin FIT values (snake_case as fit-file-parser delivers them) → our vocabulary (ADR 0015).
// Unmapped values return undefined; the adapter keeps them as raw extras instead of guessing.
import type { DecoModel, DiveMode, GasCircuit, WaterType } from '../vocabulary.js';

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

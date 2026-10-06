// Suunto's values, from the app's JSON export and its FIT export, → our vocabulary (ADR 0015, ADR 0037).
// Unmapped values return undefined; the adapters keep them as raw extras instead of guessing.
import type { ComputerEvent, DecoModel, DiveMode } from '../vocabulary.js';

/** `Header.Diving.DiveMode` of the JSON export. */
const DIVE_MODE: Record<string, DiveMode> = {
  air: 'open_circuit', nitrox: 'open_circuit', ean: 'open_circuit', mixed: 'open_circuit', trimix: 'open_circuit',
  gauge: 'gauge', free: 'apnea', ccr: 'ccr', 'ccr nitrox': 'ccr', 'ccr trimix': 'ccr',
};

/** The FIT developer field `dive_mode` (Suunto's FIT description): OFF 0 has no word. */
const FIT_DIVE_MODE: Record<number, DiveMode> = {
  1: 'gauge', 2: 'apnea', 3: 'open_circuit', 4: 'open_circuit', 5: 'open_circuit', 6: 'ccr', 7: 'open_circuit',
  8: 'open_circuit', 9: 'ccr', 10: 'ccr',
};

/** `Header.Diving.Algorithm`. */
const DECO_MODEL: Record<string, DecoModel> = {
  'suunto fused rgbm': 'suunto_fused_rgbm', 'suunto fused2 rgbm': 'suunto_fused2_rgbm', 'suunto fused rgbm 2': 'suunto_fused2_rgbm',
};

const byName = <T>(table: Record<string, T>) => (value: string | undefined): T | undefined => {
  const key = value?.trim().toLowerCase();
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
};

export const diveModeFromSuunto = byName(DIVE_MODE);
export const decoModelFromSuunto = byName(DECO_MODEL);
export const diveModeFromSuuntoFit = (value: number | undefined): DiveMode | undefined =>
  (value !== undefined && Object.hasOwn(FIT_DIVE_MODE, value) ? FIT_DIVE_MODE[value] : undefined);

/** The kinds of entries in a JSON sample's `Events`, as stored event types. */
export const SUUNTO_EVENT_TYPES = { Alarm: 'suunto_alarm', Warning: 'suunto_warning', Notify: 'suunto_notify', State: 'suunto_state' } as const;

/** What the computer noted, by event type and Suunto's name for it; everything else has no word (ADR 0037). */
const COMPUTER_EVENT: Record<string, Record<string, ComputerEvent>> = {
  suunto_alarm: { 'ascent speed': 'ascent_critical', 'violated deep stop': 'deep_stop_broken' },
  suunto_warning: {
    'po2 high': 'po2_high', 'mandatory safety stop': 'safety_stop_mandatory', 'deep stop broken': 'deep_stop_broken',
    'tank pressure': 'tank_pressure_low',
  },
  suunto_notify: { 'safety stop': 'safety_stop_started', 'deep stop': 'deep_stop_started' },
};

/**
 * A stored Suunto event as a computer event in our vocabulary, if it is one: only when the computer switched it on
 * (`active`), and for a stop the diver drifts in and out of, only the first time (`repeat` marks the others).
 */
export function computerEventFromSuunto(type: string, data: Record<string, unknown>): ComputerEvent | undefined {
  if (data.active !== true || data.repeat === true || typeof data.name !== 'string') return undefined;
  const names = Object.hasOwn(COMPUTER_EVENT, type) ? COMPUTER_EVENT[type]! : undefined;
  const name = data.name.trim().toLowerCase();
  return names && Object.hasOwn(names, name) ? names[name] : undefined;
}

// FIT values → Dive Hub's own vocabulary (ADR 0015). Expected values follow Garmin's FIT profile
// (water_type, sub_sport, tissue_model_type, dive_gas_mode) as probed on 2026-10-03.
import { describe, expect, it } from 'vitest';
import { circuitFromFit, decoModelFromFit, diveModeFromFit, waterTypeFromFit } from '../src/fit/fit-vocabulary.js';

describe('water type', () => {
  it.each([['fresh', 'fresh'], ['salt', 'salt'], ['en13319', 'en13319'], ['custom', 'custom']])('%s → %s', (fit, ours) => {
    expect(waterTypeFromFit(fit)).toBe(ours);
  });
});

describe('dive mode', () => {
  it.each([
    ['single_gas_diving', 'open_circuit'],
    ['multi_gas_diving', 'open_circuit'],
    ['gauge_diving', 'gauge'],
    ['ccr_diving', 'ccr'],
    ['apnea_diving', 'apnea'],
    ['apnea_hunting', 'apnea'],
    ['dynamic_apnea', 'apnea'],
  ])('%s → %s', (fit, ours) => {
    expect(diveModeFromFit(fit)).toBe(ours);
  });
});

describe('deco model and gas circuit', () => {
  it('names Bühlmann ZHL-16C', () => {
    expect(decoModelFromFit('zhl16c')).toBe('buhlmann_zhl16c');
  });

  it('tells open-circuit gases from CCR diluents', () => {
    expect(circuitFromFit('open_circuit')).toBe('open_circuit');
    expect(circuitFromFit('closed_circuit_diluent')).toBe('diluent');
  });
});

describe('values nobody has mapped yet', () => {
  it('are left out, so the adapter can keep the raw value as an extra', () => {
    expect(waterTypeFromFit('brine')).toBeUndefined();
    expect(diveModeFromFit('snorkeling')).toBeUndefined();
    expect(decoModelFromFit('vpm_b')).toBeUndefined();
    expect(circuitFromFit(undefined)).toBeUndefined();
  });
});

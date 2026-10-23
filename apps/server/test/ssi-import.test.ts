// SSI's dives as Dive Hub reads them for an import (ADR 0030): evidence (sent by Dive Hub, from a dive computer, typed by
// hand), SSI's zeros as "none", buddy-list entries as SSI accounts, the profile, the site's position from the context.
// Pure: no database, no network.
import { describe, expect, it } from 'vitest';
import type { SsiLogbook } from '../src/providers/ssi/ssi-client.js';
import { contextOf, parseSsiDive, ssiOrigin } from '../src/providers/ssi/ssi-import.js';
import { computerDive, handTypedDive } from './fake-ssi.js';

const logbook: SsiLogbook = {
  dives: [],
  sites: [{ id: '3314', name: 'Hausreef', latitude: 27.29, longitude: 33.82, country: 'EG', waterType: 'salt' }],
  buddies: [{ id: 3_786_888, name: 'Kai Lund', account: '4989164' }, { id: 1_111, name: 'No Account', account: null }],
};
const context = contextOf(logbook);
const withId = (record: Record<string, unknown>, id = 27_000_001) => ({ ...record, odin_user_log_id: id });

describe('SSI dives for an import', () => {
  it('keeps of the logbook only accounts and sites as the context, no names of people', () => {
    expect(context).toEqual({ people: { 3786888: '4989164' }, sites: { 3314: { name: 'Hausreef', latitude: 27.29, longitude: 33.82, country: 'EG', waterType: 'salt' } } });
  });

  it('reads a dive typed by hand: rounded values, SSI\'s zeros as none, buddies as their SSI accounts', () => {
    const d = parseSsiDive(withId(handTypedDive({
      at: '2025-08-10 10:00', depthM: 18, minutes: 45, siteId: 3314, buddies: [3_786_888, 1_111, 999], comment: 'Turtle', nr: 12,
    })), context)!;
    expect(d).toMatchObject({
      remoteId: '27000001', remoteNumber: 12, evidence: 'logbook', reference: null, localStart: '2025-08-10 10:00',
      durationSeconds: 2700, maxDepthM: 18, avgDepthM: null, waterTemperatureC: null, siteIds: { ssi: '3314' },
      sitePosition: { latitude: 27.29, longitude: 33.82 }, device: null, people: ['4989164'], notes: 'Turtle', entry: null,
    });
    expect(d.samples).toEqual({});
  });

  it('reads a dive synced from a dive computer: its profile every 5 s, the computer, the gas', () => {
    const d = parseSsiDive(withId(computerDive({
      at: '2025-08-11 14:00', depthM: 22, minutes: 40, manufacturer: 'Mares', product: 'Puck 4', serial: '4711',
    })), context)!;
    expect(d.evidence).toBe('computer');
    expect(d.device).toEqual({ manufacturer: 'mares', product: 'Puck 4', serialNumber: '4711', firmware: null });
    expect(d.durationSeconds).toBe(2400);
    expect(d.samples.depth!.offsetsMs.slice(0, 3)).toEqual([0, 5000, 10_000]);
    expect(Math.max(...d.samples.depth!.values)).toBe(22);
    expect(d.samples.temperature!.values[0]).toBe(24);
    // SSI's no-deco 99 means none; the rest in seconds.
    expect(d.samples.ndl!.values.every((v) => v === 40 * 60)).toBe(true);
    expect(d.gases).toEqual([{ o2: 32, he: 0 }]);
  });

  it('tells a dive Dive Hub sent by its reference, though SSI marks it as from a computer too', () => {
    const sent = { ...computerDive({ at: '2025-08-11 14:00', depthM: 22, minutes: 40, manufacturer: 'garmin', product: 'Descent Mk3', serial: '111' }),
      odin_user_log_divecomputer_dive_ref: 'divehub-0190a3f2-0000-7000-8000-000000000001' };
    expect(parseSsiDive(withId(sent), context)).toMatchObject({ evidence: 'ours', reference: 'divehub-0190a3f2-0000-7000-8000-000000000001' });
  });

  it('needs a profile and a serial number for "from a computer": SSI\'s flag alone proves nothing', () => {
    const flagOnly = { ...handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45 }), odin_user_log_divecomputer_imported: 1 };
    expect(parseSsiDive(withId(flagOnly), context)!.evidence).toBe('logbook');
    const noSerial = { ...computerDive({ at: '2025-08-11 14:00', depthM: 22, minutes: 40, manufacturer: 'Mares', product: 'Puck 4', serial: '4711' }),
      odin_user_log_divecomputer_serial_nr: '' };
    expect(parseSsiDive(withId(noSerial), context)).toMatchObject({ evidence: 'logbook', device: null, samples: {} });
  });

  it('reads the computer from an older record that names it only in its reference ("Mares Puck4_2418005226")', () => {
    // SSI's iOS app 4.1.203 (early 2025): serial number, manufacturer and name empty.
    const record = {
      ...handTypedDive({ at: '2025-02-12 19:26', depthM: 9.9, minutes: 67 }), odin_user_log_divecomputer_serial_nr: '',
      odin_user_log_divecomputer_manufacturer: '', odin_user_log_divecomputer_name: '', odin_user_log_divecomputer_ref: 'Mares Puck4_2418005226',
      odin_user_log_depthDataset: '[0.0,5.0,9.9,0.0]', odin_user_log_tempDataset: '[24.0,23.0,22.5,23.0]',
    };
    expect(parseSsiDive(withId(record), context)).toMatchObject({
      evidence: 'computer', device: { manufacturer: 'mares', product: 'Puck4', serialNumber: '2418005226' },
    });
    // Without a profile it stays a logbook entry, whatever the reference says.
    expect(parseSsiDive(withId({ ...record, odin_user_log_depthDataset: '' }), context)!.evidence).toBe('logbook');
  });

  it('reads the depth and temperature datasets when there are no samples', () => {
    const record = {
      ...handTypedDive({ at: '2025-08-11 14:00', depthM: 3, minutes: 1 }), odin_user_log_divecomputer_serial_nr: '42',
      odin_user_log_divecomputer_manufacturer: 'Mares', odin_user_log_depthDataset: '[0.0,3.0,0.0]', odin_user_log_tempDataset: '[24.0,23.5,24.0]',
    };
    const d = parseSsiDive(withId(record), context)!;
    expect(d.samples.depth).toEqual({ offsetsMs: [0, 5000, 10_000], values: [0, 3, 0] });
    expect(d.samples.temperature!.values).toEqual([24, 23.5, 24]);
  });

  it('reads the tank typed at SSI as one cylinder: volume, pressures, material by SSI\'s tank type, the gas', () => {
    const dive = handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45 });
    // As dive #118 of the development logbook: 19 is "steel", 20 "alu" in SSI's `get_divelog_vars`.
    const full = {
      ...dive, odin_user_log_tank_vol_l: 12, odin_user_log_var_tanktype_id: 19, odin_user_log_pressure_start_bar: 204,
      odin_user_log_pressure_end_bar: 47, odin_user_log_pressure_start_psi: 2959, odin_user_log_ean: 1, odin_user_log_ean_percent: 32,
    };
    expect(parseSsiDive(withId(full), context)!.cylinder).toEqual({
      volumeL: 12, material: 'steel', startPressureBar: 204, endPressureBar: 47, gas: { o2: 32, he: 0 },
    });
    // A size and a type alone are a tank too: a person typed them for this dive.
    const sizeOnly = { ...dive, odin_user_log_tank_vol_l: 15, odin_user_log_var_tanktype_id: 20, odin_user_log_pressure_start_bar: 0, odin_user_log_pressure_end_bar: 0, odin_user_log_ean: 0 };
    expect(parseSsiDive(withId(sizeOnly), context)!.cylinder).toEqual({
      volumeL: 15, material: 'aluminium', startPressureBar: null, endPressureBar: null, gas: { o2: 21, he: 0 },
    });
    // A tank type Dive Hub doesn't know names no material.
    expect(parseSsiDive(withId({ ...sizeOnly, odin_user_log_var_tanktype_id: 77 }), context)!.cylinder).toMatchObject({ volumeL: 15, material: null });
  });

  it('reads no cylinder where SSI has no volume and no pressure: a gas or a tank type alone is none', () => {
    const dive = { ...handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45 }), odin_user_log_tank_vol_l: 0, odin_user_log_var_tanktype_id: 20, odin_user_log_ean: 1, odin_user_log_ean_percent: 32 };
    expect(parseSsiDive(withId(dive), context)!.cylinder).toBeNull();
  });

  it('reads SSI\'s booleans in every form: 1, \'1\' and true; 0, \'0\' and false', () => {
    const dive = handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45 });
    for (const yes of [true, 1, '1']) {
      expect(parseSsiDive(withId({ ...dive, odin_user_log_ean: yes, odin_user_log_ean_percent: 32 }), context)!.gases).toEqual([{ o2: 32, he: 0 }]);
      expect(ssiOrigin({ ...dive, odin_user_log_divecenter_confirmed: yes }).confirmedByCentre).toBe(true);
    }
    for (const no of [false, 0, '0']) {
      expect(parseSsiDive(withId({ ...dive, odin_user_log_ean: no, odin_user_log_ean_percent: 32 }), context)!.gases).toEqual([{ o2: 21, he: 0 }]);
      expect(ssiOrigin({ ...dive, odin_user_log_divecenter_confirmed: no }).confirmedByCentre).toBe(false);
    }
  });

  it('reads the weight typed at SSI as the lead of the dive in kg; 0 or nothing is not typed', () => {
    const dive = handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45 });
    expect(parseSsiDive(withId({ ...dive, odin_user_log_weight_kg: 6 }), context)!.leadKg).toBe(6);
    expect(parseSsiDive(withId({ ...dive, odin_user_log_weight_kg: 4.8, odin_user_log_weight_lb: 11 }), context)!.leadKg).toBe(4.8);
    expect(parseSsiDive(withId({ ...dive, odin_user_log_weight_kg: 0 }), context)!.leadKg).toBeNull();
    expect(parseSsiDive(withId(dive), context)!.leadKg).toBeNull();
  });

  it('reads the dive type as a dive mode', () => {
    const dive = handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45 });
    const mode = (type: unknown) => parseSsiDive(withId({ ...dive, odin_user_log_dive_type: type }), context)!.diveMode;
    expect([6, 7, 8, 5, 2].map(mode)).toEqual(['apnea', 'apnea', 'ccr', 'scr', 'open_circuit']);
    expect(mode(42)).toBeNull();
    expect(parseSsiDive(withId(dive), context)!.diveMode).toBeNull();
  });

  it('reads the surface interval in seconds, only where the app takes it', () => {
    const dive = handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45 });
    const interval = (seconds: unknown) => parseSsiDive(withId({ ...dive, odin_user_log_si_before: seconds }), context)!.surfaceIntervalSeconds;
    expect(interval(5400)).toBe(5400);
    expect(interval(120)).toBeNull();
    expect(interval(100_000)).toBeNull();
    expect(parseSsiDive(withId(dive), context)!.surfaceIntervalSeconds).toBeNull();
  });

  it('reads the average heart rate where it is positive, also of a logbook entry', () => {
    const dive = handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45 });
    expect(parseSsiDive(withId({ ...dive, odin_user_log_heartRateAvg: 72 }), context)).toMatchObject({ evidence: 'logbook', avgHeartRate: 72, samples: {} });
    expect(parseSsiDive(withId({ ...dive, odin_user_log_heartRateAvg: 0 }), context)!.avgHeartRate).toBeNull();
  });

  it('reads tank pressure, heart rate and CNS from the samples, and the datasets without them', () => {
    const base = computerDive({ at: '2025-08-11 14:00', depthM: 22, minutes: 1, manufacturer: 'Mares', product: 'Puck 4', serial: '4711' });
    const withSamples = {
      ...base,
      odin_user_log_diveSamples: JSON.stringify([
        { t: 0, d: 0, pr: { t: 0, v: 200 }, hb: 80, cn: 5 },
        { t: 5000, d: 5, pr: { t: 1, v: 150 }, hb: 85, cn: 6 },
        { t: 10_000, d: 6, pr: { t: 0, v: 190 } },
      ]),
    };
    const d = parseSsiDive(withId(withSamples), context)!;
    expect(d.samples.tankPressure).toEqual({ offsetsMs: [0, 10_000], values: [200, 190] });
    expect(d.samples.heartRate).toEqual({ offsetsMs: [0, 5000], values: [80, 85] });
    expect(d.samples.cns).toEqual({ offsetsMs: [0, 5000], values: [5, 6] });

    const datasets = {
      ...handTypedDive({ at: '2025-08-11 14:00', depthM: 3, minutes: 1 }), odin_user_log_divecomputer_serial_nr: '42',
      odin_user_log_divecomputer_manufacturer: 'Mares', odin_user_log_depthDataset: '[0.0,3.0]',
      odin_user_log_tankPressureDataset: '[200.0,190.0]', odin_user_log_heartRateDataset: '[80,85]',
    };
    const fromDatasets = parseSsiDive(withId(datasets), context)!;
    expect(fromDatasets.samples.tankPressure).toEqual({ offsetsMs: [0, 5000], values: [200, 190] });
    expect(fromDatasets.samples.heartRate).toEqual({ offsetsMs: [0, 5000], values: [80, 85] });
  });

  it('treats SSI\'s zero (and a negative) tank pressure and heart rate as nothing', () => {
    const base = computerDive({ at: '2025-08-11 14:00', depthM: 22, minutes: 1, manufacturer: 'Mares', product: 'Puck 4', serial: '4711' });
    const zeros = { ...base, odin_user_log_diveSamples: JSON.stringify([{ t: 0, d: 0, pr: { t: 0, v: 0 }, hb: 0 }, { t: 5000, d: 5, pr: { t: 0, v: -1 }, hb: -3 }]) };
    const d = parseSsiDive(withId(zeros), context)!;
    expect(d.samples.tankPressure).toBeUndefined();
    expect(d.samples.heartRate).toBeUndefined();

    const datasets = {
      ...handTypedDive({ at: '2025-08-11 14:00', depthM: 3, minutes: 1 }), odin_user_log_divecomputer_serial_nr: '42',
      odin_user_log_divecomputer_manufacturer: 'Mares', odin_user_log_depthDataset: '[0.0,3.0]',
      odin_user_log_tankPressureDataset: '[0.0,0.0]', odin_user_log_heartRateDataset: '[0,-2]',
    };
    const fromDatasets = parseSsiDive(withId(datasets), context)!;
    expect(fromDatasets.samples.tankPressure).toBeUndefined();
    expect(fromDatasets.samples.heartRate).toBeUndefined();
  });

  it('skips a record without a start time', () => {
    expect(parseSsiDive(withId({ ...handTypedDive({ at: '', depthM: 3, minutes: 1 }) }), context)).toBeNull();
  });
});

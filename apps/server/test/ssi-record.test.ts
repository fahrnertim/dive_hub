// A Dive as SSI's dive record (ADR 0024), and the secrets kept for SSI: pure, no database.
import { describe, expect, it } from 'vitest';
import { createSecretBox, parseEncryptionKey } from '../src/secrets/secret-box.js';
import { SENT_KEYS } from '../src/providers/ssi/ssi-dive-row.js';
import {
  compareReadBack, createRecord, deleteRecord, fingerprint, localTime, ownFields, resample, samplesJson, updateRecord, writableRecord, type DiveForSsi,
} from '../src/providers/ssi/ssi-record.js';
import { diveModeOfSsi, keepTraining, ssiDiveType } from '../src/providers/ssi/ssi-dive-type.js';

const dive = (over: Partial<DiveForSsi> = {}): DiveForSsi => ({
  startsAt: new Date('2026-01-15T09:00:00Z'), utcOffsetSeconds: 7200, durationSeconds: 30 * 60 + 20,
  maxDepthM: 18.46, avgDepthM: 12.3, waterTemperatureC: 24, maxTemperatureC: 26.5, waterType: 'salt', notes: 'Turtle',
  cylinder: null, leadKg: null, diveMode: 'open_circuit', surfaceIntervalSeconds: null, avgHeartRate: null,
  siteSsiId: '3314', participants: [], entry: { latitude: 27.29, longitude: 33.82 }, exit: null,
  gases: [{ o2: 32, he: 0 }], gfLow: 40, gfHigh: 85, cnsStart: 0, cnsEnd: 12,
  device: { manufacturer: 'garmin', product: 'Descent Mk3', serialNumber: '0034567890', firmware: '27.19' },
  samples: {
    depth: { offsetsMs: [0, 60_000, 1_200_000, 1_820_000], values: [0, 10, 18, 0] },
    temperature: { offsetsMs: [0, 600_000], values: [26, 24] },
    ndl: { offsetsMs: [0, 60_000], values: [6000, 2400] },
  },
  ...over,
});

describe('local time', () => {
  it('is the wall-clock time at the dive, to the minute', () => {
    expect(localTime(new Date('2026-01-15T23:30:59Z'), 3600)).toEqual({ date: '2026-01-16', time: '00:30', dateTime: '2026-01-16 00:30' });
  });
  it('is UTC when the offset is unknown', () => {
    expect(localTime(new Date('2026-01-15T09:05:00Z'), null).dateTime).toBe('2026-01-15 09:05');
  });
});

describe('profile', () => {
  const samples = resample(dive().samples, dive().durationSeconds);

  it('is on a 5 s grid to the end of the dive, depth interpolated', () => {
    expect(samples[0]).toMatchObject({ n: 1, t: 0, d: 0 });
    expect(samples[6]).toMatchObject({ n: 7, t: 30_000, d: 5 });
    expect(samples.at(-1)!.t).toBe(1_820_000);
    expect(samples.every((s, i) => s.t === i * 5000)).toBe(true);
  });

  it('holds temperature and NDL (in whole minutes, at most 99) from the last reading', () => {
    expect(samples[0]).toMatchObject({ te: 26, ndl: 99 });
    expect(samples[13]).toMatchObject({ te: 26, ndl: 40 });
    expect(samples[200]).toMatchObject({ te: 24 });
  });

  it('sets SSI\'s phase flags with its hysteresis: at depth below 8.5 m until above 6 m, surfaced above 1 m', () => {
    const atDepth = 0x10000;
    expect(samples[0]!.mf & 0x04000000).toBeTruthy();
    expect(samples[12]!.mf & atDepth).toBeTruthy(); // 10 m
    const at7m = samples.findLast((s) => s.d > 6 && s.d < 8)!;
    expect(at7m.mf & atDepth).toBeTruthy();
    expect(samples.every((s) => s.mf & 0x08000000)).toBe(true);
  });

  it('writes decimals where SSI\'s app expects them, also for whole numbers', () => {
    const json = samplesJson(samples.slice(0, 1));
    expect(json).toBe('[{"n":1,"t":0,"d":0.0,"s":0.0,"te":26.0,"ndl":99,"gs":0.0,"gn":0.0,"a":0,"mf":201326592,"o":true,"dr":false,"rv":3.0}]');
    expect(JSON.parse(json)).toHaveLength(1);
  });

  it('is empty without a depth series', () => {
    expect(resample({}, 600)).toEqual([]);
  });

  const withChannels = dive().samples;
  const channels = {
    ...withChannels,
    tankPressure: { offsetsMs: [0, 1_820_000], values: [200, 50] },
    heartRate: { offsetsMs: [0, 600_000], values: [70.4, 90.6] },
    cns: { offsetsMs: [0, 600_000], values: [1.2, 3.7] },
  };

  it('carries tank pressure, heart rate and CNS where the Recording has them', () => {
    const s = resample(channels, 1_820);
    expect(s[0]).toMatchObject({ pr: { t: 0, v: 200 }, hb: 70, cn: 1 });
    expect(s[182]!.pr!.v).toBeCloseTo(125, 0);
    expect(s[130]).toMatchObject({ hb: 91, cn: 4 });
    expect(s.at(-1)!.pr).toEqual({ t: 0, v: 50 });
  });

  it('leaves the keys out without a series', () => {
    const plain = resample(dive().samples, 1_820);
    const json = samplesJson(plain);
    expect(json).not.toMatch(/"pr"|"hb"|"cn"/);
    const fields = ownFields(dive());
    expect(fields.odin_user_log_tankPressureDataset).toBeNull();
    expect(fields.odin_user_log_heartRateDataset).toBeNull();
  });

  it('a series that ends early holds its last value', () => {
    const early = resample({ ...withChannels, tankPressure: { offsetsMs: [0, 600_000], values: [200, 150] } }, 1_820);
    expect(early[200]!.pr!.v).toBe(150);
    expect(early.at(-1)!.pr!.v).toBe(150);
  });

  it('a rebreather dive is not open circuit', () => {
    const flags = (diveMode: DiveForSsi['diveMode']) =>
      JSON.parse(String(ownFields(dive({ diveMode })).odin_user_log_diveSamples)).map((s: { o: boolean }) => s.o);
    expect(flags('ccr').every((o: boolean) => o === false)).toBe(true);
    expect(flags('scr').every((o: boolean) => o === false)).toBe(true);
    expect(flags('open_circuit').every((o: boolean) => o === true)).toBe(true);
    expect(flags('apnea').every((o: boolean) => o === true)).toBe(true);
  });

  it('writes the new keys with decimals where the app expects them', () => {
    const json = samplesJson(resample(channels, 1_820).slice(0, 1));
    expect(json).toContain('"rv":3.0,"pr":{"t":0,"v":200.0},"hb":70,"cn":1}');
    const fields = ownFields(dive({ samples: channels }));
    expect(String(fields.odin_user_log_tankPressureDataset).startsWith('[200.0,')).toBe(true);
    expect(String(fields.odin_user_log_heartRateDataset).startsWith('[70.0,')).toBe(true);
  });
});

describe('records', () => {
  const ids = { number: 46, accountId: '5012047', reference: 'divehub-abc' };

  it('a new dive has every key SSI expects, our values, and nulls for the rest', () => {
    const r = createRecord(dive(), ids);
    expect(Object.keys(r).length).toBeGreaterThan(300);
    expect(r).toMatchObject({
      odin_user_log_id: null, odin_user_log_nr: 46, internalPk: 46, odin_user_log_user_master_id: 5012047,
      odin_user_log_datetime: '2026-01-15 11:00', odin_user_log_date: '2026-01-15', odin_user_log_entry_time: '11:00',
      odin_user_log_divetime: 30, odin_user_log_depth_m: 18.5, odin_user_log_depth_ft: 60.6, odin_user_log_avg_depth_m: 12.3,
      odin_user_log_watertemp_c: 24, odin_user_log_watertemp_max_c: 26.5, odin_user_log_var_watertype_id: 5,
      odin_user_log_dive_sites_id: 3314, odin_user_log_comment: 'Turtle',
      odin_user_log_ean: true, odin_user_log_ean_percent: 32, odin_user_log_gf_set: '40 / 85',
      odin_user_log_divecomputer_serial_nr: '0034567890', odin_user_log_divecomputer_manufacturer: 'garmin',
      odin_user_log_divecomputer_name: 'Descent Mk3', odin_user_log_divecomputer_dive_ref: 'divehub-abc',
      odin_user_log_pos_start_latitude: 27.29, odin_user_log_deleted: false, odin_user_log_confirmed: null,
      odin_user_log_buddy_ids: [], odin_user_log_xr_deco3_ean_o2: null, odin_user_log_ccr_bailout03_end_psi: null,
      odin_user_log_frddisc_VWT_TIME: null,
    });
    expect(JSON.parse(r.odin_user_log_depthDataset as string)).toHaveLength(365);
    expect(typeof r.odin_user_log_diveSamples).toBe('string');
  });

  it('a new dive has exactly the keys the app sends, with its booleans false', () => {
    const r = createRecord(dive(), ids);
    expect(Object.keys(r).sort()).toEqual([...SENT_KEYS].sort());
    expect(r).toMatchObject({ odin_user_log_deleted: false, odin_user_log_apple_watch: false, odin_user_log_dive_on_own_risk: false });
  });

  it("an update sends exactly the app's keys: SSI's values for the extended data and the gear note, booleans as booleans", () => {
    const remote = {
      odin_user_log_gear_details: 'note', log_extended_data_latitude: 1.5, log_extended_data_longitude: 2.5, log_extended_data_conservatism: 2,
      log_extended_data_decomodel: 'zhl', log_extended_data_libdivecomputer_identifier_base64: 'abc',
      odin_user_log_ean: '1', odin_user_log_deleted: 0, odin_user_log_apple_watch: true, not_in_the_row: 1,
    };
    const r = writableRecord(remote);
    expect(Object.keys(r).sort()).toEqual([...SENT_KEYS].sort());
    expect(r).toMatchObject({
      odin_user_log_gear_details: 'note', log_extended_data_latitude: 1.5, log_extended_data_longitude: 2.5, log_extended_data_conservatism: 2,
      log_extended_data_decomodel: 'zhl', log_extended_data_libdivecomputer_identifier_base64: 'abc',
      odin_user_log_ean: true, odin_user_log_deleted: false, odin_user_log_apple_watch: true, odin_user_log_rating: null,
    });
    expect(r).not.toHaveProperty('not_in_the_row');
  });

  it('reads the two freediving fields SSI names with a stray x_', () => {
    expect(writableRecord({ x_odin_user_log_frd_suit: 3 }).odin_user_log_frd_suit).toBe(3);
  });

  it("sends the Dive site's water type: fresh and salt by SSI's IDs, nothing for brackish or none (ADR 0025)", () => {
    expect(createRecord(dive({ waterType: 'fresh' }), ids).odin_user_log_var_watertype_id).toBe(4);
    expect(createRecord(dive({ waterType: 'brackish' }), ids).odin_user_log_var_watertype_id).toBeNull();
    expect(createRecord(dive({ waterType: null }), ids).odin_user_log_var_watertype_id).toBeNull();
  });

  it('air is EAN 0 with 0 %', () => {
    expect(createRecord(dive({ gases: [{ o2: 21, he: 0 }] }), ids)).toMatchObject({ odin_user_log_ean: false, odin_user_log_ean_percent: 0 });
  });

  it('an update keeps what was edited in the SSI app, puts our values on top, and sends nothing read-only', () => {
    const remote = {
      ...createRecord(dive({ notes: null }), ids), odin_user_log_id: 27_000_001, odin_user_log_rating: 5,
      odin_user_log_comment: 'from the app', x_odin_user_log_frd_suit: 'wet', updates: 3, app_version: '5.0.43',
    };
    const r = updateRecord(remote, dive({ maxDepthM: 20, notes: null }));
    expect(r).toMatchObject({
      odin_user_log_id: 27_000_001, odin_user_log_nr: 46, odin_user_log_rating: 5, odin_user_log_depth_m: 20,
      odin_user_log_comment: 'from the app', odin_user_log_frd_suit: 'wet',
    });
    expect(r).not.toHaveProperty('updates');
    expect(r).not.toHaveProperty('app_version');
  });

  it('a delete re-sends SSI\'s record marked deleted', () => {
    const remote = { ...createRecord(dive(), ids), odin_user_log_id: 27_000_001 };
    expect(deleteRecord(remote)).toMatchObject({ odin_user_log_id: 27_000_001, odin_user_log_deleted: true, odin_user_log_depth_m: 18.5 });
  });

  it('the fingerprint changes with what is sent, and only with that', () => {
    expect(fingerprint(dive())).toBe(fingerprint(dive()));
    expect(fingerprint(dive({ maxDepthM: 19 }))).not.toBe(fingerprint(dive()));
    expect(fingerprint(dive({ siteSsiId: '9' }))).not.toBe(fingerprint(dive()));
  });
});

describe('read-back', () => {
  const sent = createRecord(dive(), { number: 1, accountId: '1', reference: 'r' });

  it('accepts what SSI does to values: minutes, serials without leading zeros, 0 for nothing', () => {
    const stored = {
      ...sent, odin_user_log_datetime: '2026-01-15 11:00:00', odin_user_log_divecomputer_serial_nr: '34567890',
      odin_user_log_depth_m: '18.5', odin_user_log_avg_depth_m: 12.3,
    };
    expect(compareReadBack(sent, stored)).toEqual([]);
  });

  it('names fields SSI stored differently', () => {
    const stored = { ...sent, odin_user_log_depth_m: 18, odin_user_log_comment: 'other', odin_user_log_depthDataset: '[1.0]' };
    expect(compareReadBack(sent, stored).map((d) => d.field)).toEqual(['maxDepthM', 'notes', 'profile']);
  });

  describe('dive type, tank, lead, surface interval and heart rate', () => {
    const full = createRecord(dive({
      diveMode: 'apnea', cylinder: { volumeL: 12, workingPressureBar: 232, material: 'steel', startPressureBar: 200, endPressureBar: 50, gas: null },
      leadKg: 6, surfaceIntervalSeconds: 5400, avgHeartRate: 82,
    }), { number: 1, accountId: '1', reference: 'r' });
    const fields = (stored: Record<string, unknown>) => compareReadBack(full, { ...full, ...stored }).map((d) => d.field);

    it('names a dive type, tank, lead, surface interval or heart rate SSI stored differently', () => {
      expect(fields({ odin_user_log_dive_type: 0 })).toEqual(['diveType']);
      expect(fields({ odin_user_log_tank_vol_l: 15 })).toEqual(['tankVolumeL']);
      expect(fields({ odin_user_log_pressure_start_bar: 180 })).toEqual(['startPressureBar']);
      expect(fields({ odin_user_log_pressure_end_bar: 40 })).toEqual(['endPressureBar']);
      expect(fields({ odin_user_log_weight_kg: 8 })).toEqual(['leadKg']);
      expect(fields({ odin_user_log_si_before: 3600 })).toEqual(['surfaceInterval']);
      expect(fields({ odin_user_log_heartRateAvg: 60 })).toEqual(['heartRate']);
    });

    it('accepts a tank volume within 0.06, and a surface interval and heart rate within 1', () => {
      expect(fields({ odin_user_log_tank_vol_l: 12.05, odin_user_log_si_before: 5401, odin_user_log_heartRateAvg: 81 })).toEqual([]);
    });
  });
});

describe('values both sides keep', () => {
  const ids = { number: 1, accountId: '1', reference: 'r' };
  const remote = createRecord(dive(), ids);
  const cylinder = (over: Partial<NonNullable<DiveForSsi['cylinder']>> = {}): DiveForSsi['cylinder'] => ({
    volumeL: 12, workingPressureBar: 232, material: 'steel', startPressureBar: 200, endPressureBar: 50, gas: { o2: 32, he: 0 }, ...over,
  });

  it('the dive type from the dive mode and the gases', () => {
    expect(ssiDiveType('apnea', 1)).toBe(6);
    expect(ssiDiveType('ccr', 1)).toBe(8);
    expect(ssiDiveType('scr', 1)).toBe(4);
    expect(ssiDiveType('open_circuit', 2)).toBe(2);
    expect(ssiDiveType('open_circuit', 1)).toBe(0);
    expect(ssiDiveType('gauge', 0)).toBe(0);
    expect(ssiDiveType(null, 0)).toBeNull();
  });

  it('reads SSI\'s dive types back as a dive mode', () => {
    expect([6, 7, 8, 9, 4, 5, 0, 3, 12, 'x'].map(diveModeOfSsi)).toEqual(['apnea', 'apnea', 'ccr', 'ccr', 'scr', 'scr', 'open_circuit', 'open_circuit', null, null]);
  });

  it('an update keeps SSI\'s training variant', () => {
    expect(keepTraining(7, 6)).toBe(7);
    expect(keepTraining(6, 0)).toBe(0);
    expect(keepTraining(3, 2)).toBe(3);
    expect(keepTraining(7, null)).toBeNull();
    expect(updateRecord({ ...remote, odin_user_log_dive_type: 7 }, dive({ diveMode: 'apnea' })).odin_user_log_dive_type).toBe(7);
    expect(updateRecord({ ...remote, odin_user_log_dive_type: 6 }, dive({ diveMode: 'open_circuit' })).odin_user_log_dive_type).toBe(0);
  });

  it('an update keeps SSI\'s extended-range type (2, 3) when ours is 0, not when ours is higher', () => {
    expect(keepTraining(2, 0)).toBe(2);
    expect(updateRecord({ ...remote, odin_user_log_dive_type: 2 }, dive({ diveMode: 'open_circuit', gases: [] })).odin_user_log_dive_type).toBe(2);
    expect(updateRecord({ ...remote, odin_user_log_dive_type: 3 }, dive({ diveMode: 'open_circuit', gases: [] })).odin_user_log_dive_type).toBe(3);
    expect(updateRecord({ ...remote, odin_user_log_dive_type: 2 }, dive({ diveMode: 'apnea' })).odin_user_log_dive_type).toBe(6);
  });

  it('a Dive without a Recording leaves SSI\'s dive type, surface interval and heart rate', () => {
    const bare = dive({ diveMode: null, gases: [] });
    const r = updateRecord({ ...remote, odin_user_log_dive_type: 6, odin_user_log_si_before: 5400, odin_user_log_heartRateAvg: 70 }, bare);
    expect(r).toMatchObject({ odin_user_log_dive_type: 6, odin_user_log_si_before: 5400, odin_user_log_heartRateAvg: 70 });
    expect(createRecord(bare, ids).odin_user_log_dive_type).toBe(0);
  });

  it('the tank of the one Cylinder', () => {
    expect(ownFields(dive({ cylinder: cylinder() }))).toMatchObject({
      odin_user_log_tank_vol_l: 12, odin_user_log_tank_vol_cuft: 97, odin_user_log_pressure_start_bar: 200, odin_user_log_pressure_start_psi: 2901,
      odin_user_log_pressure_end_bar: 50, odin_user_log_pressure_end_psi: 725, odin_user_log_var_tanktype_id: 19,
    });
    expect(ownFields(dive({ cylinder: cylinder({ material: 'aluminium' }) })).odin_user_log_var_tanktype_id).toBe(20);
    expect(ownFields(dive({ cylinder: cylinder({ material: 'carbon' }) })).odin_user_log_var_tanktype_id).toBeNull();
    expect(ownFields(dive({ cylinder: cylinder({ workingPressureBar: null }) })).odin_user_log_tank_vol_cuft).toBeNull();
  });

  it('no tank: SSI\'s tank stays', () => {
    expect(updateRecord({ ...remote, odin_user_log_tank_vol_l: 15 }, dive({ cylinder: null })).odin_user_log_tank_vol_l).toBe(15);
  });

  it('the lead in kg and lb', () => {
    expect(ownFields(dive({ leadKg: 6 }))).toMatchObject({ odin_user_log_weight_kg: 6, odin_user_log_weight_lb: 13.2 });
    expect(ownFields(dive({ leadKg: null }))).toMatchObject({ odin_user_log_weight_kg: null, odin_user_log_weight_lb: null });
  });

  it('the surface interval in seconds, only where the app takes it', () => {
    const si = (seconds: number) => ownFields(dive({ surfaceIntervalSeconds: seconds })).odin_user_log_si_before;
    expect(si(5400)).toBe(5400);
    expect(si(120)).toBeNull();
    expect(si(179)).toBeNull();
    expect(si(180)).toBe(180);
    expect(si(259_200)).toBeNull();
    expect(si(86_400)).toBe(86_400);
  });

  it('heart rate from the summary, else the series', () => {
    const series = { offsetsMs: [0, 1000, 2000], values: [70, 90, 80] };
    expect(ownFields(dive({ avgHeartRate: 82 })).odin_user_log_heartRateAvg).toBe(82);
    const r = ownFields(dive({ avgHeartRate: null, samples: { ...dive().samples, heartRate: series } }));
    expect(r).toMatchObject({ odin_user_log_heartRateAvg: 80, odin_user_log_heartRateMin: 70, odin_user_log_heartRateMax: 90 });
    expect(ownFields(dive()).odin_user_log_heartRateAvg).toBeNull();
  });
});

describe('secret box', () => {
  const key = Buffer.alloc(32, 1);

  it('seals and opens a secret for its purpose, never as plain text', () => {
    const box = createSecretBox(key);
    const sealed = box.seal('ssi-password', 'ssi-password:a');
    expect(sealed).not.toContain('ssi-password');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(box.open(sealed, 'ssi-password:a')).toBe('ssi-password');
  });

  it('refuses a value moved to another row, or opened with another key', () => {
    const sealed = createSecretBox(key).seal('secret', 'ssi-token:a');
    expect(() => createSecretBox(key).open(sealed, 'ssi-token:b')).toThrow();
    expect(() => createSecretBox(Buffer.alloc(32, 2)).open(sealed, 'ssi-token:a')).toThrow();
    expect(() => createSecretBox(undefined).open(sealed, 'ssi-token:a')).toThrow(/DIVEHUB_ENCRYPTION_KEY/);
  });

  it('without a key keeps tokens as they are and says it can\'t keep passwords', () => {
    const box = createSecretBox(undefined);
    expect(box.available).toBe(false);
    expect(box.open(box.seal('token', 'p'), 'p')).toBe('token');
  });

  it('reads the key as 32 bytes of base64', () => {
    expect(parseEncryptionKey(undefined)).toBeUndefined();
    expect(parseEncryptionKey(Buffer.alloc(32, 3).toString('base64'))).toHaveLength(32);
    expect(() => parseEncryptionKey('c2hvcnQ=')).toThrow(/32 bytes/);
  });
});

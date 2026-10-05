// A Dive as SSI's dive record (ADR 0024), and the secrets kept for SSI: pure, no database.
import { describe, expect, it } from 'vitest';
import { createSecretBox, parseEncryptionKey } from '../src/secrets/secret-box.js';
import {
  compareReadBack, createRecord, deleteRecord, fingerprint, localTime, resample, samplesJson, updateRecord, type DiveForSsi,
} from '../src/ssi/ssi-record.js';

const dive = (over: Partial<DiveForSsi> = {}): DiveForSsi => ({
  startsAt: new Date('2026-01-15T09:00:00Z'), utcOffsetSeconds: 7200, durationSeconds: 30 * 60 + 20,
  maxDepthM: 18.46, avgDepthM: 12.3, waterTemperatureC: 24, maxTemperatureC: 26.5, waterType: 'salt', notes: 'Turtle',
  siteSsiId: '3314', entry: { latitude: 27.29, longitude: 33.82 }, exit: null,
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
    expect(json).toBe('[{"n":1,"t":0,"d":0.0,"s":0.0,"te":26.0,"ndl":99,"gs":0.0,"gn":0.0,"a":0,"mf":201326592,"o":false,"dr":false,"rv":3.0}]');
    expect(JSON.parse(json)).toHaveLength(1);
  });

  it('is empty without a depth series', () => {
    expect(resample({}, 600)).toEqual([]);
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
      odin_user_log_ean: 1, odin_user_log_ean_percent: 32, odin_user_log_gf_set: '40 / 85',
      odin_user_log_divecomputer_serial_nr: '0034567890', odin_user_log_divecomputer_manufacturer: 'garmin',
      odin_user_log_divecomputer_name: 'Descent Mk3', odin_user_log_divecomputer_dive_ref: 'divehub-abc',
      odin_user_log_pos_start_latitude: 27.29, odin_user_log_deleted: 0, odin_user_log_confirmed: null,
      odin_user_log_buddy_ids: [], odin_user_log_xr_deco3_ean_o2: null, odin_user_log_ccr_bailout03_end_psi: null,
      odin_user_log_frddisc_VWT_TIME: null,
    });
    expect(JSON.parse(r.odin_user_log_depthDataset as string)).toHaveLength(365);
    expect(typeof r.odin_user_log_diveSamples).toBe('string');
  });

  it("sends the Dive site's water type: fresh and salt by SSI's IDs, nothing for brackish or none (ADR 0025)", () => {
    expect(createRecord(dive({ waterType: 'fresh' }), ids).odin_user_log_var_watertype_id).toBe(4);
    expect(createRecord(dive({ waterType: 'brackish' }), ids).odin_user_log_var_watertype_id).toBeNull();
    expect(createRecord(dive({ waterType: null }), ids).odin_user_log_var_watertype_id).toBeNull();
  });

  it('air is EAN 0 with 0 %', () => {
    expect(createRecord(dive({ gases: [{ o2: 21, he: 0 }] }), ids)).toMatchObject({ odin_user_log_ean: 0, odin_user_log_ean_percent: 0 });
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
    expect(deleteRecord(remote)).toMatchObject({ odin_user_log_id: 27_000_001, odin_user_log_deleted: 1, odin_user_log_depth_m: 18.5 });
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

// SSI's dives as Dive Hub reads them for an import (ADR 0030): evidence (sent by Dive Hub, from a dive computer, typed by
// hand), SSI's zeros as "none", buddy-list entries as SSI accounts, the profile, the site's position from the context.
// Pure: no database, no network.
import { describe, expect, it } from 'vitest';
import type { SsiLogbook } from '../src/providers/ssi/ssi-client.js';
import { contextOf, parseSsiDive } from '../src/providers/ssi/ssi-import.js';
import { computerDive, handTypedDive } from './fake-ssi.js';

const logbook: SsiLogbook = {
  dives: [],
  sites: [{ id: '3314', name: 'Hausreef', latitude: 27.29, longitude: 33.82, country: 'EG' }],
  buddies: [{ id: 3_786_888, name: 'Kai Lund', account: '4989164' }, { id: 1_111, name: 'No Account', account: null }],
};
const context = contextOf(logbook);
const withId = (record: Record<string, unknown>, id = 27_000_001) => ({ ...record, odin_user_log_id: id });

describe('SSI dives for an import', () => {
  it('keeps of the logbook only accounts and sites as the context, no names of people', () => {
    expect(context).toEqual({ people: { 3786888: '4989164' }, sites: { 3314: { name: 'Hausreef', latitude: 27.29, longitude: 33.82 } } });
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

  it('reads the depth and temperature datasets when there are no samples', () => {
    const record = {
      ...handTypedDive({ at: '2025-08-11 14:00', depthM: 3, minutes: 1 }), odin_user_log_divecomputer_serial_nr: '42',
      odin_user_log_divecomputer_manufacturer: 'Mares', odin_user_log_depthDataset: '[0.0,3.0,0.0]', odin_user_log_tempDataset: '[24.0,23.5,24.0]',
    };
    const d = parseSsiDive(withId(record), context)!;
    expect(d.samples.depth).toEqual({ offsetsMs: [0, 5000, 10_000], values: [0, 3, 0] });
    expect(d.samples.temperature!.values).toEqual([24, 23.5, 24]);
  });

  it('skips a record without a start time', () => {
    expect(parseSsiDive(withId({ ...handTypedDive({ at: '', depthM: 3, minutes: 1 }) }), context)).toBeNull();
  });
});

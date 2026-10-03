import { describe, expect, it } from 'vitest';
import { deviceName, manufacturerName } from '../src/lib/devices.ts';

describe('device names', () => {
  it('spell known makers as they do', () => {
    expect(deviceName('garmin', 'Descent Mk3')).toBe('Garmin Descent Mk3');
    expect(manufacturerName('shearwater')).toBe('Shearwater');
  });

  it('make unknown identifiers readable', () => {
    expect(manufacturerName('dive_rite')).toBe('Dive rite');
    expect(deviceName('acme', null)).toBe('Acme');
  });
});

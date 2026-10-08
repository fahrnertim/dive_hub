// Oxygen exposure for a planned dive (ADR 0032, slice 21): the NOAA single-exposure limit, linear between rows
// (NOAA Diving Manual, 4th ed., as printed by Shearwater), and OTU (Hamilton, REPEX). Figures worked by hand.
import { describe, expect, it } from 'vitest';
import { otu, oxygenLimitMinutes } from '../src/planning/oxygen.js';

describe('oxygen limit of one exposure', () => {
  it('is the NOAA table\'s minutes at a listed ppO2', () => {
    expect(oxygenLimitMinutes(1.6)).toBe(45);
    expect(oxygenLimitMinutes(1.4)).toBe(150);
    expect(oxygenLimitMinutes(1.0)).toBe(300);
    expect(oxygenLimitMinutes(0.6)).toBe(720);
  });

  it('is linear between two rows', () => {
    // 1.29 lies 0.9 of the way from 1.2 (210 min) to 1.3 (180 min): 210 − 0.9 × 30 = 183.
    expect(oxygenLimitMinutes(1.29)).toBeCloseTo(183, 5);
    // 1.55 is half way from 1.5 (120) to 1.6 (45): 82.5.
    expect(oxygenLimitMinutes(1.55)).toBeCloseTo(82.5, 5);
  });

  it('is zero above 1.6 and unlimited below 0.6', () => {
    expect(oxygenLimitMinutes(1.61)).toBe(0);
    expect(oxygenLimitMinutes(0.5)).toBe(Infinity);
  });
});

describe('OTU', () => {
  it('is minutes × ((ppO2 − 0.5) / 0.5)^0.83', () => {
    // 1.4: 1.8^0.83 = e^(0.83 × 0.587787) = 1.6288 per minute; 20 minutes = 32.58.
    expect(otu(1.4, 20)).toBeCloseTo(32.58, 1);
  });

  it('is nothing at or below 0.5 bar', () => {
    expect(otu(0.5, 60)).toBe(0);
    expect(otu(0.21, 60)).toBe(0);
  });
});

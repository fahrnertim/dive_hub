// SAC on a Dive (ADR 0045, slice 3; ADR 0033): litres per minute at the surface from the Dive's Cylinders, its
// average depth and its duration. The expected figures are worked by hand in the comments, not taken from the code.
import { describe, expect, it } from 'vitest';
import { sacOfDive } from '../src/dives/sac.js';

const cylinder = (c: { volumeL?: number | null; startPressureBar?: number | null; endPressureBar?: number | null; gas?: { o2: number; he: number } | null }) => ({
  volumeL: 12, startPressureBar: 200, endPressureBar: 50, gas: null, ...c,
});
/** 40 minutes at an average of 10 m: 80 minutes at the surface's pressure. */
const dive = { durationSeconds: 40 * 60, avgDepthM: 10 };

// Compressibility factors at 20 °C from NIST's isotherms (Z = p / (density · R · T), docs/research note on real gas):
//           51 bar   101 bar  201 bar  301 bar
// oxygen    0.9681   0.9461   0.9393   0.9808
// nitrogen  0.9940   1.0011   1.0525   1.1410
// helium    1.0247   1.0486   1.0956   1.1418
// A mix is the sum by its fractions: air (21/79) 0.9886 at 51 bar, 0.9896 at 101, 1.0287 at 201, 1.1074 at 301.

describe('SAC on a Dive', () => {
  describe('from one Cylinder', () => {
    it('is the litres used at the surface per minute, with real gas, and the pressure drop per minute beside it', () => {
      // 12 L of air from 201 to 51 bar: 12 × (201 / 1.0287 − 51 / 0.9886) = 12 × (195.39 − 51.59) = 1725.6 L,
      // over 80 minutes at the surface's pressure = 21.57 L/min (an ideal gas would say 22.5). 150 bar / 80 = 1.875, to two places.
      const { sac, missing } = sacOfDive(dive, [cylinder({ startPressureBar: 201, endPressureBar: 51 })]);
      expect(missing).toBeNull();
      expect(sac!.litresPerMinute).toBeCloseTo(21.57, 1);
      expect(sac!.barPerMinute).toBe(1.88);
    });

    it('counts a 300 bar fill for what it holds, about a tenth less than an ideal gas', () => {
      // 12 L of air from 301 to 101 bar: 12 × (301 / 1.1074 − 101 / 0.9896) = 12 × (271.82 − 102.07) = 2037.0 L,
      // over 80 minutes = 25.46 L/min (an ideal gas would say 30).
      expect(sacOfDive(dive, [cylinder({ startPressureBar: 301, endPressureBar: 101 })]).sac!.litresPerMinute).toBeCloseTo(25.46, 1);
    });

    it('counts helium in the gas', () => {
      // 12 L of trimix 21/35 (44 % nitrogen): Z = 1.0438 at 201 bar and 0.9993 at 51 bar.
      // 12 × (201 / 1.0438 − 51 / 0.9993) = 12 × (192.56 − 51.04) = 1698.3 L, over 80 minutes = 21.23 L/min.
      const trimix = cylinder({ startPressureBar: 201, endPressureBar: 51, gas: { o2: 21, he: 35 } });
      expect(sacOfDive(dive, [trimix]).sac!.litresPerMinute).toBeCloseTo(21.23, 1);
    });

    it('follows the average depth and the duration', () => {
      // The same 1725.6 L over 30 minutes at an average of 20 m: 90 minutes at the surface's pressure = 19.17 L/min.
      const deeper = sacOfDive({ durationSeconds: 30 * 60, avgDepthM: 20 }, [cylinder({ startPressureBar: 201, endPressureBar: 51 })]);
      expect(deeper.sac!.litresPerMinute).toBeCloseTo(19.17, 1);
    });

    it('a Dive of exactly 15 minutes has one', () => {
      expect(sacOfDive({ durationSeconds: 15 * 60, avgDepthM: 10 }, [cylinder({})]).sac).not.toBeNull();
    });
  });

  describe('from several Cylinders', () => {
    const back = cylinder({ startPressureBar: 201, endPressureBar: 51 });

    it('sums the litres over Cylinders of different size and gas, and gives no pressure drop', () => {
      // The 12 L of air above: 1725.6 L. A 7 L stage of EAN50 from 201 to 101 bar, Z = 0.9959 and 0.9736:
      // 7 × (201 / 0.9959 − 101 / 0.9736) = 7 × (201.83 − 103.74) = 686.6 L. Together 2412.2 L over 80 minutes = 30.15 L/min.
      const stage = cylinder({ volumeL: 7, startPressureBar: 201, endPressureBar: 101, gas: { o2: 50, he: 0 } });
      const { sac } = sacOfDive(dive, [back, stage]);
      expect(sac!.litresPerMinute).toBeCloseTo(30.15, 1);
      expect(sac!.barPerMinute).toBeNull();
    });

    it('a Cylinder that came back as full as it went in adds nothing', () => {
      const untouched = cylinder({ volumeL: 7, startPressureBar: 200, endPressureBar: 200 });
      expect(sacOfDive(dive, [back, untouched]).sac!.litresPerMinute).toBeCloseTo(21.57, 1);
    });
  });

  describe('when there is none', () => {
    it('a Dive without Cylinders has no SAC and nothing is missing', () => {
      expect(sacOfDive(dive, [])).toEqual({ sac: null, missing: null });
    });

    it('a Dive shorter than 15 minutes has none: too short to say', () => {
      expect(sacOfDive({ durationSeconds: 14 * 60 + 59, avgDepthM: 10 }, [cylinder({})])).toEqual({ sac: null, missing: 'too_short' });
    });

    it('a Dive without an average depth has none', () => {
      expect(sacOfDive({ durationSeconds: 40 * 60, avgDepthM: null }, [cylinder({})])).toEqual({ sac: null, missing: 'no_average_depth' });
    });

    it.each([
      ['its start pressure', { startPressureBar: null }],
      ['its end pressure', { endPressureBar: null }],
      ['its volume', { volumeL: null }],
    ])('a Dive has none when one of its Cylinders lacks %s', (_what, lacking) => {
      expect(sacOfDive(dive, [cylinder({}), cylinder(lacking)])).toEqual({ sac: null, missing: 'cylinder_incomplete' });
    });
  });
});

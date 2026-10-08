// A Dive's Cylinders in its form (ADR 0045): typed in the User's pressure unit, filled from the catalogue or from the last dive.
import { describe, expect, it } from 'vitest';
import { cylindersOfDrafts, draftOfCylinder, emptyDraft, fromCatalogue, fromLastDive, type CylinderView } from '../src/lib/cylinders.ts';

const NaN_ = Number.NaN;
const steel12: CylinderView = {
  volumeL: 12, workingPressureBar: 232, material: 'steel', gas: { o2: 32, he: 0 }, startPressureBar: 205, endPressureBar: 60,
  fromPod: false, series: null,
};

describe('a Cylinder in the Dive\'s form', () => {
  it('shows pressures in bar, and an unknown value as an empty field', () => {
    expect(draftOfCylinder(steel12, 'metric')).toMatchObject({ volumeL: 12, workingPressure: 232, material: 'steel', o2: 32, he: 0, startPressure: 205, endPressure: 60, series: null });
    expect(draftOfCylinder({ ...steel12, volumeL: null, gas: null, endPressureBar: null }, 'metric')).toMatchObject({ volumeL: NaN_, o2: NaN_, he: NaN_, endPressure: NaN_ });
  });

  it('shows pressures in whole psi for imperial, and saves what was typed in bar', () => {
    const draft = draftOfCylinder(steel12, 'imperial');
    expect(draft).toMatchObject({ workingPressure: 3365, startPressure: 2973, endPressure: 870 });
    const [saved] = cylindersOfDrafts([{ ...draft, endPressure: 725 }], 'imperial');
    expect(saved!.endPressureBar).toBeCloseTo(49.99, 2);
  });

  it('saves a value nobody touched as it was, whatever the unit rounds it to', () => {
    const pod = { ...steel12, startPressureBar: 200.4, endPressureBar: 50.1, fromPod: true, series: { recordingId: 'r1', channel: 'tankPressure' } };
    for (const units of ['metric', 'imperial'] as const) {
      expect(cylindersOfDrafts([draftOfCylinder(pod, units)], units)).toEqual([{
        volumeL: 12, workingPressureBar: 232, material: 'steel', gas: { o2: 32, he: 0 }, startPressureBar: 200.4, endPressureBar: 50.1,
        series: { recordingId: 'r1', channel: 'tankPressure' },
      }]);
    }
  });

  it('saves empty fields as unknown; a gas needs its oxygen, helium counts as none when left empty', () => {
    expect(cylindersOfDrafts([emptyDraft()], 'metric')).toEqual([{
      volumeL: null, workingPressureBar: null, material: null, gas: null, startPressureBar: null, endPressureBar: null, series: null,
    }]);
    expect(cylindersOfDrafts([{ ...emptyDraft(), o2: 21 }], 'metric')[0]!.gas).toEqual({ o2: 21, he: 0 });
    expect(cylindersOfDrafts([{ ...emptyDraft(), he: 35 }], 'metric')[0]!.gas).toBeNull();
  });

  it('picking from the catalogue fills volume, working pressure and material, and leaves the rest', () => {
    const al80 = { id: 'al80', tradeName: 'AL80', twin: false, volumeL: 11.1, workingPressureBar: 207, material: 'aluminium' as const };
    const draft = draftOfCylinder(steel12, 'metric');
    expect(fromCatalogue(draft, al80, 'metric')).toMatchObject({ volumeL: 11.1, workingPressure: 207, material: 'aluminium', o2: 32, startPressure: 205, endPressure: 60 });
    expect(fromCatalogue(draft, al80, 'imperial').workingPressure).toBe(3002);
  });

  it('"same as last dive" gives the last dive\'s Cylinders with empty pressures and no series', () => {
    const last = [{ volumeL: 12, workingPressureBar: 232, material: 'steel' as const, gas: { o2: 32, he: 0 } }];
    expect(fromLastDive(last, 'metric')).toMatchObject([{ volumeL: 12, workingPressure: 232, material: 'steel', o2: 32, he: 0, startPressure: NaN_, endPressure: NaN_, series: null }]);
  });
});

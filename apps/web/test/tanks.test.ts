// A Recording's tank pod pressures as tanks (ADR 0045).
import { describe, expect, it } from 'vitest';
import { tanksOf } from '../src/lib/tanks.ts';

const readings = { channel: 'tankPressure', offsetsMs: [500, 600_500, 1_200_500, 1_800_500], values: [199.96, 150, 100, 50] };

describe('tanks of a Recording', () => {
  it('is the pod\'s series with the gas it belongs to, the computer\'s own start and end, and what was used', () => {
    const depth = { channel: 'depth', offsetsMs: [500], values: [1.3] };
    expect(tanksOf([depth, readings], [{ o2: 32, he: 0, tankVolumeL: 12, startPressureBar: 200.4, endPressureBar: 50.1 }])).toEqual([
      { channel: 'tankPressure', gas: { o2: 32, he: 0 }, volumeL: 12, startBar: 200.4, endBar: 50.1, usedBar: 150.3, series: readings },
    ]);
  });

  it('gives each further pod its own tank, matched to the gases that carry pressures, in order', () => {
    const stage = { channel: 'tankPressure:3', offsetsMs: [900_500, 1_800_500], values: [205.2, 120.4] };
    const gases = [
      { o2: 21, he: 0, tankVolumeL: 12, startPressureBar: 200.4, endPressureBar: 50.1 },
      { o2: 32, he: 0 }, // set on the computer, no pod
      { o2: 50, he: 0, tankVolumeL: 7, startPressureBar: 205 }, // only a start: the last reading is the end
    ];
    const tanks = tanksOf([stage, readings], gases);
    expect(tanks.map((t) => [t.channel, t.gas?.o2, t.volumeL, t.startBar, t.endBar, t.usedBar])).toEqual([
      ['tankPressure', 21, 12, 200.4, 50.1, 150.3],
      ['tankPressure:3', 50, 7, 205, 120.4, 84.6],
    ]);
  });

  it('speaks of the Cylinder its series is tied to: its gas, its size and the pressures logged on it', () => {
    const gases = [{ o2: 32, he: 0, tankVolumeL: 12, startPressureBar: 200.4, endPressureBar: 50.1 }];
    const tied = { channel: 'tankPressure', gas: { o2: 36, he: 0 }, volumeL: 15, startPressureBar: 210, endPressureBar: null };
    expect(tanksOf([readings], gases, [tied])).toEqual([
      { channel: 'tankPressure', gas: { o2: 36, he: 0 }, volumeL: 15, startBar: 210, endBar: 50.1, usedBar: 159.9, series: readings },
    ]);
    // A Cylinder that says nothing of its gas or size leaves the computer's; one tied to another series changes nothing.
    const bare = { channel: 'tankPressure', gas: null, volumeL: null, startPressureBar: null, endPressureBar: null };
    expect(tanksOf([readings], gases, [bare])).toEqual(tanksOf([readings], gases));
    expect(tanksOf([readings], gases, [{ ...tied, channel: 'tankPressure:2' }])).toEqual(tanksOf([readings], gases));
  });

  it('is a tank without a gas when the summary names none, and nothing without readings', () => {
    expect(tanksOf([readings])).toEqual([{ channel: 'tankPressure', startBar: 199.96, endBar: 50, usedBar: 150, series: readings }]);
    expect(tanksOf([{ channel: 'tankPressure', offsetsMs: [], values: [] }, { channel: 'tankPressureLow', offsetsMs: [0], values: [1] }])).toEqual([]);
  });
});

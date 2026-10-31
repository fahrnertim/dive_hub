// The owner's dive 85/86 as two synthetic FITs from one Device (ADR 0063): a dive cut in two by a surface break of
// 241 s. The shapes follow the real files; nothing personal is in them.
import { makeSyntheticDive } from './synthetic-dive.js';

const SERIAL_NUMBER = 3_400_085;

/** Linear between the given (second, metre) points. */
function through(points: [number, number][]): (t: number) => number {
  return (t) => {
    for (let i = 1; i < points.length; i++) {
      const [t0, d0] = points[i - 1]!;
      const [t1, d1] = points[i]!;
      if (t <= t1) return d0 + ((d1 - d0) * (t - t0)) / (t1 - t0);
    }
    return points.at(-1)![1];
  };
}

/** `diveNumber`: another file of the same dives (a re-export): other bytes, the same keys and samples. */
export function ownersDiveParts(diveNumber?: number): { first: Uint8Array; second: Uint8Array } {
  const firstDepth = through([[0, 0], [120, 7.1], [900, 6.5], [1120, 0]]);
  const first = makeSyntheticDive({
    serialNumber: SERIAL_NUMBER, start: new Date('2026-10-26T06:05:49Z'), durationSeconds: 1180, ...(diveNumber !== undefined && { diveNumber }),
    depthAt: (t) => (t <= 1120 ? firstDepth(t) : (Math.floor(t / 10) % 2) * 0.3),
  });
  const second = makeSyntheticDive({
    serialNumber: SERIAL_NUMBER, start: new Date('2026-10-26T06:29:30Z'), durationSeconds: 1530, ...(diveNumber !== undefined && { diveNumber }),
    depthAt: through([[0, 1.9], [100, 7.9], [1200, 7.0], [1530, 0]]),
  });
  return { first, second };
}

// The tanks a Recording's tank pods measured (ADR 0045): one per pressure series, with the gas it belongs to.
// Pressures in bar, volumes in litres; the page formats them.
import type { Series } from './profile.ts';

export interface ChannelSeries extends Series { channel: string }

export interface RecordedGas { o2: number; he: number; tankVolumeL?: number; startPressureBar?: number; endPressureBar?: number }

/** A Cylinder of the Dive tied to one of this Recording's pressure series (ADR 0045, slice 2). */
export interface TiedCylinder {
  channel: string;
  gas: { o2: number; he: number } | null;
  volumeL: number | null;
  startPressureBar: number | null;
  endPressureBar: number | null;
}

export interface Tank {
  /** The channel of its pressure series: `tankPressure`, further pods `tankPressure:<n>`. */
  channel: string;
  gas?: { o2: number; he: number };
  volumeL?: number;
  startBar: number;
  endBar: number;
  usedBar: number;
  series: ChannelSeries;
}

const PRESSURE = /^tankPressure(?::(\d+))?$/;
const round = (bar: number) => Math.round(bar * 10) / 10;

/**
 * The first series is `tankPressure`, whatever its gas's number, so a series can't name its gas: the series in their
 * order belong to the gases that carry pressures, in theirs. Start and end are the computer's own where it gives them,
 * else the first and last reading. A series tied to a Cylinder speaks of the Cylinder: its gas, its size and the
 * pressures logged on it, where it has them.
 */
export function tanksOf(series: ChannelSeries[], gases: RecordedGas[] = [], cylinders: TiedCylinder[] = []): Tank[] {
  const order = (s: ChannelSeries) => Number(PRESSURE.exec(s.channel)?.[1] ?? 0);
  const withPod = gases.filter((g) => g.startPressureBar !== undefined || g.endPressureBar !== undefined);
  return series
    .filter((s) => PRESSURE.test(s.channel) && s.values.length > 0)
    .sort((a, b) => order(a) - order(b))
    .map((s, i) => {
      const recorded = withPod[i];
      const cylinder = cylinders.find((c) => c.channel === s.channel);
      const gas = cylinder?.gas ?? recorded;
      const volumeL = cylinder?.volumeL ?? recorded?.tankVolumeL;
      const startBar = cylinder?.startPressureBar ?? recorded?.startPressureBar ?? s.values[0]!;
      const endBar = cylinder?.endPressureBar ?? recorded?.endPressureBar ?? s.values.at(-1)!;
      return {
        channel: s.channel,
        ...(gas && { gas: { o2: gas.o2, he: gas.he } }),
        ...(volumeL !== undefined && { volumeL }),
        startBar, endBar, usedBar: round(startBar - endBar), series: s,
      };
    });
}

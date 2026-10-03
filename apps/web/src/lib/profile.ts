// The depth profile as text (UI review B6): a summary for screen readers, and the samples per
// minute as a table. Values in SI units (m, °C); the page formats them.

export interface Series {
  offsetsMs: number[];
  values: number[];
}

/** Deepest point and when, total time, and the temperature range (if recorded). */
export function summarize(depth: Series, temperature?: Series) {
  let deepest = 0;
  for (let i = 1; i < depth.values.length; i++) if (depth.values[i]! > depth.values[deepest]!) deepest = i;
  const temps = temperature?.values ?? [];
  return {
    maxDepthM: depth.values[deepest] ?? 0,
    maxDepthAtSeconds: (depth.offsetsMs[deepest] ?? 0) / 1000,
    durationSeconds: (depth.offsetsMs.at(-1) ?? 0) / 1000,
    minTemperatureC: temps.length ? Math.min(...temps) : null,
    maxTemperatureC: temps.length ? Math.max(...temps) : null,
  };
}

/** One row per whole minute: the sample nearest to it (depth, and temperature when recorded). */
export function perMinute(depth: Series, temperature?: Series) {
  const nearest = (s: Series | undefined, ms: number) => {
    if (!s || s.offsetsMs.length === 0) return null;
    let best = 0;
    for (let i = 1; i < s.offsetsMs.length; i++) {
      if (Math.abs(s.offsetsMs[i]! - ms) < Math.abs(s.offsetsMs[best]! - ms)) best = i;
    }
    return s.values[best] ?? null;
  };
  const minutes = Math.floor((depth.offsetsMs.at(-1) ?? 0) / 60_000);
  return Array.from({ length: minutes + 1 }, (_, minute) => ({
    minute,
    depthM: nearest(depth, minute * 60_000) ?? 0,
    temperatureC: nearest(temperature, minute * 60_000),
  }));
}

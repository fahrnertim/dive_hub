// The profile sketch of a logbook row (ADR 0041, UI redesign 3.1): the reduced depth profile as SVG paths. Every row
// is drawn on the same depth scale, so a 40 m dive looks deeper than a 12 m one.

export const SKETCH_WIDTH = 112;
export const SKETCH_HEIGHT = 40;
/** The scale never gets shorter than this, so a logbook of shallow dives isn't stretched to look deep. */
const MIN_SCALE_M = 10;
/** Room for the stroke at the bottom of the box. */
const FLOOR = 2;

interface Profile {
  depthsM: number[];
  spanSeconds: number;
  /** [start s, end s, band 1–3] */
  ascentBands: readonly (readonly number[])[];
}

/** The metres the box's height stands for: the logbook's deepest dive. */
export const sketchScale = (deepestM: number | null) => Math.max(deepestM ?? 0, MIN_SCALE_M);

const round = (n: number) => Math.round(n * 10) / 10;

/** The outline of the dive and the stretches of fast ascent, as paths in a SKETCH_WIDTH × SKETCH_HEIGHT box. */
export function sketchPaths(profile: Profile, scaleM: number) {
  const { depthsM, spanSeconds } = profile;
  const last = depthsM.length - 1;
  if (last < 1) return { area: '', line: '', bands: [] };
  const x = (i: number) => (i / last) * SKETCH_WIDTH;
  const y = (depth: number) => Math.min(SKETCH_HEIGHT - FLOOR, (depth / scaleM) * (SKETCH_HEIGHT - FLOOR));
  const point = (px: number, py: number) => `${round(px)} ${round(py)}`;

  const line = depthsM.map((d, i) => `${i === 0 ? 'M' : 'L'}${point(x(i), y(d))}`).join('');
  const area = `${line}L${point(SKETCH_WIDTH, 0)}L${point(0, 0)}Z`;

  // A band is drawn over the outline between its two times; the ends are interpolated, since a short stretch of
  // ascent can fall between two points.
  const at = (seconds: number) => {
    const position = Math.min(last, Math.max(0, spanSeconds > 0 ? (seconds / spanSeconds) * last : 0));
    const i = Math.min(last - 1, Math.floor(position));
    const depth = depthsM[i]! + (depthsM[i + 1]! - depthsM[i]!) * (position - i);
    return { position, depth };
  };
  const bands = profile.ascentBands.map(([from = 0, to = 0, band = 1]) => {
    const start = at(from);
    const end = at(to);
    const inside = depthsM.flatMap((d, i) => (i > start.position && i < end.position ? [`L${point(x(i), y(d))}`] : []));
    return { band, d: `M${point(x(start.position), y(start.depth))}${inside.join('')}L${point(x(end.position), y(end.depth))}` };
  });
  return { area, line, bands };
}

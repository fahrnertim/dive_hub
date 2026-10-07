import { useId } from 'react';
import type { DiveSummary } from './api.ts';
import { SKETCH_HEIGHT, SKETCH_WIDTH, sketchPaths } from './lib/sketch.ts';

/**
 * The shape of a dive in a logbook row (UI redesign 3.1): the water above the profile in the depth gradient, the fast
 * parts of the ascent over it in their colour and thicker. Decoration: depth and time are text beside it. A Dive without a
 * Recording is an empty dashed box (its row says "No recording"), and one whose sketch isn't there yet is an empty slot.
 */
export function ProfileSketch({ profile, hasRecording, scaleM }: { profile: DiveSummary['profile']; hasRecording: boolean; scaleM: number }) {
  const gradient = useId();
  if (!profile) return <span className={hasRecording ? 'sketch' : 'sketch sketch-empty'} aria-hidden="true" />;
  const { area, line, bands } = sketchPaths(profile, scaleM);
  return (
    <svg className="sketch" viewBox={`0 0 ${SKETCH_WIDTH} ${SKETCH_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        {/* One gradient for the whole box: the same depth is the same colour in every row. */}
        <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={SKETCH_HEIGHT}>
          <stop offset="0" className="sketch-shallow" />
          <stop offset="1" className="sketch-deep" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradient})`} />
      <path d={line} className="sketch-line" vectorEffect="non-scaling-stroke" />
      {bands.map((b, i) => <path key={i} d={b.d} className="sketch-ascent" data-band={b.band} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

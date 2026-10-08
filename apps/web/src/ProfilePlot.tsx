import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useDisplay } from './lib/display.ts';
import { depthIn, pressureIn, temperatureIn } from './lib/units.ts';

// The two plots of a dive, recorded or planned: depth over time and, under it on the same time axis, pressure over time.
// A Recording's profile (DepthProfile.tsx) and a gas plan's (ToolsPlan.tsx) draw with them, so a planned dive looks like a dived one.

export const token = (el: Element, name: string, fallback: string) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

/** A token's colour with an alpha (two hex digits), whatever notation the token uses. */
export function withAlpha(color: string, alpha: string) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return color;
  ctx.fillStyle = color; // the canvas normalizes an opaque colour to #rrggbb
  return /^#[0-9a-f]{6}$/i.test(ctx.fillStyle) ? `${ctx.fillStyle}${alpha}` : color;
}

/** Light or dark, following the system as the tokens do; the chart redraws when it changes. */
function useColorScheme() {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const onChange = () => setDark(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/** The right-hand axis of the depth profile (temperature); the pressure strip keeps the same space free, so both plots span the same width. */
export const RIGHT_AXIS = 64;

/** How the lines of a pressure strip differ, in their order: by their dashes, never by colour alone. A fifth starts over. */
const LINE_DASHES: number[][] = [[], [8, 4], [2, 4], [10, 4, 2, 4]];

/** Canvas fonts need px; the tokens are in rem. */
function plotFont(el: Element) {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return `${Math.round(parseFloat(token(el, '--text-sm', '0.833rem')) * rem)}px ${token(el, '--font-sans', 'sans-serif')}`;
}

/**
 * Depth over time (depth axis pointing down), drawn with uPlot. The area under the profile darkens with depth, like the
 * water column (docs/spec/design-system.md). With `temperaturesC` (one per point, or null) the water temperature has an
 * axis of its own on the right; without, `rightSpace` stays free there. `draw` paints over the profile, and `plotRef` lets
 * the caller redraw. The arrays are compared by identity: keep them the same between renders.
 */
export function DepthPlot({ minutes, depthsM, temperaturesC, syncKey, draw, plotRef, onBox, label, describedBy, rightSpace = RIGHT_AXIS }: {
  minutes: number[]; depthsM: number[]; temperaturesC?: (number | null)[] | undefined;
  /** The pointer's moment shows in every plot with this key. */
  syncKey: string;
  draw?: ((u: uPlot) => void) | undefined;
  plotRef?: MutableRefObject<uPlot | null> | undefined;
  /** Where the plot area sits in the figure, in CSS pixels. */
  onBox?: ((box: { left: number; width: number }) => void) | undefined;
  label: string; describedBy?: string | undefined; rightSpace?: number | undefined;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const container = useRef<HTMLDivElement>(null);
  const dark = useColorScheme();
  const { units, locale } = display;
  const depthUnit = display.unit('depth');
  const temperatureUnit = display.unit('temperature');

  useEffect(() => {
    const el = container.current;
    if (!el || minutes.length === 0) return;
    const data: uPlot.AlignedData = [
      minutes,
      depthsM.map((v) => -depthIn(v, units)),
      ...(temperaturesC ? [temperaturesC.map((c) => (c === null ? null : temperatureIn(c, units)))] : []),
    ];
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const text = token(el, '--color-text', '#0b2236');
    const muted = token(el, '--color-text-muted', '#4e6578');
    const grid = token(el, '--color-border', '#d5dfe6');
    const line = token(el, '--color-accent', '#0f5e8c');
    const shallow = token(el, '--color-depth-shallow', '#8fd3e8');
    const deep = token(el, '--color-depth-deep', '#0f5e8c');
    const font = plotFont(el);

    /** Fill from the surface (top of the plot) down to the deepest point, light to dark. */
    const depthFill = (u: uPlot) => {
      // uPlot may ask before it has laid out the plot area.
      if (!Number.isFinite(u.bbox?.top) || !Number.isFinite(u.bbox?.height)) return withAlpha(deep, '55');
      const gradient = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
      gradient.addColorStop(0, withAlpha(shallow, '33'));
      gradient.addColorStop(1, withAlpha(deep, 'cc'));
      return gradient;
    };
    const measure = (u: uPlot) => {
      const ratio = devicePixelRatio || 1;
      onBox?.({ left: u.bbox.left / ratio, width: u.bbox.width / ratio });
    };

    const axis = { stroke: text, font, labelFont: font, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid } };
    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: 320,
        ...(!temperaturesC && { padding: [8, rightSpace, 0, 0] as uPlot.Padding }),
        scales: { x: { time: false }, ...(temperaturesC && { temp: { auto: true } }) },
        cursor: { sync: { key: syncKey } },
        hooks: { ...(draw && { draw: [draw] }), ready: [measure], setSize: [measure] },
        axes: [
          { ...axis, label: t('dive.minutes'), values: (_u, ticks) => ticks.map((v) => number.format(v)) },
          { ...axis, label: `${t('dive.depth')} (${depthUnit})`, values: (_u, ticks) => ticks.map((v) => number.format(Math.abs(v))) },
          // The unit sits in each tick ("25 °C"); a rotated "°C" axis title was hard to read (visual refresh 10).
          ...(temperaturesC ? [{
            ...axis, scale: 'temp', side: 1 as const, stroke: muted, size: RIGHT_AXIS, grid: { show: false },
            values: (_u: uPlot, ticks: number[]) => ticks.map((v) => `${number.format(v)} ${temperatureUnit}`),
          }] : []),
        ],
        series: [
          { label: t('dive.time'), value: (_u, v) => (v == null ? '–' : display.duration(v * 60)) },
          {
            label: t('dive.depth'), stroke: line, fill: depthFill, width: 2,
            value: (_u, v) => (v == null ? '–' : `${number.format(Math.abs(v))} ${depthUnit}`),
          },
          ...(temperaturesC ? [{
            label: t('dive.temperature'), scale: 'temp', stroke: muted, width: 1.5, dash: [6, 4],
            value: (_u: uPlot, v: number | null) => (v == null ? '–' : `${number.format(v)} ${temperatureUnit}`),
          }] : []),
        ],
      },
      data,
      el,
    );
    if (plotRef) plotRef.current = plot;
    const resize = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: 320 }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      if (plotRef) plotRef.current = null;
      plot.destroy();
    };
  // display.duration is recreated each render; units and locale capture what it depends on. onBox and plotRef are the caller's own.
  }, [minutes, depthsM, temperaturesC, syncKey, draw, rightSpace, units, locale, depthUnit, temperatureUnit, t, dark]);

  return <div ref={container} className="profile" role="img" aria-label={label} aria-describedby={describedBy} />;
}

/**
 * Pressure over time, one line per cylinder, in a strip of its own under the depth profile and on its time axis
 * (ADR 0045): a third scale in the profile would be hard to read. `range` is the profile's time span in minutes.
 * `series` is compared by identity: keep it the same between renders.
 */
export function PressureStrip({ series, labels, range, syncKey, describedBy, title, axisTitle = title, rightSpace = RIGHT_AXIS }: {
  /** Each line's moments in minutes and its pressures in bar. */
  series: { minutes: number[]; bar: number[] }[];
  labels: string[]; range: [number, number]; syncKey: string; describedBy: string; title: string;
  /** The axis has room for a word or two; the title when left out. */
  axisTitle?: string | undefined; rightSpace?: number | undefined;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const container = useRef<HTMLDivElement>(null);
  const dark = useColorScheme();
  const { units, locale } = display;
  const unit = display.unit('pressure');
  const [from, to] = range;
  // One string, so the chart is rebuilt when a name changes and not on every render.
  const names = labels.join('\n');

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // One time axis for all lines: every reading's moment, and each line's value where it has one.
    const moments = [...new Set(series.flatMap((k) => k.minutes))].sort((a, b) => a - b);
    const data: uPlot.AlignedData = [
      moments,
      ...series.map((k) => {
        const at = new Map(k.minutes.map((m, i) => [m, k.bar[i]!]));
        return moments.map((m) => {
          const bar = at.get(m);
          return bar === undefined ? null : pressureIn(bar, units);
        });
      }),
    ];
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const text = token(el, '--color-text', '#0b2236');
    const grid = token(el, '--color-border', '#d5dfe6');
    const line = token(el, '--color-accent', '#0f5e8c');
    const font = plotFont(el);
    const axis = { stroke: text, font, labelFont: font, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid } };
    const lineLabels = names.split('\n');
    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: 160,
        padding: [8, rightSpace, 0, 0],
        // From empty: how much is left reads off the line's height.
        scales: { x: { time: false, range: [from, to] }, y: { range: (_u, _min, max) => [0, (max || 1) * 1.05] } },
        cursor: { sync: { key: syncKey } },
        axes: [
          { ...axis, values: (_u, ticks) => ticks.map((v) => number.format(v)) },
          { ...axis, label: `${axisTitle} (${unit})`, values: (_u, ticks) => ticks.map((v) => number.format(v)) },
        ],
        series: [
          { label: t('dive.time'), value: (_u, v) => (v == null ? '–' : display.duration(v * 60)) },
          ...series.map((_k, i) => ({
            label: series.length === 1 ? title : lineLabels[i]!, stroke: line, width: 2, dash: LINE_DASHES[i % LINE_DASHES.length]!, spanGaps: true,
            value: (_u: uPlot, v: number | null) => (v == null ? '–' : `${number.format(v)} ${unit}`),
          })),
        ],
      },
      data,
      el,
    );
    const resize = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: 160 }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      plot.destroy();
    };
  // display.duration is recreated each render; units and locale capture what it depends on.
  }, [series, names, from, to, syncKey, rightSpace, units, locale, unit, title, axisTitle, t, dark]);

  return <div ref={container} className="profile profile-tanks" role="img" aria-label={title} aria-describedby={describedBy} />;
}

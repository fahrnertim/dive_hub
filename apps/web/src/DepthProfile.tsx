import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { samplesQuery } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { depthIn, temperatureIn } from './lib/units.ts';
import { Notice } from './ui/index.ts';

const token = (el: Element, name: string, fallback: string) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

/**
 * Depth over time (depth axis pointing down) with water temperature, drawn with uPlot. The area under
 * the profile darkens with depth, like the water column (docs/spec/design-system.md).
 */
export function DepthProfile({ recordingId }: { recordingId: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const samples = useQuery(samplesQuery(recordingId));
  const container = useRef<HTMLDivElement>(null);
  const { units, locale } = display;
  const depthUnit = display.unit('depth');
  const temperatureUnit = display.unit('temperature');

  useEffect(() => {
    const el = container.current;
    const depth = samples.data?.series.find((s) => s.channel === 'depth');
    if (!el || !depth) return;
    const temperature = samples.data!.series.find((s) => s.channel === 'temperature');

    // Align temperature to the depth time axis (both come from the same records).
    const tempByOffset = new Map(temperature?.offsetsMs.map((o, i) => [o, temperature.values[i]!]));
    const data: uPlot.AlignedData = [
      depth.offsetsMs.map((o) => o / 60_000),
      depth.values.map((v) => -depthIn(v, units)),
      depth.offsetsMs.map((o) => {
        const c = tempByOffset.get(o);
        return c === undefined ? null : temperatureIn(c, units);
      }),
    ];
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const text = token(el, '--color-text', '#0b2236');
    const muted = token(el, '--color-text-muted', '#4e6578');
    const grid = token(el, '--color-border', '#d5dfe6');
    const line = token(el, '--color-accent', '#0f5e8c');
    const shallow = token(el, '--color-depth-shallow', '#8fd3e8');
    const deep = token(el, '--color-depth-deep', '#0f5e8c');
    // Canvas fonts need px; the tokens are in rem.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const font = `${Math.round(parseFloat(token(el, '--text-sm', '0.833rem')) * rem)}px ${token(el, '--font-sans', 'sans-serif')}`;

    /** Fill from the surface (top of the plot) down to the deepest point, light to dark. */
    const depthFill = (u: uPlot) => {
      // uPlot may ask before it has laid out the plot area.
      if (!Number.isFinite(u.bbox?.top) || !Number.isFinite(u.bbox?.height)) return `${deep}55`;
      const gradient = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
      gradient.addColorStop(0, `${shallow}33`);
      gradient.addColorStop(1, `${deep}cc`);
      return gradient;
    };

    const axis = { stroke: text, font, labelFont: font, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid } };
    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: 320,
        scales: { x: { time: false }, temp: { auto: true } },
        axes: [
          { ...axis, label: t('dive.minutes'), values: (_u, ticks) => ticks.map((v) => number.format(v)) },
          { ...axis, label: `${t('dive.depth')} (${depthUnit})`, values: (_u, ticks) => ticks.map((v) => number.format(Math.abs(v))) },
          { ...axis, scale: 'temp', side: 1, stroke: muted, label: temperatureUnit, grid: { show: false }, values: (_u, ticks) => ticks.map((v) => number.format(v)) },
        ],
        series: [
          { label: t('dive.time'), value: (_u, v) => (v == null ? '–' : display.duration(v * 60)) },
          {
            label: t('dive.depth'), stroke: line, fill: depthFill, width: 2,
            value: (_u, v) => (v == null ? '–' : `${number.format(Math.abs(v))} ${depthUnit}`),
          },
          {
            label: t('dive.temperature'), scale: 'temp', stroke: muted, width: 1, dash: [4, 4],
            value: (_u, v) => (v == null ? '–' : `${number.format(v)} ${temperatureUnit}`),
          },
        ],
      },
      data,
      el,
    );
    const resize = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: 320 }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      plot.destroy();
    };
  // display.duration is recreated each render; units and locale capture what it depends on.
  }, [samples.data, units, locale, depthUnit, temperatureUnit, t]);

  if (samples.error) return <Notice tone="danger">{errorText(samples.error)}</Notice>;
  return <div ref={container} className="profile" role="img" aria-label={t('dive.profile')} />;
}

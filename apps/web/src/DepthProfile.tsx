import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { samplesQuery } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { perMinute, summarize } from './lib/profile.ts';
import { depthIn, temperatureIn } from './lib/units.ts';
import { Notice, Table } from './ui/index.ts';

const token = (el: Element, name: string, fallback: string) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

/** A token's colour with an alpha (two hex digits), whatever notation the token uses. */
function withAlpha(color: string, alpha: string) {
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
  const summaryId = useId();
  const dark = useColorScheme();
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
      if (!Number.isFinite(u.bbox?.top) || !Number.isFinite(u.bbox?.height)) return withAlpha(deep, '55');
      const gradient = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
      gradient.addColorStop(0, withAlpha(shallow, '33'));
      gradient.addColorStop(1, withAlpha(deep, 'cc'));
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
            label: t('dive.temperature'), scale: 'temp', stroke: muted, width: 1.5, dash: [6, 4],
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
  }, [samples.data, units, locale, depthUnit, temperatureUnit, t, dark]);

  if (samples.error) return <Notice tone="danger">{errorText(samples.error)}</Notice>;
  const depth = samples.data?.series.find((s) => s.channel === 'depth');
  const temperature = samples.data?.series.find((s) => s.channel === 'temperature');
  const summary = depth && summarize(depth, temperature);
  return (
    <div className="profile-figure">
      {/* The picture for sighted users; the summary and the table say the same in text (UI review B6). */}
      <div ref={container} className="profile" role="img" aria-label={t('dive.profile')} aria-describedby={summary ? summaryId : undefined} />
      {summary && depth && (
        <>
          <p id={summaryId} className="visually-hidden">
            {t('dive.profileSummary', {
              depth: display.depth(summary.maxDepthM),
              time: display.duration(summary.maxDepthAtSeconds),
              duration: display.duration(summary.durationSeconds),
            })}
            {summary.minTemperatureC !== null && summary.maxTemperatureC !== null && ` ${t('dive.profileTemperature', {
              range: summary.minTemperatureC === summary.maxTemperatureC ? display.temperature(summary.minTemperatureC)
                : `${display.temperature(summary.minTemperatureC)} – ${display.temperature(summary.maxTemperatureC)}`,
            })}`}
          </p>
          <details className="extras">
            <summary>{t('dive.profileTable')}</summary>
            <Table
              label={t('dive.profileTable')}
              head={[{ label: t('dive.time'), numeric: true }, { label: t('dive.depth'), numeric: true }, ...(temperature ? [{ label: t('dive.temperature'), numeric: true as const }] : [])]}
            >
              {perMinute(depth, temperature).map((row) => (
                <tr key={row.minute}>
                  <td className="num">{display.duration(row.minute * 60)}</td>
                  <td className="num">{display.depth(row.depthM)}</td>
                  {temperature && <td className="num">{row.temperatureC === null ? t('common.none') : display.temperature(row.temperatureC)}</td>}
                </tr>
              ))}
            </Table>
          </details>
        </>
      )}
    </div>
  );
}

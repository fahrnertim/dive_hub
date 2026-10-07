import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { samplesQuery } from './api.ts';
import { FindingLane, useAssessment } from './Assessment.tsx';
import { bandSeconds, clock, formatRate } from './lib/assessment.ts';
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
 * the profile darkens with depth, like the water column (docs/spec/design-system.md). `children` sit under the
 * chart, before the profile as a table: what recorded it.
 */
export function DepthProfile({ recordingId, children }: { recordingId: string; children?: ReactNode }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const samples = useQuery(samplesQuery(recordingId));
  const container = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const dark = useColorScheme();
  const { units, locale } = display;
  // The Dive's assessment refers to its Primary recording's profile (ADR 0036): only that one is coloured by ascent
  // speed and carries the findings' lane.
  const { assessment, selected } = useAssessment();
  const assessed = assessment?.recordingId === recordingId ? assessment : undefined;
  const bands = assessed?.ascentBands;
  const highlighted = assessed?.findings.find((f) => f.rule === selected && f.startSeconds !== null);
  const overlay = useRef<{ bands: number[][]; stretch: [number, number] | null }>({ bands: [], stretch: null });
  const plotRef = useRef<uPlot | null>(null);
  const [plotBox, setPlotBox] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    overlay.current = { bands: bands ?? [], stretch: highlighted ? [highlighted.startSeconds!, highlighted.endSeconds ?? highlighted.startSeconds!] : null };
    plotRef.current?.redraw(false);
  }, [bands, highlighted]);
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

    const ascent = [1, 2, 3].map((band) => token(el, `--color-ascent-${band}`, line));
    /** Over the profile: the selected finding's stretch as a band of light, and the ascent coloured by its speed. */
    const drawAssessment = (u: uPlot) => {
      const { bands: stretches, stretch: chosen } = overlay.current;
      if (stretches.length === 0 && !chosen) return;
      const { left, top, width, height } = u.bbox;
      const x = (seconds: number) => u.valToPos(seconds / 60, 'x', true);
      const ratio = devicePixelRatio || 1;
      u.ctx.save();
      u.ctx.beginPath();
      u.ctx.rect(left, top, width, height);
      u.ctx.clip();
      if (chosen) {
        u.ctx.fillStyle = withAlpha(line, '2e');
        u.ctx.fillRect(x(chosen[0]), top, Math.max(3 * ratio, x(chosen[1]) - x(chosen[0])), height);
      }
      const minutes = u.data[0] as number[];
      const depths = u.data[1] as (number | null)[];
      for (const [start = 0, end = 0, band = 1] of stretches) {
        u.ctx.beginPath();
        let drawing = false;
        for (let i = 0; i < minutes.length; i++) {
          const seconds = minutes[i]! * 60;
          if (seconds < start || seconds > end || depths[i] == null) continue;
          const px = u.valToPos(minutes[i]!, 'x', true);
          const py = u.valToPos(depths[i]!, 'y', true);
          if (drawing) u.ctx.lineTo(px, py);
          else u.ctx.moveTo(px, py);
          drawing = true;
        }
        // Faster is also thicker: the bands don't rest on colour alone.
        u.ctx.strokeStyle = ascent[band - 1]!;
        u.ctx.lineWidth = (2 + band) * ratio;
        u.ctx.lineCap = 'round';
        u.ctx.stroke();
      }
      u.ctx.restore();
    };
    const measure = (u: uPlot) => {
      const ratio = devicePixelRatio || 1;
      setPlotBox({ left: u.bbox.left / ratio, width: u.bbox.width / ratio });
    };

    const axis = { stroke: text, font, labelFont: font, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid } };
    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: 320,
        scales: { x: { time: false }, temp: { auto: true } },
        hooks: { draw: [drawAssessment], ready: [measure], setSize: [measure] },
        axes: [
          { ...axis, label: t('dive.minutes'), values: (_u, ticks) => ticks.map((v) => number.format(v)) },
          { ...axis, label: `${t('dive.depth')} (${depthUnit})`, values: (_u, ticks) => ticks.map((v) => number.format(Math.abs(v))) },
          // The unit sits in each tick ("25 °C"); a rotated "°C" axis title was hard to read (visual refresh 10).
          {
            ...axis, scale: 'temp', side: 1, stroke: muted, size: 64, grid: { show: false },
            values: (_u, ticks) => ticks.map((v) => `${number.format(v)} ${temperatureUnit}`),
          },
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
    plotRef.current = plot;
    const resize = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: 320 }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      plotRef.current = null;
      plot.destroy();
    };
  // display.duration is recreated each render; units and locale capture what it depends on.
  }, [samples.data, units, locale, depthUnit, temperatureUnit, t, dark]);

  if (samples.error) return <><Notice tone="danger">{errorText(samples.error)}</Notice>{children}</>;
  const depth = samples.data?.series.find((s) => s.channel === 'depth');
  const temperature = samples.data?.series.find((s) => s.channel === 'temperature');
  const summary = depth && summarize(depth, temperature);
  const [brisk, quick, veryQuick] = bandSeconds(bands ?? []);
  const rate = (metresPerMinute: number) => formatRate(metresPerMinute, units, locale);
  return (
    <div className="profile-figure">
      {/* The picture for sighted users; the summary and the table say the same in text (UI review B6). */}
      <div ref={container} className="profile" role="img" aria-label={t('dive.profile')} aria-describedby={summary ? summaryId : undefined} />
      {assessed && depth && <FindingLane totalSeconds={(depth.offsetsMs.at(-1) ?? 0) / 1000} plot={plotBox} />}
      {/* The ascent's colours in words: what each means and how long it lasted (the text alternative to the colours). */}
      {bands && bands.length > 0 && (
        <ul className="ascent-legend" aria-label={t('assessment.bands')}>
          <li className="ascent-legend-title" aria-hidden="true">{t('assessment.bands')}</li>
          {([[4, brisk], [9, quick], [18, veryQuick]] as const).map(([limit, seconds], i) => seconds > 0 && (
            <li key={limit}><span className="ascent-swatch" data-band={i + 1} aria-hidden="true" />{t('assessment.bandAbove', { rate: rate(limit) })}: {clock(seconds)} min</li>
          ))}
        </ul>
      )}
      {children}
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

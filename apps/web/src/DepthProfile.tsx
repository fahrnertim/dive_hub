import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { samplesQuery } from './api.ts';
import { FindingLane, useAssessment } from './Assessment.tsx';
import { bandSeconds, clock, formatRate } from './lib/assessment.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { mixName } from './lib/logbook.ts';
import { nearest, perMinute, summarize } from './lib/profile.ts';
import { tanksOf, type RecordedGas, type Tank } from './lib/tanks.ts';
import { depthIn, pressureIn, temperatureIn } from './lib/units.ts';
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

/** The right-hand axis of the depth profile (temperature); the tank strip keeps the same space free, so both plots span the same width. */
const RIGHT_AXIS = 64;

/** How the tanks' lines differ, in their order: by their dashes, never by colour alone. A fifth starts over. */
const TANK_DASHES: number[][] = [[], [8, 4], [2, 4], [10, 4, 2, 4]];

/**
 * Tank pressure over time, one line per tank pod, in a strip of its own under the depth profile and on its time axis
 * (ADR 0045): a third scale in the profile would be hard to read. `minutes` is the profile's time span.
 */
function TankStrip({ tanks, names, minutes, syncKey, describedBy }: {
  tanks: Tank[]; names: string[]; minutes: [number, number]; syncKey: string; describedBy: string;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const container = useRef<HTMLDivElement>(null);
  const dark = useColorScheme();
  const { units, locale } = display;
  const unit = display.unit('pressure');
  const [from, to] = minutes;
  const title = t('dive.tankPressure');
  // One string, so the chart is rebuilt when a name changes and not on every render.
  const labels = names.join('\n');

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // One time axis for all tanks: every reading's moment, and each tank's value where it has one.
    const offsets = [...new Set(tanks.flatMap((k) => k.series.offsetsMs))].sort((a, b) => a - b);
    const data: uPlot.AlignedData = [
      offsets.map((o) => o / 60_000),
      ...tanks.map((k) => {
        const at = new Map(k.series.offsetsMs.map((o, i) => [o, k.series.values[i]!]));
        return offsets.map((o) => {
          const bar = at.get(o);
          return bar === undefined ? null : pressureIn(bar, units);
        });
      }),
    ];
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const text = token(el, '--color-text', '#0b2236');
    const grid = token(el, '--color-border', '#d5dfe6');
    const line = token(el, '--color-accent', '#0f5e8c');
    // Canvas fonts need px; the tokens are in rem.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const font = `${Math.round(parseFloat(token(el, '--text-sm', '0.833rem')) * rem)}px ${token(el, '--font-sans', 'sans-serif')}`;
    const axis = { stroke: text, font, labelFont: font, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid } };
    const tankLabels = labels.split('\n');
    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: 160,
        padding: [8, RIGHT_AXIS, 0, 0],
        // From empty: how much is left reads off the line's height.
        scales: { x: { time: false, range: [from, to] }, y: { range: (_u, _min, max) => [0, (max || 1) * 1.05] } },
        cursor: { sync: { key: syncKey } },
        axes: [
          { ...axis, values: (_u, ticks) => ticks.map((v) => number.format(v)) },
          { ...axis, label: `${title} (${unit})`, values: (_u, ticks) => ticks.map((v) => number.format(v)) },
        ],
        series: [
          { label: t('dive.time'), value: (_u, v) => (v == null ? '–' : display.duration(v * 60)) },
          ...tanks.map((_k, i) => ({
            label: tanks.length === 1 ? title : tankLabels[i]!, stroke: line, width: 2, dash: TANK_DASHES[i % TANK_DASHES.length]!, spanGaps: true,
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
  }, [tanks, labels, from, to, syncKey, units, locale, unit, title, t, dark]);

  return <div ref={container} className="profile profile-tanks" role="img" aria-label={title} aria-describedby={describedBy} />;
}

/**
 * Depth over time (depth axis pointing down) with water temperature, drawn with uPlot. The area under
 * the profile darkens with depth, like the water column (docs/spec/design-system.md). Under it, the pressure of the
 * tanks a tank pod measured (`gases` and `sacLpm` are the Recording's summary of them). `children` sit under the
 * charts, before the profile as a table: what recorded it.
 */
export function DepthProfile({ recordingId, gases, sacLpm, children }: {
  recordingId: string; gases?: RecordedGas[] | undefined; sacLpm?: number | undefined; children?: ReactNode;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const samples = useQuery(samplesQuery(recordingId));
  const container = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const tanksId = useId();
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
        // The pointer's moment shows in the tank strip too.
        cursor: { sync: { key: recordingId } },
        hooks: { draw: [drawAssessment], ready: [measure], setSize: [measure] },
        axes: [
          { ...axis, label: t('dive.minutes'), values: (_u, ticks) => ticks.map((v) => number.format(v)) },
          { ...axis, label: `${t('dive.depth')} (${depthUnit})`, values: (_u, ticks) => ticks.map((v) => number.format(Math.abs(v))) },
          // The unit sits in each tick ("25 °C"); a rotated "°C" axis title was hard to read (visual refresh 10).
          {
            ...axis, scale: 'temp', side: 1, stroke: muted, size: RIGHT_AXIS, grid: { show: false },
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
  }, [samples.data, recordingId, units, locale, depthUnit, temperatureUnit, t, dark]);

  const tanks = useMemo(() => tanksOf(samples.data?.series ?? [], gases), [samples.data, gases]);

  if (samples.error) return <><Notice tone="danger">{errorText(samples.error)}</Notice>{children}</>;
  const depth = samples.data?.series.find((s) => s.channel === 'depth');
  const temperature = samples.data?.series.find((s) => s.channel === 'temperature');
  const summary = depth && summarize(depth, temperature);
  const [brisk, quick, veryQuick] = bandSeconds(bands ?? []);
  const rate = (metresPerMinute: number) => formatRate(metresPerMinute, units, locale);
  // A tank by what it holds, "EAN32, 12 L"; several are numbered as well.
  const tankNames = tanks.map((k, i) => {
    const what = [k.gas && mixName(k.gas, t('dive.air')), k.volumeL !== undefined && display.volume(k.volumeL)].filter(Boolean).join(', ');
    if (tanks.length === 1) return what || t('dive.tank');
    return what ? t('dive.tankNumbered', { n: i + 1, what }) : t('dive.tankNumber', { n: i + 1 });
  });
  const tankHeads = tanks.length === 1 ? [t('dive.tankPressure')] : tankNames;
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
      {tanks.length > 0 && depth && (
        <>
          <TankStrip
            tanks={tanks} names={tankNames} syncKey={recordingId} describedBy={tanksId}
            minutes={[(depth.offsetsMs[0] ?? 0) / 60_000, (depth.offsetsMs.at(-1) ?? 0) / 60_000]}
          />
          {/* The strip in words: what each tank held at the start and the end, and what the pod made of it. */}
          <ul id={tanksId} className="tank-lines">
            {tanks.map((k, i) => (
              <li key={k.channel}>
                {t('dive.tankLine', { tank: tankNames[i], start: display.pressure(k.startBar), end: display.pressure(k.endBar), used: display.pressure(k.usedBar) })}
              </li>
            ))}
            {sacLpm !== undefined && <li>{t('dive.podSac', { sac: display.gasRate(sacLpm) })}</li>}
          </ul>
        </>
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
              head={[
                { label: t('dive.time'), numeric: true }, { label: t('dive.depth'), numeric: true },
                ...(temperature ? [{ label: t('dive.temperature'), numeric: true as const }] : []),
                ...tankHeads.map((label) => ({ label, numeric: true as const })),
              ]}
            >
              {perMinute(depth, temperature).map((row) => (
                <tr key={row.minute}>
                  <td className="num">{display.duration(row.minute * 60)}</td>
                  <td className="num">{display.depth(row.depthM)}</td>
                  {temperature && <td className="num">{row.temperatureC === null ? t('common.none') : display.temperature(row.temperatureC)}</td>}
                  {tanks.map((k) => <td key={k.channel} className="num">{display.pressure(nearest(k.series, row.minute * 60_000))}</td>)}
                </tr>
              ))}
            </Table>
          </details>
        </>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type uPlot from 'uplot';
import { samplesQuery } from './api.ts';
import { FindingLane, useAssessment } from './Assessment.tsx';
import { bandSeconds, clock, formatRate } from './lib/assessment.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { mixName } from './lib/logbook.ts';
import { nearest, perMinute, summarize } from './lib/profile.ts';
import { tanksOf, type RecordedGas, type TiedCylinder } from './lib/tanks.ts';
import { DepthPlot, PressureStrip, token, withAlpha } from './ProfilePlot.tsx';
import { Notice, Table } from './ui/index.ts';

/** While the samples load: the figure keeps its place. */
const NO_POINTS = { minutes: [], depthsM: [], temperaturesC: [] };

/**
 * A Recording's depth over time with water temperature (ProfilePlot.tsx draws it). Under it, the pressure of the
 * tanks a tank pod measured (`gases` and `sacLpm` are the Recording's summary of them). `children` sit under the
 * charts, before the profile as a table: what recorded it.
 */
export function DepthProfile({ recordingId, gases, sacLpm, cylinders, children }: {
  recordingId: string; gases?: RecordedGas[] | undefined; sacLpm?: number | undefined;
  /** The Dive's Cylinders tied to this Recording's pressure series. */
  cylinders?: TiedCylinder[] | undefined; children?: ReactNode;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const samples = useQuery(samplesQuery(recordingId));
  const summaryId = useId();
  const tanksId = useId();
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

  // The plot's arrays, the same between renders: temperature on the depth time axis (both come from the same records).
  const points = useMemo(() => {
    const depth = samples.data?.series.find((s) => s.channel === 'depth');
    if (!depth) return undefined;
    const temperature = samples.data!.series.find((s) => s.channel === 'temperature');
    const tempByOffset = new Map(temperature?.offsetsMs.map((o, i) => [o, temperature.values[i]!]));
    return {
      minutes: depth.offsetsMs.map((o) => o / 60_000),
      depthsM: depth.values,
      temperaturesC: depth.offsetsMs.map((o) => tempByOffset.get(o) ?? null),
    };
  }, [samples.data]);

  /** Over the profile: the selected finding's stretch as a band of light, and the ascent coloured by its speed. */
  const drawAssessment = useCallback((u: uPlot) => {
    const { bands: stretches, stretch: chosen } = overlay.current;
    if (stretches.length === 0 && !chosen) return;
    const line = token(u.root, '--color-accent', '#0f5e8c');
    const ascent = [1, 2, 3].map((band) => token(u.root, `--color-ascent-${band}`, line));
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
  }, []);

  const tanks = useMemo(() => tanksOf(samples.data?.series ?? [], gases, cylinders), [samples.data, gases, cylinders]);
  const tankLines = useMemo(() => tanks.map((k) => ({ minutes: k.series.offsetsMs.map((o) => o / 60_000), bar: k.series.values })), [tanks]);

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
      <DepthPlot
        {...(points ?? NO_POINTS)} syncKey={recordingId} draw={drawAssessment} plotRef={plotRef} onBox={setPlotBox}
        label={t('dive.profile')} describedBy={summary ? summaryId : undefined}
      />
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
          <PressureStrip
            series={tankLines} labels={tankNames} syncKey={recordingId} describedBy={tanksId} title={t('dive.tankPressure')}
            range={[(depth.offsetsMs[0] ?? 0) / 60_000, (depth.offsetsMs.at(-1) ?? 0) / 60_000]}
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

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { diveQuery } from './api.ts';
import { DepthProfile } from './DepthProfile.tsx';
import { useDisplay, useErrorText } from './lib/display.ts';
import { ErrorBoundary, Muted, Notice, Panel } from './ui/index.ts';

type Summary = Record<string, unknown>;
const n = (v: unknown) => (typeof v === 'number' ? v : undefined);

export function DiveDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const dive = useQuery(diveQuery(id));
  const [selected, setSelected] = useState<string>();

  if (dive.isPending) return <Muted>{t('common.loading')}</Muted>;
  if (dive.error) return <Notice tone="danger">{errorText(dive.error)}</Notice>;
  const d = dive.data;
  const recording = d.recordings.find((r) => r.id === selected) ?? d.recordings.find((r) => r.isPrimary) ?? d.recordings[0];
  const s: Summary = recording?.summary ?? {};
  const gases = (s.gases as { o2: number; he: number }[] | undefined) ?? [];
  const minT = n(s.minTemperatureC);
  const maxT = n(s.maxTemperatureC);

  return (
    <>
      <p><a href="#/">{t('dive.back')}</a></p>
      <Panel title={<>{d.number !== null ? t('dive.title', { number: d.number }) : t('dive.titleNoNumber')}<span className="title-meta">{display.diveTime(d.startsAt, d.utcOffsetSeconds)}</span></>}>
        <dl className="facts">
          <div><dt>{t('dive.maxDepth')}</dt><dd>{display.depth(d.maxDepthM)}</dd></div>
          <div><dt>{t('dive.avgDepth')}</dt><dd>{display.depth(d.avgDepthM)}</dd></div>
          <div><dt>{t('dive.duration')}</dt><dd>{display.duration(d.durationSeconds)}</dd></div>
          {minT !== undefined && (
            <div><dt>{t('dive.water')}</dt><dd>{display.temperature(minT)}{maxT !== undefined && maxT !== minT && ` – ${display.temperature(maxT)}`}</dd></div>
          )}
          {gases.length > 0 && (
            <div><dt>{t('dive.gas')}</dt><dd>{gases.map((g) => (g.he > 0 ? `${g.o2}/${g.he}` : g.o2 === 21 ? t('dive.air') : `EAN${g.o2}`)).join(', ')}</dd></div>
          )}
          {n(s.gfLow) !== undefined && <div><dt>{t('dive.gradientFactors')}</dt><dd>{n(s.gfLow)}/{n(s.gfHigh)}</dd></div>}
          {typeof s.waterType === 'string' && <div><dt>{t('dive.waterType')}</dt><dd>{s.waterType}</dd></div>}
        </dl>

        {d.recordings.length > 1 && (
          <ToggleButtonGroup
            className="segmented"
            aria-label={t('dive.recordings')}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={recording ? [recording.id] : []}
            onSelectionChange={(keys) => setSelected([...keys][0] as string)}
          >
            {d.recordings.map((r, i) => (
              <ToggleButton key={r.id} id={r.id} className="segment">
                {t('dive.recordingN', { n: i + 1 })}{r.isPrimary && ` (${t('dive.primary')})`}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        {recording && (
          <ErrorBoundary key={recording.id} fallback={<Notice tone="danger">{t('dive.profileFailed')}</Notice>}>
            <DepthProfile recordingId={recording.id} />
          </ErrorBoundary>
        )}
      </Panel>
    </>
  );
}

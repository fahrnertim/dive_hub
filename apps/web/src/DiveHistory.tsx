import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { diversQuery, revisionsQuery, type DiveView, type OverridableField, type RevisionView } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { deviceName } from './lib/devices.ts';
import { useFormatValue } from './lib/dive-values.ts';
import { Muted, Notice, Panel } from './ui/index.ts';

const OVERRIDABLE: OverridableField[] = ['number', 'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC', 'waterType'];
const isOverridable = (key: string): key is OverridableField => (OVERRIDABLE as string[]).includes(key);

/** Who or what changed the Dive, when, and from what to what (Revisions, newest first). */
export function DiveHistory({ dive }: { dive: DiveView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const revisions = useQuery(revisionsQuery(dive.id));
  return (
    <Panel title={t('history.title')}>
      {revisions.error && <Notice tone="danger">{errorText(revisions.error)}</Notice>}
      {revisions.data?.length === 0 && <Muted>{t('history.empty')}</Muted>}
      {revisions.data && revisions.data.length > 0 && (
        <ol className="history">
          {revisions.data.map((r) => <Entry key={r.id} revision={r} dive={dive} />)}
        </ol>
      )}
    </Panel>
  );
}

function Entry({ revision: r, dive }: { revision: RevisionView; dive: DiveView }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const format = useFormatValue();
  const divers = useQuery(diversQuery());
  const diverName = (id: unknown) => divers.data?.find((v) => v.id === id)?.name ?? t('common.none');
  const who = r.actor.type === 'system' ? t('history.by.system')
    : r.actor.name ? t(`history.by.${r.actor.type}`, { name: r.actor.name }) : t('history.by.unknown');
  const overrides = r.changes.overrides as { from: OverridableField[]; to: OverridableField[] } | undefined;
  const recordingName = (id: unknown) => {
    const n = dive.recordings.findIndex((rec) => rec.id === id);
    if (n < 0) return t('common.none');
    const d = dive.recordings[n]!.device;
    return d ? `${deviceName(d.manufacturer, d.product)} (${d.serialNumber})` : t('dive.recordingN', { n: n + 1 });
  };

  const lines = Object.entries(r.changes).flatMap(([key, { from, to }]) => {
    if (key === 'overrides') return [];
    if (key === 'notes') return [t('history.notesChanged')];
    if (key === 'recordings') return [to ? t('history.recordingAdded') : t('history.recordingRemoved')];
    if (key === 'diverId') return [`${t('history.field.diverId')}: ${diverName(from)} → ${diverName(to)}`];
    if (key === 'originalId') return [t('history.fileReplaced')];
    if (key === 'primaryRecordingId') return [`${t('history.field.primaryRecordingId')}: ${recordingName(to)}`];
    if (!isOverridable(key)) return [key];
    const mark = overrides?.to.includes(key) && !overrides.from.includes(key) ? ` (${t('history.setByHand')})`
      : overrides?.from.includes(key) && !overrides.to.includes(key) ? ` (${t('history.reset')})` : '';
    return [`${t(`history.field.${key}`)}: ${format(key, from as never)} → ${format(key, to as never)}${mark}`];
  });

  return (
    <li>
      <div className="history-head">
        <strong>{t(`history.cause.${r.cause}`)}</strong>
        <span className="muted">{display.dateTime(r.at)} · {who}</span>
      </div>
      {lines.length > 0 && <ul className="history-changes">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>}
    </li>
  );
}

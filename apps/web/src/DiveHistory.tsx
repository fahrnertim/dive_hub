import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diversQuery, revisionsQuery, type DiveView, type RevisionView } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { deviceName } from './lib/devices.ts';
import { useFormatValue, type HistoryField } from './lib/dive-values.ts';
import { mergeEdits } from './lib/history.ts';
import { useProviders } from './lib/providers.ts';
import { Button, Disclosure, Muted, Notice } from './ui/index.ts';

/** Values a Revision can change, with the water type that old Revisions mention (a Dive value before ADR 0025). */
const VALUES: HistoryField[] = ['number', 'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC', 'waterType'];
const isValue = (key: string): key is HistoryField => (VALUES as string[]).includes(key);

/** Entries shown before "Show the whole history". */
const LATEST = 3;

/**
 * Who or what changed the Dive, when, and from what to what (Revisions, newest first). Edits one
 * person makes in a row are one entry, and only the latest few show at first (UI review C2).
 * On the dive page it is one line that says the latest change and when, until it is opened (UI redesign, slice A).
 */
export function DiveHistory({ dive }: { dive: DiveView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const revisions = useQuery(revisionsQuery(dive.id));
  const [showAll, setShowAll] = useState(false);
  const entries = revisions.data ? mergeEdits(revisions.data) : [];
  const latest = entries[0];
  return (
    <section className="dive-line">
      <Disclosure
        level={2} title={t('history.title')}
        summary={latest && <span className="meta">{t('history.state', { cause: t(`history.cause.${latest.cause}`), date: display.date(latest.at) })}</span>}
      >
        {revisions.error && <Notice tone="danger">{errorText(revisions.error)}</Notice>}
        {revisions.data?.length === 0 && <Muted>{t('history.empty')}</Muted>}
        {entries.length > 0 && (
          <ol className="history">
            {(showAll ? entries : entries.slice(0, LATEST)).map((r) => <Entry key={r.id} revision={r} count={r.count} dive={dive} />)}
          </ol>
        )}
        {entries.length > LATEST && (
          <Button variant="quiet" onPress={() => setShowAll(!showAll)}>{showAll ? t('history.showFewer') : t('history.showAll')}</Button>
        )}
      </Disclosure>
    </section>
  );
}

function Entry({ revision: r, count, dive }: { revision: RevisionView; count: number; dive: DiveView }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const format = useFormatValue();
  const divers = useQuery(diversQuery());
  const providers = useProviders();
  const providerName = (id: unknown) => providers.data?.find((x) => x.id === id)?.name ?? String(id);
  const diverName = (id: unknown) => divers.data?.find((v) => v.id === id)?.name ?? t('common.none');
  const who = r.actor.type === 'system' ? t('history.by.system')
    : r.actor.name ? t(`history.by.${r.actor.type}`, { name: r.actor.name }) : t('history.by.unknown');
  const overrides = r.changes.overrides as { from: HistoryField[]; to: HistoryField[] } | undefined;
  const recordingName = (id: unknown) => {
    const n = dive.recordings.findIndex((rec) => rec.id === id);
    if (n < 0) return t('common.none');
    const d = dive.recordings[n]!.device;
    return d ? `${deviceName(d.manufacturer, d.product)} (${d.serialNumber})` : t('dive.recordingN', { n: n + 1 });
  };

  const lines = Object.entries(r.changes).flatMap(([key, { from, to }]) => {
    // Deleting and restoring (ADR 0026): the cause says it all.
    if (key === 'overrides' || key === 'deletedAt') return [];
    if (key === 'notes') return [t('history.notesChanged')];
    if (key === 'recordings') return [to ? t('history.recordingAdded') : t('history.recordingRemoved')];
    if (key === 'diverId') return [t('history.change', { field: t('history.field.diverId'), from: diverName(from), to: diverName(to) })];
    if (key === 'originalId') return [t('history.fileReplaced')];
    // Merging two Dives and moving a linked one (ADR 0038): the other Dive is deleted, so it is told, not linked.
    if (key === 'mergedFrom' || key === 'mergedInto' || key === 'movedFrom' || key === 'movedTo') return [t(`history.${key}`)];
    if (key === 'providers') return ((to ?? []) as { provider: string }[]).map((p) => t('history.linkMoved', { name: providerName(p.provider) }));
    // A Dive made from a Provider's logbook entry, and where its time zone came from (ADR 0030).
    if (key === 'fromProvider') return to ? [t('history.fromProvider', { name: providerName(to) })] : [];
    if (key === 'utcOffsetSource') {
      const source = (v: unknown) => t(`history.offsetSource.${v as 'device' | 'position' | 'nearby' | 'unknown'}`);
      return [t('history.change', { field: t('history.field.utcOffsetSource'), from: source(from), to: source(to) })];
    }
    if (key === 'site') {
      const name = (v: unknown) => (v as { name?: string } | null)?.name ?? t('common.none');
      return [t('history.change', { field: t('history.field.site'), from: name(from), to: name(to) })];
    }
    if (key === 'primaryRecordingId') return [t('history.changeTo', { field: t('history.field.primaryRecordingId'), value: recordingName(to) })];
    if (key === 'participants') {
      // Who came onto the Dive, who left it, and whose role changed (ADR 0028); names as they were then.
      type P = { diverId: string; name: string; role: 'buddy' | 'guide' | 'instructor' };
      const before = (from ?? []) as P[];
      const after = (to ?? []) as P[];
      const role = (p: P) => t(`participants.role.${p.role}`);
      const was = (p: P) => before.find((b) => b.diverId === p.diverId);
      return [
        ...after.filter((p) => !was(p)).map((p) => t('history.participantAdded', { name: p.name, role: role(p) })),
        ...after.filter((p) => was(p) && was(p)!.role !== p.role)
          .map((p) => t('history.participantRole', { name: p.name, from: role(was(p)!), to: role(p) })),
        ...before.filter((b) => !after.some((p) => p.diverId === b.diverId))
          .map((b) => t('history.participantRemoved', { name: b.name })),
      ];
    }
    if (!isValue(key)) return [key];
    const mark = overrides?.to.includes(key) && !overrides.from.includes(key) ? t('history.setByHand')
      : overrides?.from.includes(key) && !overrides.to.includes(key) ? t('history.reset') : undefined;
    const change = { field: t(`history.field.${key}`), from: format(key, from), to: format(key, to) };
    return [mark ? t('history.changeMarked', { ...change, mark }) : t('history.change', change)];
  });

  return (
    <li>
      <div className="history-head">
        <strong>{t(`history.cause.${r.cause}`)}</strong>
        <span className="meta">{display.dateTime(r.at)} · {who}{count > 1 && ` · ${t('history.edits', { count })}`}</span>
      </div>
      {lines.length > 0 && <ul className="history-changes">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>}
      {lines.length === 0 && count > 1 && <ul className="history-changes"><li>{t('history.noNetChange')}</li></ul>}
    </li>
  );
}

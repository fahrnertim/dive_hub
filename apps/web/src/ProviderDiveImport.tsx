import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, diveImportPreviewQuery, importQuery, keys, unwrap, type ConnectionView, type DiveImportMode, type DiveImportPreview,
  type ProviderView,
} from './api.ts';
import { ProviderImportSummary } from './ImportPanel.tsx';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { deviceName } from './lib/devices.ts';
import { useProviderText } from './lib/providers.ts';
import { formatDiveTime } from './lib/units.ts';
import { Button, Muted, Notice, RadioGroup, Select } from './ui/index.ts';

const WINDOWS = ['5', '15', '30', '60'] as const;
type Window = (typeof WINDOWS)[number];

/** A choice with its explanation under it, read together by screen readers. */
const choice = (label: string, hint: string) => (
  <span className="radio-text"><span>{label}</span><span className="field-description">{hint}</span></span>
);

/**
 * Importing the account's dives at a Provider (ADR 0030), under its Connection: what the import may do and the matching
 * window (saved at once), then a preview that reads the Provider (computers found, what happens to each dive, the
 * entries to decide), and the import itself, which runs in the background like an upload.
 */
export function ProviderDiveImport({ provider: p, connection: c, several }: { provider: ProviderView; connection: ConnectionView; several: boolean }) {
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [previewing, setPreviewing] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const settings = useMutation({
    mutationFn: async (diveImport: { mode?: DiveImportMode; windowMinutes?: 5 | 15 | 30 | 60; computers?: { key: string; choice: 'recordings' | 'entries' }[] }) =>
      unwrap(await api.PATCH('/api/connections/{id}', { params: { path: { id: c.id } }, body: { diveImport } })),
    onSuccess: async (updated) => {
      queryClient.setQueryData<ConnectionView[]>(keys.connections, (all) => all?.map((x) => (x.id === updated.id ? updated : x)));
      // What the preview showed no longer holds.
      await queryClient.invalidateQueries({ queryKey: keys.diveImport(c.id) });
      announce(pt('importSaved'));
    },
  });
  if (!c.diveImport || c.state !== 'active') return null;
  const { mode, windowMinutes } = c.diveImport;

  return (
    <section className="provider-import" aria-labelledby={`import-${c.id}`}>
      <h3 id={`import-${c.id}`}>{several ? pt('importTitleDiver', { diver: c.diverName }) : pt('importTitle')}</h3>
      <Muted>{pt('importIntro')}</Muted>
      <RadioGroup
        label={pt('importMode')} value={mode}
        onChange={(value) => { setImportId(null); settings.mutate({ mode: value as DiveImportMode }); }}
        options={[
          { value: 'off', label: choice(pt('importOff'), pt('importOffHint')) },
          { value: 'add', label: choice(pt('importAdd'), pt('importAddHint')) },
          { value: 'create', label: choice(pt('importCreate'), pt('importCreateHint')) },
        ]}
      />
      {mode !== 'off' && (
        <Select<Window>
          label={pt('importWindow')} description={pt('importWindowHint')} value={String(windowMinutes) as Window}
          onChange={(value) => value && settings.mutate({ windowMinutes: Number(value) as 5 | 15 | 30 | 60 })}
          options={WINDOWS.map((w) => ({ id: w, label: pt('importMinutes' as 'importMinutes_one', { count: Number(w) }) }))}
        />
      )}
      {settings.error && <Notice tone="danger">{errorText(settings.error)}</Notice>}
      {mode !== 'off' && !previewing && !importId && (
        <div className="form-actions">
          <Button icon="siteImport" onPress={() => setPreviewing(true)}>{pt('importPreview')}</Button>
        </div>
      )}
      {mode !== 'off' && previewing && !importId && (
        <Preview
          provider={p} connection={c} mode={mode} onSettings={(computers) => settings.mutate({ computers })}
          onStarted={(id) => { setImportId(id); setPreviewing(false); }} onClose={() => setPreviewing(false)}
        />
      )}
      {importId && <Outcome provider={p} connectionId={c.id} importId={importId} onDone={() => setImportId(null)} />}
    </section>
  );
}

type Decision = DiveImportPreview['decisions'][number];

function Preview({ provider: p, connection: c, mode, onSettings, onStarted, onClose }: {
  provider: ProviderView; connection: ConnectionView; mode: DiveImportMode;
  onSettings: (computers: { key: string; choice: 'recordings' | 'entries' }[]) => void;
  onStarted: (importId: string) => void; onClose: () => void;
}) {
  const pt = useProviderText(p);
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const preview = useQuery(diveImportPreviewQuery(c.id));
  // Entries with several Dives here: left out unless the User picks one (ADR 0030).
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  // Fields changed both at the Provider and here: Dive Hub's value stays unless the User takes the Provider's.
  const [conflicts, setConflicts] = useState<Record<string, 'hub' | 'provider'>>({});
  const start = useMutation({
    mutationFn: async (data: DiveImportPreview) => unwrap(await api.POST('/api/connections/{id}/dive-import', {
      params: { path: { id: c.id } },
      body: {
        computers: data.computers.map((x) => ({ key: x.key, choice: x.choice })),
        decisions: data.decisions.map((d) => ({ remoteId: d.remoteId, choice: decisions[d.remoteId] ?? 'leave_out' })),
        conflicts: data.conflicts.map((c) => ({ remoteId: c.remoteId, field: c.field, choice: conflicts[`${c.remoteId}:${c.field}`] ?? 'hub' })),
      },
    })),
    onSuccess: async (created) => {
      queryClient.removeQueries({ queryKey: keys.diveImport(c.id) });
      await queryClient.invalidateQueries({ queryKey: keys.imports });
      announce(pt('importStarted'));
      onStarted(created.id);
    },
  });

  if (preview.isPending) return <Muted>{pt('importReading')}</Muted>;
  if (preview.error) {
    return (
      <div className="provider-import-part">
        <Notice tone="danger">{errorText(preview.error)}</Notice>
        <div className="form-actions"><Button onPress={onClose}>{t('common.close')}</Button></div>
      </div>
    );
  }
  const data = preview.data;
  const n = new Intl.NumberFormat(i18n.language);
  const counted = (['recordings', 'link', 'create', 'decide', 'changed', 'linked', 'ours', 'deleted', 'noMatch', 'unreadable'] as const)
    .filter((k) => data.counts[k] > 0);
  // The local time as the Provider keeps it, without a time zone.
  const local = (text: string) => formatDiveTime(`${text.replace(' ', 'T')}Z`, null, display.locale, true);
  /** A conflicting value as the User reads it: depths, temperatures and durations in their units, names listed. */
  const valueText = (field: DiveImportPreview['conflicts'][number]['field'], v: string | number | string[] | null): string => {
    if (v === null || (Array.isArray(v) && v.length === 0)) return t('common.none');
    if (Array.isArray(v)) return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(v);
    if (field === 'startsAt' && typeof v === 'string') return local(v);
    if (typeof v === 'number') {
      if (field === 'durationSeconds') return display.duration(v);
      if (field === 'waterTemperatureC') return display.temperature(v);
      return display.depth(v);
    }
    return v;
  };
  const candidate = (x: Decision['candidates'][number]) => [
    x.number !== null ? t('dive.title', { number: x.number }) : null,
    display.diveTime(x.startsAt, x.utcOffsetSeconds, x.utcOffsetSource),
    display.depth(x.maxDepthM), display.duration(x.durationSeconds), x.site?.name,
  ].filter(Boolean).join(' · ');

  return (
    <div className="provider-import-part">
      <h4>{pt('importPreviewTitle' as 'importPreviewTitle_one', { count: data.counts.total })}</h4>
      {data.counts.total === 0 ? <Muted>{pt('importEmpty')}</Muted> : (
        <ul className="import-counts">
          {counted.map((k) => <li key={k}>{pt(`importCount.${k}` as 'importCount.link_one', { count: data.counts[k], n: n.format(data.counts[k]) })}</li>)}
        </ul>
      )}
      {(['known', 'match', 'create', 'missing'] as const).some((k) => data.sites[k] > 0) && (
        <div className="provider-import-part">
          <h4>{pt('importSites')}</h4>
          <ul className="import-counts">
            {(['known', 'match', 'create', 'missing'] as const).filter((k) => data.sites[k] > 0).map((k) => (
              <li key={k}>{pt(`importSite.${k}` as 'importSite.known_one', { count: data.sites[k], n: n.format(data.sites[k]) })}</li>
            ))}
          </ul>
          {data.sites.missing > 0 && <Muted>{pt('importSitesAdmin')}</Muted>}
        </div>
      )}
      {data.computers.length > 0 && (
        <div className="provider-import-part">
          <h4>{pt('importComputers')}</h4>
          <Muted>{pt('importComputersIntro')}</Muted>
          {data.computers.map((x) => (
            <RadioGroup
              key={x.key} value={x.choice}
              label={pt('importComputer' as 'importComputer_one', { computer: `${deviceName(x.manufacturer, x.product)} (${x.serialNumber})`, count: x.dives })}
              onChange={(value) => onSettings([{ key: x.key, choice: value as 'recordings' | 'entries' }])}
              options={[
                { value: 'recordings', label: choice(pt('importAsRecordings'), x.otherDiver ? pt('importOtherDiver') : pt('importAsRecordingsHint')) },
                { value: 'entries', label: choice(pt('importAsEntries'), x.fromFiles ? pt('importFromFiles') : pt('importAsEntriesHint')) },
              ]}
            />
          ))}
        </div>
      )}
      {data.conflicts.length > 0 && (
        <div className="provider-import-part">
          <h4>{pt('importConflicts')}</h4>
          <Muted>{pt('importConflictsIntro')}</Muted>
          {data.conflicts.map((c) => {
            const key = `${c.remoteId}:${c.field}`;
            const dive = c.number !== null ? t('dive.title', { number: c.number }) : display.diveTime(c.startsAt, c.utcOffsetSeconds, c.utcOffsetSource);
            return (
              <RadioGroup
                key={key} value={conflicts[key] ?? 'hub'}
                onChange={(value) => setConflicts({ ...conflicts, [key]: value as 'hub' | 'provider' })}
                label={pt('importConflict', { dive, field: pt(`importField.${c.field}`) })}
                options={[
                  { value: 'hub', label: pt('importKeepHub', { value: valueText(c.field, c.hub) }) },
                  { value: 'provider', label: pt('importTakeProvider', { value: valueText(c.field, c.provider) }) },
                ]}
              />
            );
          })}
        </div>
      )}
      {data.decisions.length > 0 && (
        <div className="provider-import-part">
          <h4>{pt('importDecide')}</h4>
          <Muted>{pt('importDecideIntro')}</Muted>
          {data.decisions.map((d) => (
            <RadioGroup
              key={d.remoteId} value={decisions[d.remoteId] ?? 'leave_out'}
              onChange={(value) => setDecisions({ ...decisions, [d.remoteId]: value })}
              label={pt('importEntry', {
                number: d.remoteNumber ?? '', time: local(d.localStart), depth: display.depth(d.maxDepthM), duration: display.duration(d.durationSeconds),
              })}
              options={[
                ...d.candidates.map((x) => ({ value: x.diveId, label: candidate(x) })),
                ...(mode === 'create' ? [{ value: 'new', label: pt('importNewDive') }] : []),
                { value: 'leave_out', label: pt('importLeaveOut') },
              ]}
            />
          ))}
        </div>
      )}
      {start.error && <Notice tone="danger">{errorText(start.error)}</Notice>}
      <div className="form-actions">
        <Button variant="primary" icon="siteImport" isPending={start.isPending} isDisabled={data.counts.total === 0} onPress={() => start.mutate(data)}>
          {pt('importStart')}
        </Button>
        <Button onPress={onClose}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

/** The Import while it runs and how it ended; the logbook refreshes once it is done. */
function Outcome({ provider: p, connectionId, importId, onDone }: { provider: ProviderView; connectionId: string; importId: string; onDone: () => void }) {
  const pt = useProviderText(p);
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const item = useQuery(importQuery(importId));
  const running = !item.data || item.data.status === 'pending' || item.data.status === 'processing';
  useEffect(() => {
    if (running) return;
    void queryClient.invalidateQueries({ queryKey: keys.dives });
    void queryClient.invalidateQueries({ queryKey: keys.diveImport(connectionId) });
  }, [running, queryClient, connectionId]);
  return (
    <div className="provider-import-part" aria-busy={running}>
      <h4>{pt('importRunning')}</h4>
      {item.error && <Notice tone="danger">{errorText(item.error)}</Notice>}
      {item.data && <ProviderImportSummary item={item.data} />}
      {!running && (
        <div className="form-actions">
          <a href="#/" className="btn btn-secondary">{pt('importToLogbook')}</a>
          <Button onPress={onDone}>{t('common.close')}</Button>
        </div>
      )}
    </div>
  );
}

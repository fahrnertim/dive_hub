import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { api, ApiError, diveQuery, diversQuery, keys, unwrap, type DiveView, type OverridableField, type RecordingSummary } from './api.ts';
import { DepthProfile } from './DepthProfile.tsx';
import { DiveEditForm } from './DiveEditForm.tsx';
import { DiveHistory } from './DiveHistory.tsx';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { deviceName } from './lib/devices.ts';
import { useFormatValue } from './lib/dive-values.ts';
import { focusHeading } from './lib/focus.ts';
import { usePageTitle } from './lib/page.ts';
import { ActionMenu, Button, ConfirmDialog, Dialog, ErrorBoundary, Muted, Notice, Panel, Select } from './ui/index.ts';

/** One Dive (ADR 0015): its values with Overrides marked, notes, Recordings, and its history. */
export function DiveDetail({ id, recordingId }: { id: string; recordingId?: string | undefined }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const dive = useQuery(diveQuery(id));
  const divers = useQuery(diversQuery());
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  // Closing the edit form puts focus back on "Edit dive" (the form had it; UI review B1).
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const v = dive.data?.values;
  const notFound = dive.error instanceof ApiError && dive.error.status === 404;
  const title = !v ? (notFound ? t('dive.notFoundTitle') : undefined)
    : v.number !== null ? t('dive.title', { number: v.number }) : t('dive.titleNoNumber');
  usePageTitle(title);

  if (dive.isPending) return <DiveLoading />;
  if (dive.error) {
    return (
      <>
        <p><a href="#/">{t('dive.back')}</a></p>
        {notFound && <h1>{title}</h1>}
        <Notice tone="danger">{errorText(dive.error)}</Notice>
      </>
    );
  }
  const d = dive.data;
  const several = (divers.data?.length ?? 0) > 1;
  const diverName = divers.data?.find((v) => v.id === d.diverId)?.name;

  return (
    <>
      <p><a href="#/">{t('dive.back')}</a></p>
      <Panel
        level={1}
        title={(
          <>
            {title}
            <span className="title-meta">
              {display.diveTime(d.values.startsAt.at, d.values.startsAt.utcOffsetSeconds)}<EditedMark dive={d} field="startsAt" />
              {/* The Diver right under the date, before the actions wrap in on a phone (UI review C4). */}
              {several && diverName && <span className="title-diver">{t('dive.diver')}: {diverName}</span>}
            </span>
          </>
        )}
        actions={!editing && (
          <div className="form-actions">
            <Button ref={editButton} onPress={() => setEditing(true)}>{t('dive.edit')}</Button>
            {several && (
              <ActionMenu
                label={t('dive.moreActions')} aria-label={t('common.forItem', { action: t('dive.moreActions'), item: title ?? '' })}
                actions={[{ id: 'move', label: t('dive.moveTo'), onAction: () => setMoving(true) }]}
              />
            )}
          </div>
        )}
      >
        {editing
          ? <DiveEditForm key={d.version} dive={d} onDone={() => setEditing(false)} />
          : <DiveFacts dive={d} />}
      </Panel>
      <Recordings dive={d} initial={recordingId} />
      <DiveHistory dive={d} />
      {moving && <MoveDialog dive={d} onClose={() => setMoving(false)} />}
    </>
  );
}

/** Space for the dive while it loads, so the page doesn't jump when it arrives (UI review C10). */
function DiveLoading() {
  const { t } = useTranslation();
  return (
    <div className="loading" aria-busy="true">
      <Muted>{t('common.loading')}</Muted>
      <div className="panel skeleton skeleton-facts" />
      <div className="panel skeleton skeleton-chart" />
    </div>
  );
}

/** Files the Dive under another Diver the User manages (ADR 0016). */
function MoveDialog({ dive: d, onClose }: { dive: DiveView; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const divers = useQuery(diversQuery());
  const others = (divers.data ?? []).filter((v) => v.id !== d.diverId);
  const [target, setTarget] = useState<string | null>(others[0]?.id ?? null);
  const move = useMutation({
    mutationFn: async (diverId: string) =>
      unwrap(await api.POST('/api/dives/{id}/move', { params: { path: { id: d.id } }, body: { diverId, version: d.version } })),
    onSuccess: async (updated) => {
      queryClient.setQueryData(keys.dive(d.id), updated);
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      await queryClient.invalidateQueries({ queryKey: keys.revisions(d.id) });
      onClose();
    },
  });
  return (
    <Dialog title={t('dive.moveTitle')} isOpen onOpenChange={(open) => !open && onClose()}>
      <p>{t('dive.moveIntro')}</p>
      <div className="form">
        <Select label={t('dive.diver')} value={target} onChange={setTarget} options={others.map((v) => ({ id: v.id, label: v.name }))} />
        {move.error && <Notice tone="danger">{errorText(move.error)}</Notice>}
        <div className="form-actions">
          <Button variant="primary" isDisabled={!target} isPending={move.isPending} onPress={() => target && move.mutate(target)}>{t('dive.move')}</Button>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * "edited" next to a value the User set by hand, with what the recording says. Visible text, not a
 * tooltip: keyboard and touch users can't reach a `title`.
 */
function EditedMark({ dive, field }: { dive: DiveView; field: OverridableField }) {
  const { t } = useTranslation();
  const format = useFormatValue();
  if (!dive.overrides.includes(field)) return null;
  return (
    <>
      <span className="badge">{t('dive.edited')}</span>
      {dive.fromRecording && (
        <span className="recorded-value">{t('dive.fromRecording', { value: format(field, dive.fromRecording[field]) })}</span>
      )}
    </>
  );
}

function Fact({ label, children, mark }: { label: string; children: ReactNode; mark?: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}{mark}</dd></div>;
}

function DiveFacts({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  const format = useFormatValue();
  const fact = (field: OverridableField, label: string) => (
    <Fact label={label} mark={<EditedMark dive={d} field={field} />}>{format(field, d.values[field])}</Fact>
  );
  return (
    <>
      <dl className="facts">
        {fact('maxDepthM', t('dive.maxDepth'))}
        {fact('avgDepthM', t('dive.avgDepth'))}
        {fact('durationSeconds', t('dive.duration'))}
        {fact('waterTemperatureC', t('dive.waterTemperature'))}
        {fact('waterType', t('dive.waterType'))}
      </dl>
      <h2 className="subheading">{t('dive.notes')}</h2>
      {d.notes ? <p className="notes">{d.notes}</p> : <Muted>{t('dive.noNotes')}</Muted>}
    </>
  );
}

const gasName = (g: NonNullable<RecordingSummary['gases']>[number], air: string) =>
  g.he > 0 ? `${g.o2}/${g.he}` : g.o2 === 21 ? air : `EAN${g.o2}`;

/**
 * The Recordings of the Dive as tabs: which one is primary, the device's own data and the profile.
 * The tab is in the address (?recording=…), and the actions on a Recording are in a menu (UI review C3).
 */
function Recordings({ dive: d, initial }: { dive: DiveView; initial: string | undefined }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(initial);
  const [splitting, setSplitting] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const recording = d.recordings.find((r) => r.id === selected) ?? d.recordings.find((r) => r.isPrimary) ?? d.recordings[0];
  const select = (id: string) => {
    setSelected(id);
    history.replaceState(null, '', `#/dives/${d.id}?recording=${id}`);
  };
  const splitOff = useMutation({
    mutationFn: async (recordingId: string) =>
      unwrap(await api.POST('/api/recordings/{id}/detach', { params: { path: { id: recordingId } }, body: { version: d.version } })),
    onSuccess: async () => {
      setSelected(undefined);
      history.replaceState(null, '', `#/dives/${d.id}`);
      await queryClient.invalidateQueries({ queryKey: keys.dives });
    },
  });
  const makePrimary = useMutation({
    mutationFn: async (recordingId: string) =>
      unwrap(await api.PUT('/api/dives/{id}/primary-recording', { params: { path: { id: d.id } }, body: { recordingId, version: d.version } })),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.dive(d.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(t('dive.primaryChanged'));
    },
  });
  if (!recording) return null;
  const name = (r: DiveView['recordings'][number]) => (r.device
    ? `${deviceName(r.device.manufacturer, r.device.product)} (${r.device.serialNumber})`
    : t('dive.recordingN', { n: d.recordings.indexOf(r) + 1 }));

  if (d.recordings.length === 1) {
    return <Panel title={t('dive.recording')}><RecordingDetails recording={recording} /></Panel>;
  }
  return (
    <Panel title={t('dive.recordings')}>
      <div ref={content}>
        <Tabs selectedKey={recording.id} onSelectionChange={(key) => select(String(key))}>
          <TabList aria-label={t('dive.recordings')} className="tab-list">
            {d.recordings.map((r) => (
              <Tab key={r.id} id={r.id} className="tab">{name(r)}{r.isPrimary && ` (${t('dive.primary')})`}</Tab>
            ))}
          </TabList>
          {d.recordings.map((r) => (
            <TabPanel key={r.id} id={r.id} className="tab-panel">
              <div className="recording-bar">
                <Muted>{t('dive.primaryHint')}</Muted>
                <ActionMenu
                  label={t('dive.recordingActions')}
                  aria-label={t('common.forItem', { action: t('dive.recordingActions'), item: name(r) })}
                  variant="secondary"
                  actions={[
                    ...(r.isPrimary ? [] : [{ id: 'primary', label: t('dive.makePrimary'), onAction: () => makePrimary.mutate(r.id) }]),
                    { id: 'split', label: t('dive.splitOffMenu'), onAction: () => setSplitting(true) },
                  ]}
                />
              </div>
              {makePrimary.error && <Notice tone="danger">{errorText(makePrimary.error)}</Notice>}
              <RecordingDetails recording={r} />
            </TabPanel>
          ))}
        </Tabs>
      </div>
      <ConfirmDialog
        isOpen={splitting} onOpenChange={setSplitting}
        title={t('dive.splitOffTitle')} body={t('dive.splitOffBody')} confirmLabel={t('dive.splitOffConfirm')}
        onConfirm={() => splitOff.mutateAsync(recording.id)}
        onDone={() => requestAnimationFrame(() => focusHeading(content.current))}
      />
    </Panel>
  );
}

/** What one Recording's device says: dive mode, deco model, gases, temperatures, and the profile. */
function RecordingDetails({ recording }: { recording: DiveView['recordings'][number] }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const s = recording.summary;
  const gases = s.gases ?? [];
  return (
    <>
      <dl className="facts facts-small">
        {s.diveMode && <Fact label={t('dive.diveMode')}>{t(`vocabulary.diveMode.${s.diveMode}`)}</Fact>}
        {s.decoModel && (
          <Fact label={t('dive.decoModel')}>
            {t(`vocabulary.decoModel.${s.decoModel}`)}{s.gfLow !== undefined && `, GF ${s.gfLow}/${s.gfHigh}`}
          </Fact>
        )}
        {gases.length > 0 && (
          <Fact label={t('dive.gases')}>
            {gases.map((g) => gasName(g, t('dive.air')) + (g.circuit === 'diluent' ? ` (${t('vocabulary.circuit.diluent')})` : '')).join(', ')}
          </Fact>
        )}
        {s.waterType && <Fact label={t('dive.waterType')}>{t(`vocabulary.waterType.${s.waterType}`)}</Fact>}
        {s.minTemperatureC !== undefined && (
          <Fact label={t('dive.temperatureRange')}>
            {display.temperature(s.minTemperatureC)}
            {s.maxTemperatureC !== undefined && s.maxTemperatureC !== s.minTemperatureC && ` – ${display.temperature(s.maxTemperatureC)}`}
          </Fact>
        )}
      </dl>
      {s.extras && (
        <details className="extras">
          <summary>{t('dive.otherValues')}</summary>
          <dl>{Object.entries(s.extras).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </details>
      )}
      <ErrorBoundary key={recording.id} fallback={<Notice tone="danger">{t('dive.profileFailed')}</Notice>}>
        <DepthProfile recordingId={recording.id} />
      </ErrorBoundary>
    </>
  );
}

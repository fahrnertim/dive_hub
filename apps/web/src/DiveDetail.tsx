import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { api, diveQuery, diversQuery, keys, unwrap, type DiveView, type OverridableField, type RecordingSummary } from './api.ts';
import { DepthProfile } from './DepthProfile.tsx';
import { DiveEditForm } from './DiveEditForm.tsx';
import { DiveHistory } from './DiveHistory.tsx';
import { useDisplay, useErrorText } from './lib/display.ts';
import { deviceName } from './lib/devices.ts';
import { useFormatValue } from './lib/dive-values.ts';
import { Button, Dialog, ErrorBoundary, Muted, Notice, Panel, Select } from './ui/index.ts';

/** One Dive (ADR 0015): its values with Overrides marked, notes, Recordings, and its history. */
export function DiveDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const dive = useQuery(diveQuery(id));
  const divers = useQuery(diversQuery());
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);

  if (dive.isPending) return <Muted>{t('common.loading')}</Muted>;
  if (dive.error) return <Notice tone="danger">{errorText(dive.error)}</Notice>;
  const d = dive.data;
  const v = d.values;
  const title = v.number !== null ? t('dive.title', { number: v.number }) : t('dive.titleNoNumber');

  return (
    <>
      <p><a href="#/">{t('dive.back')}</a></p>
      <Panel
        title={<>{title}<span className="title-meta">{display.diveTime(v.startsAt.at, v.startsAt.utcOffsetSeconds)}<EditedMark dive={d} field="startsAt" /></span></>}
        actions={!editing && (
          <div className="form-actions">
            <Button onPress={() => setEditing(true)}>{t('dive.edit')}</Button>
            {(divers.data?.length ?? 0) > 1 && <Button variant="quiet" onPress={() => setMoving(true)}>{t('dive.moveTo')}</Button>}
          </div>
        )}
      >
        {(divers.data?.length ?? 0) > 1 && (
          <p className="muted">{t('dive.diver')}: {divers.data?.find((v) => v.id === d.diverId)?.name}</p>
        )}
        {editing
          ? <DiveEditForm key={d.version} dive={d} onDone={() => setEditing(false)} />
          : <DiveFacts dive={d} />}
      </Panel>
      <Recordings dive={d} />
      <DiveHistory dive={d} />
      {moving && <MoveDialog dive={d} onClose={() => setMoving(false)} />}
    </>
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
          <Button variant="primary" isDisabled={!target || move.isPending} onPress={() => target && move.mutate(target)}>{t('dive.move')}</Button>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** "edited" next to a value the User set by hand, with what the recording says. */
function EditedMark({ dive, field }: { dive: DiveView; field: OverridableField }) {
  const { t } = useTranslation();
  const format = useFormatValue();
  if (!dive.overrides.includes(field)) return null;
  return (
    <span className="badge" title={t('dive.editedHint', { value: format(field, dive.fromRecording?.[field]) })}>
      {t('dive.edited')}
    </span>
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
      <h3>{t('dive.notes')}</h3>
      {d.notes ? <p className="notes">{d.notes}</p> : <Muted>{t('dive.noNotes')}</Muted>}
    </>
  );
}

const gasName = (g: NonNullable<RecordingSummary['gases']>[number], air: string) =>
  g.he > 0 ? `${g.o2}/${g.he}` : g.o2 === 21 ? air : `EAN${g.o2}`;

/** The Recordings of the Dive: which one is primary, the device's own data and the profile. */
function Recordings({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const recording = d.recordings.find((r) => r.id === selected) ?? d.recordings.find((r) => r.isPrimary) ?? d.recordings[0];
  const splitOff = useMutation({
    mutationFn: async (recordingId: string) =>
      unwrap(await api.POST('/api/recordings/{id}/detach', { params: { path: { id: recordingId } }, body: { version: d.version } })),
    onSuccess: async () => {
      setSelected(undefined);
      await queryClient.invalidateQueries({ queryKey: keys.dives });
    },
  });
  const makePrimary = useMutation({
    mutationFn: async (recordingId: string) =>
      unwrap(await api.PUT('/api/dives/{id}/primary-recording', { params: { path: { id: d.id } }, body: { recordingId, version: d.version } })),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.dive(d.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.dives });
    },
  });
  if (!recording) return null;
  const s = recording.summary;
  const gases = s.gases ?? [];

  return (
    <Panel title={d.recordings.length > 1 ? t('dive.recordings') : t('dive.recording')}>
      {d.recordings.length > 1 && (
        <>
          <ToggleButtonGroup
            className="segmented"
            aria-label={t('dive.recordings')}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[recording.id]}
            onSelectionChange={(sel) => setSelected([...sel][0] as string)}
          >
            {d.recordings.map((r, i) => (
              <ToggleButton key={r.id} id={r.id} className="segment">
                {r.device ? `${deviceName(r.device.manufacturer, r.device.product)} (${r.device.serialNumber})` : t('dive.recordingN', { n: i + 1 })}
                {r.isPrimary && ` (${t('dive.primary')})`}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Muted>{t('dive.primaryHint')}</Muted>
          <div className="form-actions recording-actions">
            {!recording.isPrimary && (
              <Button isDisabled={makePrimary.isPending} onPress={() => makePrimary.mutate(recording.id)}>{t('dive.makePrimary')}</Button>
            )}
            <Button variant="quiet" isDisabled={splitOff.isPending} onPress={() => splitOff.mutate(recording.id)}>{t('dive.splitOff')}</Button>
          </div>
          <Muted>{t('dive.splitHint')}</Muted>
          {(makePrimary.error ?? splitOff.error) && <Notice tone="danger">{errorText(makePrimary.error ?? splitOff.error)}</Notice>}
        </>
      )}
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
    </Panel>
  );
}

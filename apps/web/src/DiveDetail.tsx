import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { api, ApiError, diveNeighboursQuery, diveProvidersQuery, PAGE_SIZE, diveQuery, diversQuery, keys, unwrap, type DiveView, type NeighboursView, type OverridableField, type RecordingSummary } from './api.ts';
import { AssessmentPanel, AssessmentProvider } from './Assessment.tsx';
import { DeleteDiveDialog } from './DeleteDive.tsx';
import { DepthProfile } from './DepthProfile.tsx';
import { DiveEditForm } from './DiveEditForm.tsx';
import { DiveHistory } from './DiveHistory.tsx';
import { MergeHint } from './MergeDive.tsx';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { deviceName } from './lib/devices.ts';
import { useFormatValue } from './lib/dive-values.ts';
import { focusFirstIn, focusHeading } from './lib/focus.ts';
import { mapsUrl } from './lib/geo.ts';
import { diveHref, listQuery, logbookHrefOf, logbookParams, mixName, neighbourParams } from './lib/logbook.ts';
import { usePageTitle } from './lib/page.ts';
import { useNames, useProviders } from './lib/providers.ts';
import { SitePicker } from './SitePicker.tsx';
import { Participants } from './Participants.tsx';
import { ProviderPanels } from './ProviderPanel.tsx';
import { ActionMenu, Button, ConfirmDialog, Dialog, ErrorBoundary, Icon, Muted, Notice, PageHeader, Panel, Select } from './ui/index.ts';

/** One Dive (ADR 0015): its values with Overrides marked, notes, Recordings, and its history. */
export function DiveDetail({ id, recordingId, list = '' }: { id: string; recordingId?: string | undefined; list?: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const dive = useQuery(diveQuery(id));
  const divers = useQuery(diversQuery());
  const neighbours = useQuery(diveNeighboursQuery(id, neighbourParams(logbookParams(new URLSearchParams(list)))));
  // "Logbook" goes back to the list as it was, on the page this Dive is on now (ADR 0042).
  const position = neighbours.data?.position;
  const logbook = logbookHrefOf(position ? listQuery({ ...logbookParams(new URLSearchParams(list)), page: Math.ceil(position / PAGE_SIZE) }) : list);
  // Editing opens at the dive number, or at the notes when asked for from there.
  const [editing, setEditing] = useState<false | 'values' | 'notes'>(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Closing the edit form puts focus back on "Edit dive" (the form had it; UI review B1).
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = !!editing;
  }, [editing]);
  const v = dive.data?.values;
  const notFound = dive.error instanceof ApiError && dive.error.status === 404;
  const title = !v ? (notFound ? t('dive.notFoundTitle') : undefined)
    : v.number !== null ? t('dive.title', { number: v.number }) : t('dive.titleNoNumber');
  usePageTitle(title);

  if (dive.isPending) return <DiveLoading />;
  if (notFound) {
    // Not an error to dismiss but a dead end to leave: say why and offer the way back (visual refresh 8).
    return (
      <>
        <PageHeader title={title} />
        <Panel>
          <div className="empty-state">
            <p>{errorText(dive.error)}</p>
            <a href={logbook} className="btn btn-secondary"><Icon name="back" />{t('dive.backToLogbook')}</a>
          </div>
        </Panel>
      </>
    );
  }
  if (dive.error) {
    return (
      <>
        <p><a href={logbook} className="back-link"><Icon name="back" />{t('dive.back')}</a></p>
        <Notice tone="danger">{errorText(dive.error)}</Notice>
      </>
    );
  }
  const d = dive.data;
  const several = (divers.data?.length ?? 0) > 1;
  const diverName = divers.data?.find((v) => v.id === d.diverId)?.name;

  return (
    <>
      <div className="dive-trail">
        <a href={logbook} className="back-link"><Icon name="back" />{t('dive.back')}</a>
        <Neighbours n={neighbours.data} list={list} />
      </div>
      <div className="dive-head">
        <PageHeader
          title={title}
          meta={(
            <>
              <p className="title-meta">
                {display.diveTime(d.values.startsAt.at, d.values.startsAt.utcOffsetSeconds, d.utcOffsetSource)}<EditedMark dive={d} field="startsAt" />
              </p>
              <TimeZoneNote dive={d} />
              {/* The Diver right under the date, before the actions wrap in on a phone (UI review C4). */}
              {several && diverName && <p className="title-meta">{t('dive.diver')}: {diverName}</p>}
            </>
          )}
          actions={!editing && (
            <>
              <Button ref={editButton} icon="edit" onPress={() => setEditing('values')}>{t('dive.edit')}</Button>
              <ActionMenu
                label={t('dive.moreActions')} aria-label={t('common.forItem', { action: t('dive.moreActions'), item: title ?? '' })}
                actions={[
                  ...(several ? [{ id: 'move', label: t('dive.moveTo'), icon: 'move' as const, onAction: () => setMoving(true) }] : []),
                  { id: 'delete', label: t('dive.deleteMenu'), icon: 'delete', onAction: () => setDeleting(true) },
                ]}
              />
            </>
          )}
        />
      </div>
      {!editing && <MergeHint dive={d} />}
      {/* The assessment belongs to the Primary recording's profile and to the panel under it (ADR 0036). */}
      <AssessmentProvider diveId={d.id}>
        {/* The dive's facts and its profile are one panel: the profile is on the first screen (UI redesign, slice A). */}
        <Panel>
          {editing
            ? <DiveEditForm key={d.version} dive={d} focus={editing === 'notes' ? 'notes' : undefined} onDone={() => setEditing(false)} />
            : <DiveFacts dive={d} onAddNotes={() => setEditing('notes')} />}
          <Recordings dive={d} initial={recordingId} list={list} />
        </Panel>
        <AssessmentPanel dive={d} diverName={diverName} />
      </AssessmentProvider>
      {/* What is looked at now and then is one line each, until it is opened. */}
      <div className="panel dive-lines">
        <ProviderPanels dive={d} diverName={diverName} />
        <DiveHistory dive={d} />
      </div>
      {moving && <MoveDialog dive={d} onClose={() => setMoving(false)} />}
      {deleting && <DeleteDiveDialog dive={d} name={d.values.number !== null ? t('dive.title', { number: d.values.number }) : display.diveTime(d.values.startsAt.at, d.values.startsAt.utcOffsetSeconds, d.utcOffsetSource)} onClose={() => setDeleting(false)} />}
    </>
  );
}

/**
 * Where the start's time zone came from, when not from the dive computer (ADR 0030): the dive's position, the Diver's
 * dives around it, or nothing (the time as it was logged). Not shown once the User set the start by hand.
 */
function TimeZoneNote({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  if (d.utcOffsetSource === 'device' || d.overrides.includes('startsAt')) return null;
  return <p className="title-meta">{t(`dive.timeZone.${d.utcOffsetSource}`)}</p>;
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

/**
 * Previous and next dive in the order of the list the User came from (UI redesign 2.4, ADR 0042). "Previous" is the row above
 * in that list, so with the newest first it is the newer dive. Not shown while the list doesn't show this Dive.
 */
function Neighbours({ n, list }: { n: NeighboursView | undefined; list: string }) {
  const { t } = useTranslation();
  if (!n || n.position === null) return null;
  const step = (to: { id: string } | null, label: string, icon: 'previous' | 'next') => {
    const inner = <><Icon name={icon} /><span className="neighbour-label">{label}</span></>;
    // At the end of the list the control stays, so the others don't move; it says it is unavailable.
    return to
      ? <a href={diveHref(to.id, list)} className="neighbour" rel={icon === 'previous' ? 'prev' : 'next'}>{inner}</a>
      : <span className="neighbour" aria-disabled="true">{inner}</span>;
  };
  return (
    <nav className="neighbours" aria-label={t('dive.neighbours')}>
      {step(n.previous, t('dive.previousDive'), 'previous')}
      <span className="neighbour-position num">{t('dive.positionInList', { position: n.position, total: n.total })}</span>
      {step(n.next, t('dive.nextDive'), 'next')}
    </nav>
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
  // A Dive linked to a Provider moves as a copy (ADR 0038): the dialog says so before it happens.
  const names = useNames();
  const providers = useProviders();
  const statuses = useQuery(diveProvidersQuery(d.id));
  const linkedAt = (statuses.data ?? []).filter((s) => s.current).map((s) => providers.data?.find((p) => p.id === s.provider)?.name ?? s.provider);
  const move = useMutation({
    mutationFn: async (diverId: string) =>
      unwrap(await api.POST('/api/dives/{id}/move', { params: { path: { id: d.id } }, body: { diverId, version: d.version } })),
    onSuccess: async (updated) => {
      queryClient.setQueryData(keys.dive(updated.id), updated);
      if (updated.id !== d.id) {
        // Moved as a copy: the Dive is another one now, and the old one only answers "not found".
        location.hash = `#/dives/${updated.id}`;
        queryClient.removeQueries({ queryKey: keys.dive(d.id) });
        await queryClient.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === 'dives' && q.queryKey[1] === d.id) });
        onClose();
        return;
      }
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      await queryClient.invalidateQueries({ queryKey: keys.revisions(d.id) });
      onClose();
    },
  });
  return (
    <Dialog title={t('dive.moveTitle')} isOpen onOpenChange={(open) => !open && onClose()}>
      <p>{t('dive.moveIntro')}</p>
      {linkedAt.length > 0 && <p>{t('dive.moveLinked', { name: names(linkedAt) })}</p>}
      <div className="form">
        <Select label={t('dive.diver')} value={target} onChange={setTarget} options={others.map((v) => ({ id: v.id, label: v.name }))} />
        {move.error && <Notice tone="danger">{errorText(move.error)}</Notice>}
        <div className="form-actions">
          <Button variant="primary" icon="move" isDisabled={!target} isPending={move.isPending} onPress={() => target && move.mutate(target)}>{t('dive.move')}</Button>
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

/** One value of the facts grid; `wide` for values that need two columns, such as a position. */
function Fact({ label, children, mark, wide }: { label: string; children: ReactNode; mark?: ReactNode; wide?: boolean }) {
  return <div {...(wide && { className: 'fact-wide' })}><dt>{label}</dt><dd>{children}{mark}</dd></div>;
}

/**
 * The Dive's water type is its site's (ADR 0025): shown here, set on the site. When the Primary recording's computer
 * was set to other water, a line says so and how far off its depths read (the client contract's duty).
 */
function WaterFact({ dive: d }: { dive: DiveView }) {
  const { t, i18n } = useTranslation();
  const m = d.waterMismatch;
  const note = m ? [
    t('dive.waterMismatch', { computer: t(`vocabulary.waterTypeInSentence.${m.computer}`), site: t(`vocabulary.waterTypeInSentence.${m.site}`) }),
    m.depthPercent === null ? t('dive.waterReadsOff')
      : t(m.depthPercent < 0 ? 'dive.waterReadsShallow' : 'dive.waterReadsDeep', {
        percent: new Intl.NumberFormat(i18n.language).format(Math.round(Math.abs(m.depthPercent))),
      }),
  ].join(' ')
    : !d.site ? t('dive.chooseSiteForWater')
    : !d.waterType ? t('dive.waterTypeUnknown')
    : t('dive.waterTypeFromSite');
  return (
    <Fact label={t('dive.waterType')} wide={!!m}>
      {d.waterType ? t(`vocabulary.waterType.${d.waterType}`) : t('common.none')}
      <span className="recorded-value">{note}</span>
    </Fact>
  );
}

/** The gases of a Recording by name: "Air", "EAN32", "18/45 (diluent)". */
function useGasNames() {
  const { t } = useTranslation();
  return (gases: RecordingSummary['gases']) =>
    (gases ?? []).map((g) => mixName(g, t('dive.air')) + (g.circuit === 'diluent' ? ` (${t('vocabulary.circuit.diluent')})` : '')).join(', ');
}

/**
 * What the Dive was: its values, the gas of the Primary recording, where, with whom, and the notes. Who dived along
 * and the notes are facts too; empty, each is the way to add them.
 */
function DiveFacts({ dive: d, onAddNotes }: { dive: DiveView; onAddNotes: () => void }) {
  const { t } = useTranslation();
  const format = useFormatValue();
  const display = useDisplay();
  const [picking, setPicking] = useState(false);
  const gases = useGasNames()(d.recordings.find((r) => r.isPrimary)?.summary.gases);
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
        {gases && <Fact label={t('dive.gas')}>{gases}</Fact>}
        <WaterFact dive={d} />
        <Fact label={t('dive.site')}>
          <span className="site-fact">
            {d.site ? <a href={`#/sites/${d.site.id}`}>{d.site.name}</a> : t('common.none')}
            <Button variant="quiet" size="small" icon="site" onPress={() => setPicking(true)}>
              {d.site ? t('dive.changeSite') : t('dive.chooseSite')}
            </Button>
          </span>
        </Fact>
        {d.position && (
          <Fact label={t('dive.position')} wide>
            {display.position(d.position)}{' '}
            <a href={mapsUrl(d.position)} target="_blank" rel="noopener noreferrer" className="external-link">
              {t('sites.openInMaps')}<Icon name="external" />
            </a>
          </Fact>
        )}
        <Participants dive={d} />
        {!d.notes && (
          <Fact label={t('dive.notes')}>
            <Button variant="quiet" size="small" icon="add" onPress={onAddNotes}>{t('dive.addNotes')}</Button>
          </Fact>
        )}
      </dl>
      {picking && <SitePicker dive={d} onClose={() => setPicking(false)} />}
      {d.notes && (
        <>
          <h2 className="subheading">{t('dive.notes')}</h2>
          <p className="notes">{d.notes}</p>
        </>
      )}
    </>
  );
}

/**
 * The Recordings of the Dive, in the panel of its facts: the profile, and under it what recorded it. Several are tabs
 * that say which one is primary. The tab is in the address (?recording=…), and the actions on a Recording are in a
 * menu (UI review C3). The heading is for heading navigation only: the chart is seen as one without a title.
 */
function Recordings({ dive: d, initial, list }: { dive: DiveView; initial: string | undefined; list: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(initial);
  const [splitting, setSplitting] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const recording = d.recordings.find((r) => r.id === selected) ?? d.recordings.find((r) => r.isPrimary) ?? d.recordings[0];
  const select = (id: string) => {
    setSelected(id);
    history.replaceState(null, '', diveHref(d.id, list, id));
  };
  const splitOff = useMutation({
    mutationFn: async (recordingId: string) =>
      unwrap(await api.POST('/api/recordings/{id}/detach', { params: { path: { id: recordingId } }, body: { version: d.version } })),
    onSuccess: async () => {
      setSelected(undefined);
      history.replaceState(null, '', diveHref(d.id, list));
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
  if (!recording) return <NoRecording dive={d} />;
  const name = (r: DiveView['recordings'][number]) => (r.device
    ? `${deviceName(r.device.manufacturer, r.device.product)} (${r.device.serialNumber})`
    : t('dive.recordingN', { n: d.recordings.indexOf(r) + 1 }));

  if (d.recordings.length === 1) {
    return (
      <div className="dive-recording">
        <h2 className="visually-hidden">{t('dive.recording')}</h2>
        <RecordingDetails recording={recording} named />
      </div>
    );
  }
  return (
    <div className="dive-recording">
      <h2 className="visually-hidden">{t('dive.recordings')}</h2>
      <div ref={content}>
        <Tabs selectedKey={recording.id} onSelectionChange={(key) => select(String(key))}>
          <TabList aria-label={t('dive.recordings')} className="tab-list">
            {d.recordings.map((r) => (
              <Tab key={r.id} id={r.id} className="tab"><span translate="no">{name(r)}</span>{r.isPrimary && ` (${t('dive.primary')})`}</Tab>
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
                    ...(r.isPrimary ? [] : [{ id: 'primary', label: t('dive.makePrimary'), icon: 'primary' as const, onAction: () => makePrimary.mutate(r.id) }]),
                    { id: 'split', label: t('dive.splitOffMenu'), icon: 'splitOff', onAction: () => setSplitting(true) },
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
        onDone={() => requestAnimationFrame(() => { if (!focusFirstIn(content.current?.querySelector('[role="tablist"]'))) focusHeading(); })}
      />
    </div>
  );
}

/**
 * A Dive without a Recording (ADR 0030): made from a Provider's logbook entry, typed by hand there. Its values are that
 * entry's until a dive computer's file comes in; then its Recording becomes primary and its values take over.
 */
function NoRecording({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  const providers = useProviders();
  const name = providers.data?.find((x) => x.id === d.fromProvider)?.name ?? d.fromProvider;
  return (
    <div className="dive-recording">
      <h2 className="visually-hidden">{t('dive.recording')}</h2>
      <div className="empty-state">
        <p>{name ? t('dive.noRecordingFrom', { name }) : t('dive.noRecording')}</p>
        <Muted>{t('dive.noRecordingNext')}</Muted>
      </div>
    </div>
  );
}

/**
 * One Recording: its profile, and under it one line that says what recorded it (the device when no tab names it, the
 * dive mode, the deco model). Everything else the device says is a step away, as the profile's table is.
 */
function RecordingDetails({ recording, named }: { recording: DiveView['recordings'][number]; named?: boolean }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const gases = useGasNames()(recording.summary.gases);
  const s = recording.summary;
  const mode = s.diveMode && t(`vocabulary.diveMode.${s.diveMode}`);
  const deco = s.decoModel && `${t(`vocabulary.decoModel.${s.decoModel}`)}${s.gfLow !== undefined ? `, GF ${s.gfLow}/${s.gfHigh}` : ''}`;
  const device = named && recording.device && `${deviceName(recording.device.manufacturer, recording.device.product)} (${recording.device.serialNumber})`;
  const values: [string, string][] = [];
  if (mode) values.push([t('dive.diveMode'), mode]);
  if (deco) values.push([t('dive.decoModel'), deco]);
  if (gases) values.push([t('dive.gases'), gases]);
  // The computer's setting, not the Dive's water (that is the site's, ADR 0025).
  if (s.waterType) {
    values.push([t('dive.computerWater'), t(`vocabulary.waterType.${s.waterType}`)
      + (s.waterDensity !== undefined && s.waterType !== 'en13319' ? ` (${new Intl.NumberFormat(display.locale).format(s.waterDensity)} kg/m³)` : '')]);
  }
  if (s.minTemperatureC !== undefined) {
    values.push([t('dive.temperatureRange'), display.temperature(s.minTemperatureC)
      + (s.maxTemperatureC !== undefined && s.maxTemperatureC !== s.minTemperatureC ? ` – ${display.temperature(s.maxTemperatureC)}` : '')]);
  }
  const about = (
    <>
      {(device || mode || deco) && (
        <ul className="recording-line">
          {device && <li translate="no">{device}</li>}
          {mode && <li>{mode}</li>}
          {deco && <li>{deco}</li>}
        </ul>
      )}
      {(values.length > 0 || s.extras) && (
        <details className="extras">
          <summary>{t('dive.allValues')}</summary>
          <dl>
            {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            {Object.entries(s.extras ?? {}).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </details>
      )}
    </>
  );
  return (
    <ErrorBoundary key={recording.id} fallback={<><Notice tone="danger">{t('dive.profileFailed')}</Notice>{about}</>}>
      <DepthProfile recordingId={recording.id}>{about}</DepthProfile>
    </ErrorBoundary>
  );
}

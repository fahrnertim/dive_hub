import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { api, candidatesQuery, keys, logbookChecksQuery, unwrap, type CandidateView, type LogbookCheckView } from './api.ts';
import { AnsweredChecks, LogbookChecks } from './LogbookChecks.tsx';
import { deviceName } from './lib/devices.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { refocusAfterRemoval } from './lib/focus.ts';
import { Button, Muted, Notice, Panel } from './ui/index.ts';

/**
 * What waits for the User on the logbook. Duplicate candidates (ADR 0016): Recordings that don't clearly belong to one
 * Dive, with the Dives they might belong to and the three decisions. Logbook checks (ADR 0038): pairs of Dives at the
 * same time. Hidden when nothing waits.
 */
export function Decisions() {
  const { t } = useTranslation();
  const open = useQuery(candidatesQuery('open'));
  const discarded = useQuery(candidatesQuery('discarded'));
  const [showDiscarded, setShowDiscarded] = useState(false);
  // The Recording just discarded, offered back with "Undo" (UI review B2).
  const [undo, setUndo] = useState<CandidateView>();
  const list = useRef<HTMLUListElement>(null);
  const count = open.data?.length ?? 0;
  const checks = useQuery(logbookChecksQuery('open')).data?.length ?? 0;
  const [keptApart, setKeptApart] = useState<LogbookCheckView>();
  // Offered only while that Recording is still discarded (it may be decided again another way).
  const undoable = undo && discarded.data?.some((c) => c.id === undo.id) ? undo : undefined;
  const undoNotice = undoable && <UndoDiscard key={undoable.id} candidate={undoable} onDone={() => setUndo(undefined)} />;

  if (count === 0 && checks === 0 && !showDiscarded) {
    return (
      <div className="decisions-quiet">
        {undoNotice}
        {/* A pair just kept as two dives is offered back here; then only the ways to decide again are left. */}
        <LogbookChecks undo={keptApart} setUndo={setKeptApart} />
        {(discarded.data?.length ?? 0) > 0 && <Button variant="quiet" onPress={() => setShowDiscarded(true)}>{t('decisions.showDiscarded')}</Button>}
        <AnsweredChecks />
      </div>
    );
  }
  return (
    <Panel title={t('decisions.title')} attention={count + checks > 0}>
      {count > 0 && <p>{t('decisions.intro', { count })}</p>}
      {undoNotice}
      <ul className="decisions" ref={list}>
        {open.data?.map((c, index) => (
          <Decision key={c.id} candidate={c} list={list} index={index} count={count} onDiscarded={() => setUndo(c)} />
        ))}
      </ul>
      <LogbookChecks undo={keptApart} setUndo={setKeptApart} />
      {showDiscarded ? <Discarded onHide={() => setShowDiscarded(false)} /> : (discarded.data?.length ?? 0) > 0 && (
        <Button variant="quiet" onPress={() => setShowDiscarded(true)}>{t('decisions.showDiscarded')}</Button>
      )}
      <AnsweredChecks />
    </Panel>
  );
}

function RecordingLine({ c }: { c: CandidateView }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const r = c.recording;
  const device = r.device
    ? t('decisions.device', { name: deviceName(r.device.manufacturer, r.device.product), serial: r.device.serialNumber })
    : t('decisions.unknownDevice');
  return (
    <div className="decision-recording">
      <p>
        <strong>{t('decisions.recording')}:</strong>{' '}
        {display.diveTime(r.startsAt, r.utcOffsetSeconds, r.utcOffsetSource)} · {display.depth(r.maxDepthM)} · {display.duration(r.durationSeconds)} · {device}
      </p>
      {/* Why it wasn't added: a sentence of its own, at body size (visual refresh 4). */}
      <p className="muted">{t('decisions.why', { reason: t(`import.reason.${c.reason}`) })}</p>
    </div>
  );
}

/**
 * The decisions about one Duplicate candidate. The candidate leaves its list afterwards; focus then
 * goes to the next one, else the panel or page heading (UI review B1).
 */
type Action = { kind: 'attach'; diveId: string } | { kind: 'new-dive' | 'discard' | 'reopen' };

function useDecide(c: CandidateView, refocus?: (action: Action) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: Action) => {
      const path = { params: { path: { id: c.id } } };
      switch (action.kind) {
        case 'attach': return unwrap(await api.POST('/api/duplicate-candidates/{id}/attach', { ...path, body: { diveId: action.diveId } }));
        case 'new-dive': return unwrap(await api.POST('/api/duplicate-candidates/{id}/new-dive', path));
        case 'discard': return unwrap(await api.POST('/api/duplicate-candidates/{id}/discard', path));
        case 'reopen': return unwrap(await api.POST('/api/duplicate-candidates/{id}/reopen', path));
      }
    },
    onSettled: async (_data, error, action) => {
      await queryClient.invalidateQueries({ queryKey: ['candidates'] });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      if (!error) refocus?.(action);
    },
  });
}

/** "Discarded the recording from …" with a way back. Takes focus: the Discard button is gone. */
function UndoDiscard({ candidate: c, onDone }: { candidate: CandidateView; onDone: () => void }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const reopen = useDecide(c);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <Notice tone="success">
      <p>{t('decisions.discardedNotice', { time: display.diveTime(c.recording.startsAt, c.recording.utcOffsetSeconds, c.recording.utcOffsetSource) })}</p>
      <Button ref={button} icon="undo" isPending={reopen.isPending} onPress={() => reopen.mutate({ kind: 'reopen' }, { onSuccess: onDone })}>
        {t('common.undo')}
      </Button>
    </Notice>
  );
}

function Decision({ candidate: c, list, index, count, onDiscarded }: {
  candidate: CandidateView; list: RefObject<HTMLUListElement | null>; index: number; count: number; onDiscarded: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const decide = useDecide(c, (action) => {
    if (action.kind === 'discard') onDiscarded(); // the Undo notice takes focus
    else refocusAfterRemoval(list.current, index, count);
  });
  // Several Recordings may wait at once; their buttons say which one they decide about.
  const recordingName = display.diveTime(c.recording.startsAt, c.recording.utcOffsetSeconds, c.recording.utcOffsetSource);
  return (
    <li className="decision">
      <RecordingLine c={c} />
      {/* The Dives it might belong to were deleted (ADR 0026): what's left is a Dive of its own, or discarding it. */}
      {c.dives.length === 0 && <p className="muted">{t('decisions.divesGone')}</p>}
      {c.dives.length > 0 && (
        <div>
          <h3 className="decision-subtitle">{t('decisions.maybe')}</h3>
          <ul className="decision-dives">
            {c.dives.map((d) => (
              <li key={d.id} className="decision-dive">
                <span>
                  <a href={`#/dives/${d.id}`}>
                    {d.number !== null ? t('dive.title', { number: d.number }) : t('dive.titleNoNumber')}
                  </a>
                  {' · '}{display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource)} · {display.depth(d.maxDepthM)} · {display.duration(d.durationSeconds)}
                </span>
                <Button
                  size="small"
                  aria-label={t('common.forItem', { action: t('decisions.addTo'), item: d.number !== null ? t('dive.title', { number: d.number }) : display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource) })}
                  isPending={decide.isPending && decide.variables.kind === 'attach' && decide.variables.diveId === d.id}
                  isDisabled={decide.isPending}
                  onPress={() => decide.mutate({ kind: 'attach', diveId: d.id })}
                >
                  {t('decisions.addTo')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="form-actions">
        <Button
          icon="add" aria-label={t('common.forItem', { action: t('decisions.newDive'), item: recordingName })}
          isPending={decide.isPending && decide.variables.kind === 'new-dive'} isDisabled={decide.isPending}
          onPress={() => decide.mutate({ kind: 'new-dive' })}
        >
          {t('decisions.newDive')}
        </Button>
        <Button
          variant="quiet" aria-label={t('common.forItem', { action: t('decisions.discard'), item: recordingName })}
          isPending={decide.isPending && decide.variables.kind === 'discard'} isDisabled={decide.isPending}
          onPress={() => decide.mutate({ kind: 'discard' })}
        >
          {t('decisions.discard')}
        </Button>
      </div>
      {decide.error && <Notice tone="danger">{errorText(decide.error)}</Notice>}
    </li>
  );
}

function Discarded({ onHide }: { onHide: () => void }) {
  const { t } = useTranslation();
  const discarded = useQuery(candidatesQuery('discarded'));
  const list = useRef<HTMLUListElement>(null);
  const count = discarded.data?.length ?? 0;
  return (
    <section className="discarded">
      <h3>{t('decisions.discarded')}</h3>
      {discarded.data?.length === 0 && <Muted>{t('decisions.none')}</Muted>}
      <ul className="decisions" ref={list}>
        {discarded.data?.map((c, index) => (
          <DiscardedItem key={c.id} candidate={c} onReopened={() => refocusAfterRemoval(list.current, index, count)} />
        ))}
      </ul>
      <Button variant="quiet" onPress={onHide}>{t('decisions.hideDiscarded')}</Button>
    </section>
  );
}

function DiscardedItem({ candidate: c, onReopened }: { candidate: CandidateView; onReopened: () => void }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const decide = useDecide(c, onReopened);
  return (
    <li className="decision">
      <RecordingLine c={c} />
      <Button
        variant="quiet"
        aria-label={t('common.forItem', { action: t('decisions.reopen'), item: display.diveTime(c.recording.startsAt, c.recording.utcOffsetSeconds, c.recording.utcOffsetSource) })}
        isPending={decide.isPending}
        onPress={() => decide.mutate({ kind: 'reopen' })}
      >
        {t('decisions.reopen')}
      </Button>
    </li>
  );
}

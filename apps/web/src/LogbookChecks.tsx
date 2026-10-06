import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { api, diversQuery, keys, logbookChecksQuery, unwrap, type LogbookCheckView } from './api.ts';
import { MergeDialog } from './MergeDive.tsx';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { refocusAfterRemoval } from './lib/focus.ts';
import { Button, ConfirmButton, Muted, Notice } from './ui/index.ts';

type Paired = LogbookCheckView['dive'];
const keyOf = (c: LogbookCheckView) => `${c.dive.id}:${c.other.id}`;

/** "Dive 9", or the Dive's time when it has no number. */
function useDiveName() {
  const { t } = useTranslation();
  const display = useDisplay();
  return (d: Paired) => (d.number !== null ? t('dive.title', { number: d.number }) : display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource));
}

/**
 * Answers a check. `onAnswered` runs before the lists are read again: the pair's row, and with it the button pressed,
 * is gone by then, and a callback given to `mutate` would no longer be called.
 */
function useAnswer(onAnswered?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ check: c, answer }: { check: LogbookCheckView; answer: 'two_dives' | null }) =>
      unwrap(await api.PUT('/api/logbook-checks/answer', { body: { diveIds: [c.dive.id, c.other.id], answer } })),
    onSuccess: () => onAnswered?.(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.dives }),
  });
}

/**
 * Logbook checks in "Needs your decision" (ADR 0038): pairs of Dives at the same time, each with the ways to resolve
 * it. Nothing merges unasked; the pairs an import would have put together by itself can be merged in one go.
 */
export function LogbookChecks({ undo, setUndo }: {
  /** The pair just kept as two dives, offered back with "Undo"; kept by the panel, which is rebuilt when nothing waits. */
  undo: LogbookCheckView | undefined; setUndo: (check: LogbookCheckView | undefined) => void;
}) {
  const { t } = useTranslation();
  const open = useQuery(logbookChecksQuery('open'));
  const answered = useQuery(logbookChecksQuery('answered'));
  const list = useRef<HTMLUListElement>(null);
  const checks = open.data ?? [];
  const undoable = undo && answered.data?.some((c) => keyOf(c) === keyOf(undo)) ? undo : undefined;
  if (checks.length === 0 && !undoable) return null;
  return (
    <>
      {checks.length > 0 && <p>{t('checks.intro', { count: checks.length })}</p>}
      {undoable && <UndoAnswer key={keyOf(undoable)} check={undoable} onDone={() => setUndo(undefined)} />}
      <ul className="decisions" ref={list}>
        {checks.map((c, index) => <Check key={keyOf(c)} check={c} list={list} index={index} count={checks.length} onAnswered={() => setUndo(c)} />)}
      </ul>
      <MergeObvious checks={checks.filter((c) => c.obvious)} />
    </>
  );
}

function DiveLine({ dive: d, showDiver }: { dive: Paired; showDiver: string | undefined }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const facts = [
    display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource), display.depth(d.maxDepthM), display.duration(d.durationSeconds), d.site?.name,
    d.recordings > 0 ? t('merge.withRecording') : t('merge.withoutRecording'), showDiver,
  ].filter(Boolean);
  return (
    <li className="decision-dive">
      <span>
        <a href={`#/dives/${d.id}`}>{d.number !== null ? t('dive.title', { number: d.number }) : t('dive.titleNoNumber')}</a>
        {' · '}{facts.join(' · ')}
      </span>
    </li>
  );
}

function Check({ check: c, list, index, count, onAnswered }: {
  check: LogbookCheckView; list: RefObject<HTMLUListElement | null>; index: number; count: number; onAnswered: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const divers = useQuery(diversQuery());
  const nameOf = useDiveName();
  const [merging, setMerging] = useState(false);
  const answer = useAnswer(onAnswered);
  const diver = (divers.data?.length ?? 0) > 1 ? divers.data?.find((v) => v.id === c.diverId)?.name : undefined;
  // Several pairs may wait at once; their buttons say which one they decide about.
  const pair = t('checks.pair', { first: nameOf(c.dive), second: nameOf(c.other) });
  return (
    <li className="decision">
      <div className="decision-recording">
        <p><strong>{t(`checks.rule.${c.rule}`)}</strong></p>
        <p className="muted">{t('checks.how')}</p>
      </div>
      <ul className="decision-dives">
        <DiveLine dive={c.dive} showDiver={diver} />
        <DiveLine dive={c.other} showDiver={diver} />
      </ul>
      <div className="form-actions">
        <Button icon="merge" aria-label={t('common.forItem', { action: t('checks.merge'), item: pair })} isDisabled={answer.isPending} onPress={() => setMerging(true)}>
          {t('checks.merge')}
        </Button>
        <Button
          variant="quiet" aria-label={t('common.forItem', { action: t('checks.twoDives'), item: pair })} isPending={answer.isPending}
          onPress={() => answer.mutate({ check: c, answer: 'two_dives' })}
        >
          {t('checks.twoDives')}
        </Button>
      </div>
      {answer.error && <Notice tone="danger">{errorText(answer.error)}</Notice>}
      {merging && (
        <MergeDialog
          dive={c.dive} other={c.other} stay
          onClose={() => setMerging(false)} onMerged={() => refocusAfterRemoval(list.current, index, count)}
        />
      )}
    </li>
  );
}

/** "Kept as two dives" with a way back. Takes focus: the button pressed is gone with its pair. */
function UndoAnswer({ check: c, onDone }: { check: LogbookCheckView; onDone: () => void }) {
  const { t } = useTranslation();
  const answer = useAnswer(onDone);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <Notice tone="success">
      <p>{t('checks.keptApart')}</p>
      <Button ref={button} icon="undo" isPending={answer.isPending} onPress={() => answer.mutate({ check: c, answer: null })}>
        {t('common.undo')}
      </Button>
    </Notice>
  );
}

/**
 * Merges every pair an import would have put together by itself, after saying what that means (ADR 0038). Offered from
 * two such pairs on; one is merged with its own button.
 */
function MergeObvious({ checks }: { checks: LogbookCheckView[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  if (checks.length < 2) return null;
  const mergeAll = async () => {
    try {
      for (const c of checks) {
        unwrap(await api.POST('/api/dives/{id}/merge', { params: { path: { id: c.dive.id } }, body: { version: c.dive.version, otherId: c.other.id, otherVersion: c.other.version } }));
      }
      announce(t('checks.mergedAll', { count: checks.length }));
    } finally {
      await queryClient.invalidateQueries();
    }
  };
  return (
    <ConfirmButton
      icon="merge" title={t('checks.mergeAllTitle', { count: checks.length })} body={t('checks.mergeAllBody')}
      confirmLabel={t('checks.mergeAllConfirm', { count: checks.length })} onConfirm={mergeAll} tone="primary"
    >
      {t('checks.mergeAll', { count: checks.length })}
    </ConfirmButton>
  );
}

/** The pairs the User said are two dives, to be asked about again; hidden while there are none. */
export function AnsweredChecks() {
  const { t } = useTranslation();
  const answered = useQuery(logbookChecksQuery('answered'));
  const nameOf = useDiveName();
  const answer = useAnswer();
  const [shown, setShown] = useState(false);
  const pairs = answered.data ?? [];
  if (pairs.length === 0) return null;
  if (!shown) return <Button variant="quiet" onPress={() => setShown(true)}>{t('checks.showAnswered')}</Button>;
  return (
    <section className="discarded">
      <h3>{t('checks.answered')}</h3>
      <Muted>{t('checks.answeredIntro')}</Muted>
      <ul className="decisions">
        {pairs.map((c) => {
          const pair = t('checks.pair', { first: nameOf(c.dive), second: nameOf(c.other) });
          return (
            <li key={keyOf(c)} className="decision">
              <ul className="decision-dives">
                <DiveLine dive={c.dive} showDiver={undefined} />
                <DiveLine dive={c.other} showDiver={undefined} />
              </ul>
              <Button
                variant="quiet" aria-label={t('common.forItem', { action: t('checks.askAgain'), item: pair })}
                isPending={answer.isPending && answer.variables.check === c} onPress={() => answer.mutate({ check: c, answer: null })}
              >
                {t('checks.askAgain')}
              </Button>
            </li>
          );
        })}
      </ul>
      <Button variant="quiet" onPress={() => setShown(false)}>{t('checks.hideAnswered')}</Button>
    </section>
  );
}

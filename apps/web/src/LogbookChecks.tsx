import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { api, diversQuery, keys, logbookChecksQuery, unwrap, type LogbookCheckView } from './api.ts';
import { MergeDialog } from './MergeDive.tsx';
import { differingFacts } from './lib/review.ts';
import { Candidates, CandidateRow, type Fact } from './ReviewRows.tsx';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { refocusAfterRemoval } from './lib/focus.ts';
import { Badge, Button, ConfirmButton, Muted, Notice, Panel } from './ui/index.ts';

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

/** What a Dive says on a row; the first four are compared with the other Dive of the pair. */
function useDiveFacts() {
  const { t } = useTranslation();
  const display = useDisplay();
  return (d: Paired, showDiver?: string) => {
    const values = {
      time: display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource), depth: display.depth(d.maxDepthM),
      duration: display.duration(d.durationSeconds), site: d.site?.name,
    };
    const facts: Fact[] = [
      ...Object.entries(values).map(([key, text]) => ({ key, text })),
      { key: 'recording', text: d.recordings > 0 ? t('merge.withRecording') : t('merge.withoutRecording') }, { key: 'diver', text: showDiver },
    ];
    return { values, facts };
  };
}

/** The two Dives of a pair side by side, what differs between them marked; `stays` marks the one a merge keeps (ADR 0038). */
function PairRows({ check: c, showDiver, stays }: { check: LogbookCheckView; showDiver: string | undefined; stays: boolean }) {
  const { t } = useTranslation();
  const diveFacts = useDiveFacts();
  const first = diveFacts(c.dive, showDiver);
  const second = diveFacts(c.other, showDiver);
  const marked = differingFacts(first.values, second.values);
  const row = (d: Paired, facts: Fact[]) => (
    <CandidateRow
      key={d.id} facts={facts} marked={marked}
      title={<a className="candidate-title" href={`#/dives/${d.id}`}>{d.number !== null ? t('dive.title', { number: d.number }) : t('dive.titleNoNumber')}</a>}
      badge={stays && c.other.keeps === d.id ? <Badge>{t('checks.stays')}</Badge> : undefined}
    />
  );
  return <Candidates>{row(c.dive, first.facts)}{row(c.other, second.facts)}</Candidates>;
}

/**
 * Logbook checks on the Review page (ADR 0038): pairs of Dives at the same time, in one group that explains itself once,
 * each pair with the ways to resolve it. Nothing merges unasked; the pairs an import would have put together by itself
 * can be merged in one go.
 */
export function PairDecisions() {
  const { t } = useTranslation();
  const open = useQuery(logbookChecksQuery('open'));
  const answered = useQuery(logbookChecksQuery('answered'));
  // The pair just kept as two dives, offered back with "Undo".
  const [undo, setUndo] = useState<LogbookCheckView>();
  const list = useRef<HTMLUListElement>(null);
  const checks = open.data ?? [];
  const undoable = undo && answered.data?.some((c) => keyOf(c) === keyOf(undo)) ? undo : undefined;
  return (
    <>
      {undoable && <UndoAnswer key={keyOf(undoable)} check={undoable} onDone={() => setUndo(undefined)} />}
      {checks.length > 0 && (
        <Panel title={t('checks.title')} attention actions={<MergeObvious checks={checks.filter((c) => c.obvious)} />}>
          <p className="muted">{t('checks.how')}</p>
          <ul className="decisions" ref={list}>
            {checks.map((c, index) => <Check key={keyOf(c)} check={c} list={list} index={index} count={checks.length} onAnswered={() => setUndo(c)} ruleShown={new Set(checks.map((x) => x.rule)).size > 1} />)}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Check({ check: c, list, index, count, onAnswered, ruleShown }: {
  check: LogbookCheckView; list: RefObject<HTMLUListElement | null>; index: number; count: number; onAnswered: () => void;
  /** The group holds different kinds of pairs: each says which it is, else the group's head says it for all. */
  ruleShown: boolean;
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
      {ruleShown && <p className="muted">{t(`checks.rule.${c.rule}`)}</p>}
      <PairRows check={c} showDiver={diver} stays />
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

/** The pairs the User said are two dives, to be asked about again (the Review page's "Decided"). Nothing while there are none. */
export function AnsweredChecks() {
  const { t } = useTranslation();
  const answered = useQuery(logbookChecksQuery('answered'));
  const nameOf = useDiveName();
  const answer = useAnswer();
  const pairs = answered.data ?? [];
  if (pairs.length === 0) return null;
  return (
    <Panel title={t('checks.answered')}>
      <Muted>{t('checks.answeredIntro')}</Muted>
      <ul className="decisions">
        {pairs.map((c) => {
          const pair = t('checks.pair', { first: nameOf(c.dive), second: nameOf(c.other) });
          return (
            <li key={keyOf(c)} className="decision">
              <PairRows check={c} showDiver={undefined} stays={false} />
              <div className="form-actions">
                <Button
                  variant="quiet" aria-label={t('common.forItem', { action: t('checks.askAgain'), item: pair })}
                  isPending={answer.isPending && answer.variables.check === c} onPress={() => answer.mutate({ check: c, answer: null })}
                >
                  {t('checks.askAgain')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

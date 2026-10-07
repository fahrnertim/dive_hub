import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, assessmentQuery, keys, unwrap, type AssessmentView, type DiveView } from './api.ts';
import { clock, counts, differing, hidden, informing, shown, stretch, summaryKey, summaryValues, type Finding, type Rule } from './lib/assessment.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { refocusAfterRemoval } from './lib/focus.ts';
import { Badge, Button, ConfirmButton, Dialog, Disclosure, Muted, Notice, Panel } from './ui/index.ts';

/**
 * The Dive's assessment for everything on the dive page that shows it (ADR 0036): the panel with the findings, and
 * the Primary recording's profile, which is coloured by ascent speed and carries the findings' time lane. A finding
 * is one row in the panel, with its details behind it. The one shown on the profile (`selected`) is the one opened
 * last, or the one whose bar was chosen in the lane: that opens its row, and closes none.
 */
interface AssessmentState {
  assessment: AssessmentView | undefined;
  selected: Rule | null;
  /** From the lane: show this finding on the profile and open its row; null takes the highlight off. */
  select: (rule: Rule | null) => void;
  /** Rows whose details are open. */
  open: ReadonlySet<Rule>;
  setOpen: (rule: Rule, open: boolean) => void;
  /** Whether the line that holds the findings told for information only is open. */
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
}
const AssessmentContext = createContext<AssessmentState>({
  assessment: undefined, selected: null, select: () => {}, open: new Set(), setOpen: () => {}, moreOpen: false, setMoreOpen: () => {},
});
export const useAssessment = () => useContext(AssessmentContext);

const rowId = (rule: Rule) => `finding-${rule}`;

export function AssessmentProvider({ diveId, children }: { diveId: string; children: ReactNode }) {
  const assessment = useQuery(assessmentQuery(diveId));
  const [selected, setSelected] = useState<Rule | null>(null);
  const [open, setOpenRules] = useState<ReadonlySet<Rule>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const findings = assessment.data?.findings;
  const setOpen = useCallback((rule: Rule, isOpen: boolean) => {
    setOpenRules((rules) => {
      const next = new Set(rules);
      if (isOpen) next.add(rule); else next.delete(rule);
      return next;
    });
    const onProfile = findings?.some((f) => f.rule === rule && f.startSeconds !== null);
    setSelected((now) => (isOpen ? (onProfile ? rule : now) : now === rule ? null : now));
  }, [findings]);
  const select = useCallback((rule: Rule | null) => {
    setSelected(rule);
    if (!rule) return;
    setOpenRules((rules) => new Set(rules).add(rule));
    if (findings?.find((f) => f.rule === rule)?.severity === 'info') setMoreOpen(true);
    // The row can be below the screen's edge: bring it in, moving the page as little as that takes.
    requestAnimationFrame(() => document.getElementById(rowId(rule))?.scrollIntoView({ block: 'nearest' }));
  }, [findings]);
  const value = useMemo(
    () => ({ assessment: assessment.data, selected, select, open, setOpen, moreOpen, setMoreOpen }),
    [assessment.data, selected, select, open, setOpen, moreOpen],
  );
  return <AssessmentContext value={value}>{children}</AssessmentContext>;
}

/** When a finding's stretch is: "Minute 13:20 to 16:02", or the whole dive. */
function useWhen() {
  const { t } = useTranslation();
  return (f: Pick<Finding, 'startSeconds' | 'endSeconds'>) => (f.startSeconds === null ? t('assessment.atWhole')
    : f.endSeconds === null || f.endSeconds - f.startSeconds < 1 ? t('assessment.atPoint', { from: clock(f.startSeconds) })
      : t('assessment.at', { from: clock(f.startSeconds), to: clock(f.endSeconds) }));
}

/**
 * What was found, in the User's units: the whole sentence (`summary`), or the short one a finding's row shows under
 * its title (`short`), which leaves out what the title already says.
 */
function useSummary(length: 'summary' | 'short' = 'summary') {
  const { t } = useTranslation();
  const display = useDisplay();
  return (f: Finding) => t(`assessment.${length}.${summaryKey(f)}` as 'assessment.summary.sawtooth', summaryValues(f, display.units, display.locale));
}

/**
 * Under the profile: one bar per finding at its place in the dive (ADR 0036's time lane). A bar is a button that
 * shows its stretch on the profile and opens its row in the panel below, which has the words. `left` and `width`
 * position the lane over the chart's plot area, in pixels.
 */
export function FindingLane({ totalSeconds, plot }: { totalSeconds: number; plot: { left: number; width: number } | null }) {
  const { t } = useTranslation();
  const { assessment, selected, select } = useAssessment();
  const when = useWhen();
  const placed = shown(assessment?.findings ?? []).filter((f) => f.startSeconds !== null);
  if (placed.length === 0 || !plot) return null;
  return (
    <div className="finding-lane" role="group" aria-label={t('assessment.lane')} style={{ marginLeft: plot.left, width: plot.width }}>
      {placed.map((f) => {
        const { left, width } = stretch(f.startSeconds!, f.endSeconds ?? f.startSeconds!, totalSeconds);
        const title = t(`assessment.title.${f.rule}`);
        return (
          <div key={f.rule} className="finding-lane-row">
            <button
              type="button" className="finding-chip" data-severity={f.severity} aria-pressed={selected === f.rule}
              aria-label={t('assessment.details', { title, when: when(f) })}
              style={{ left: `${left}%`, width: `${width}%` }}
              onClick={() => select(selected === f.rule ? null : f.rule)}
            />
            <span className="finding-chip-label" aria-hidden="true" data-side={left > 55 ? 'before' : 'after'} style={left > 55 ? { right: `${100 - left}%` } : { left: `${left + width}%` }}>
              {title}
            </span>
          </div>
        );
      })}
      <p className="visually-hidden">{t('assessment.laneHint')}</p>
    </div>
  );
}

/**
 * The Dive's assessment in words. The head counts; each finding is a row with its numbers, and its guidance, sources
 * and actions behind it; those told for information only wait behind one line that names them. Then the no-fly time,
 * what the computer noted, and the fixed note.
 */
export function AssessmentPanel({ dive, diverName }: { dive: DiveView; diverName: string | undefined }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const { assessment: a, moreOpen, setMoreOpen } = useAssessment();
  const main = useRef<HTMLUListElement>(null);
  const more = useRef<HTMLUListElement>(null);
  if (!a) return null;
  const differ = differing(a.findings);
  const info = informing(a.findings);
  const aside = hidden(a.findings);
  const count = counts(a.findings);
  const said = { differ: t('assessment.count.differ', { count: count.differ }), info: t('assessment.count.info', { count: count.info }) };
  const head = !a.applies ? null
    : count.differ > 0 && count.info > 0 ? t('assessment.count.both', said)
    : count.differ > 0 ? said.differ : count.info > 0 ? said.info : null;
  const names = new Intl.ListFormat(display.locale, { type: 'unit', style: 'short' }).format(info.map((f) => t(`assessment.title.${f.rule}`)));
  const items = (list: Finding[], ref: RefObject<HTMLUListElement | null>) => (
    <ul className="findings" ref={ref}>
      {list.map((f, i) => <FindingItem key={f.rule} dive={dive} finding={f} diverName={diverName} list={ref} index={i} of={list.length} />)}
    </ul>
  );
  return (
    <Panel title={t('assessment.panel')} actions={head && <span className="meta">{head}</span>}>
      <div className="assessment">
        {!a.applies ? <Muted>{t('assessment.notCovered')}</Muted> : (
          <>
            {!a.current && <Notice tone="info">{t('assessment.pending')}</Notice>}
            {differ.length === 0 && info.length === 0 && <p>{t('assessment.none')}</p>}
            {differ.length > 0 && items(differ, main)}
            {info.length > 0 && (
              <Disclosure
                className="findings-more" isExpanded={moreOpen} onExpandedChange={setMoreOpen}
                title={t(differ.length > 0 ? 'assessment.more' : 'assessment.moreOnly', { count: info.length, names })}
              >
                {items(info, more)}
              </Disclosure>
            )}
            {a.sampleIntervalSeconds !== null && a.sampleIntervalSeconds >= 5 && (
              <Muted>{t('assessment.sampling', { seconds: new Intl.NumberFormat().format(a.sampleIntervalSeconds) })}</Muted>
            )}
            {aside.length > 0 && (
              <details className="extras">
                <summary>{t('assessment.hiddenTitle', { count: aside.length })}</summary>
                <ul className="findings findings-aside">
                  {aside.map((f) => <AsideItem key={f.rule} dive={dive} finding={f} diverName={diverName} />)}
                </ul>
              </details>
            )}
          </>
        )}
        {/* DAN's no-fly time: good to know after a day's last dive, and nothing the diver did, so not a finding. */}
        {a.noFly && (
          <p className="assessment-line">
            <Trans
              i18nKey={`assessment.noFly.${a.noFly.reason}`} components={{ b: <strong /> }}
              values={{ hours: a.noFly.hours, until: display.dateTime(a.noFly.until) }}
            />
            {' '}<a href={a.noFly.source.url} target="_blank" rel="noopener noreferrer" lang="en" className="meta">{a.noFly.source.title}</a>
          </p>
        )}
        {a.computerEvents.length > 0 && (
          <div className="assessment-part">
            <h3 className="subheading">{t('assessment.computer')}</h3>
            <Muted>{t('assessment.computerLead')}</Muted>
            <ul className="computer-events">
              {a.computerEvents.map((e) => (
                <li key={`${e.atSeconds}-${e.event}`}><span className="meta">{t('assessment.eventAt', { at: clock(e.atSeconds) })}</span> {t(`assessment.event.${e.event}`)}</li>
              ))}
            </ul>
          </div>
        )}
        <FixedNote noFly={a.noFly !== null} />
      </div>
    </Panel>
  );
}

/**
 * The note that stands under every assessment (ADR 0036, as amended 2026-10-07): two sentences in the panel, and the
 * full text one step away, with what an assessment is and what the no-fly time rests on.
 */
function FixedNote({ noFly }: { noFly: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="assessment-note">
        {t('assessment.noteShort')}{' '}
        <Button variant="quiet" size="small" onPress={() => setOpen(true)}>{t('assessment.aboutLink')}</Button>
      </p>
      <Dialog title={t('assessment.aboutLink')} isOpen={open} onOpenChange={setOpen}>
        <div className="assessment-about">
          <p>{t('assessment.aboutWhat')}</p>
          <p>{t('assessment.note')}</p>
          {noFly && <p><strong>{t('assessment.noFly.title')}</strong><br />{t('assessment.noFly.guidance')}</p>}
          <div className="form-actions">
            <Button onPress={() => setOpen(false)}>{t('common.done')}</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** Mutations on a Dive's findings; each answers with the assessment as it is then. */
function useFindingActions(dive: DiveView) {
  const queryClient = useQueryClient();
  const refreshList = () => queryClient.invalidateQueries({ queryKey: keys.dives, refetchType: 'none' });
  const dismiss = useMutation({
    mutationFn: async ({ rule, dismissed }: { rule: Rule; dismissed: boolean }) => unwrap(await api.PUT('/api/dives/{id}/findings/{rule}/dismissal', {
      params: { path: { id: dive.id, rule } }, body: { dismissed },
    })),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.assessment(dive.id), updated);
      void refreshList();
    },
  });
  const mute = useMutation({
    mutationFn: async ({ rule, muted }: { rule: Rule; muted: boolean }) => unwrap(await api.PUT('/api/divers/{id}/muted-rules/{rule}', {
      params: { path: { id: dive.diverId, rule } }, body: { muted },
    })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.assessment(dive.id) });
      void refreshList();
      // The Divers page lists what is muted.
      void queryClient.invalidateQueries({ queryKey: keys.divers });
    },
  });
  return { dismiss, mute };
}

/**
 * One finding: a row with its title, severity, the short sentence with the numbers and when it was. Behind it the
 * guidance with how well founded it is, what to do next time, the sources, and the two ways to put it aside.
 * `list`, `index` and `of` say where it is in its list, for where focus goes once it is put aside.
 */
function FindingItem({ dive, finding: f, diverName, list, index, of }: {
  dive: DiveView; finding: Finding; diverName: string | undefined; list: RefObject<HTMLUListElement | null>; index: number; of: number;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const { selected, open, setOpen } = useAssessment();
  const when = useWhen();
  const summary = useSummary();
  const short = useSummary('short');
  const { dismiss, mute } = useFindingActions(dive);
  const title = t(`assessment.title.${f.rule}`);
  const diver = diverName ?? t('dive.diver');
  const evidence = new Intl.ListFormat(display.locale, { type: 'conjunction' }).format(f.evidence.map((e) => t(`assessment.evidence.${e}`)));
  const gone = (said: string) => {
    setOpen(f.rule, false);
    announce(said);
    refocusAfterRemoval(list.current, index, of);
  };
  return (
    <li id={rowId(f.rule)} className="finding" data-selected={selected === f.rule || undefined}>
      <Disclosure
        level={3} title={title} isExpanded={open.has(f.rule)} onExpandedChange={(isOpen) => setOpen(f.rule, isOpen)}
        summary={(
          <>
            <Badge>{t(`assessment.severity.${f.severity}`)}</Badge>
            {/* The short sentence for the eye; a screen reader gets the whole one. */}
            <span className="finding-short" aria-hidden="true">{short(f)}</span>
            <span className="visually-hidden">{summary(f)}</span>
            <span className="finding-when">{when(f)}{selected === f.rule && <span className="visually-hidden">, {t('assessment.selected')}</span>}</span>
          </>
        )}
      >
        <div className="finding-body">
          <dl className="finding-facts">
            <div><dt>{t('assessment.guidanceLabel')}</dt><dd>{t(`assessment.guidance.${f.rule}`)} <span className="muted">{t('assessment.basedOn', { evidence })}</span></dd></div>
            <div><dt>{t('assessment.recommendationLabel')}</dt><dd>{t(`assessment.recommendation.${f.rule}`)}</dd></div>
            <div>
              <dt>{t('assessment.sourcesLabel')}</dt>
              <dd>
                <ul className="finding-sources">
                  {f.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" lang="en">{s.title}</a></li>)}
                </ul>
              </dd>
            </div>
          </dl>
          {(dismiss.error ?? mute.error) && <Notice tone="danger">{errorText(dismiss.error ?? mute.error)}</Notice>}
          <div className="form-actions">
            <Button
              size="small" aria-label={t('common.forItem', { action: t('assessment.dismiss'), item: title })}
              isPending={dismiss.isPending}
              onPress={() => dismiss.mutate({ rule: f.rule, dismissed: true }, { onSuccess: () => gone(t('assessment.dismissed', { title })) })}
            >
              {t('assessment.dismiss')}
            </Button>
            <ConfirmButton
              variant="quiet" size="small" tone="primary" aria-label={t('common.forItem', { action: t('assessment.mute', { diver }), item: title })}
              title={t('assessment.muteTitle', { title, diver })} body={t('assessment.muteBody', { diver })} confirmLabel={t('assessment.muteConfirm')}
              onConfirm={() => mute.mutateAsync({ rule: f.rule, muted: true })} onDone={() => gone(t('assessment.muted', { title, diver }))}
            >
              {t('assessment.mute', { diver })}
            </ConfirmButton>
          </div>
        </div>
      </Disclosure>
    </li>
  );
}

/** A finding the User put aside: what it says in one line, why it is hidden, and the way back. */
function AsideItem({ dive, finding: f, diverName }: { dive: DiveView; finding: Finding; diverName: string | undefined }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const summary = useSummary();
  const { dismiss, mute } = useFindingActions(dive);
  const title = t(`assessment.title.${f.rule}`);
  const diver = diverName ?? t('dive.diver');
  const restore = async () => {
    if (f.muted) await mute.mutateAsync({ rule: f.rule, muted: false });
    if (f.dismissed) await dismiss.mutateAsync({ rule: f.rule, dismissed: false });
    announce(t('assessment.restored', { title }));
  };
  return (
    <li className="finding finding-aside">
      <div className="finding-head">
        <h3 className="finding-title">{title}</h3>
        <span className="meta">{f.muted ? t('assessment.mutedMark', { diver }) : t('assessment.dismissedMark')}</span>
      </div>
      <p>{summary(f)}</p>
      {(dismiss.error ?? mute.error) && <Notice tone="danger">{errorText(dismiss.error ?? mute.error)}</Notice>}
      <div className="form-actions">
        <Button size="small" aria-label={t('common.forItem', { action: t('assessment.restore'), item: title })} isPending={dismiss.isPending || mute.isPending} onPress={() => void restore()}>
          {t('assessment.restore')}
        </Button>
      </div>
    </li>
  );
}

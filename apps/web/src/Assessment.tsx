import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, assessmentQuery, keys, unwrap, type AssessmentView, type DiveView } from './api.ts';
import { clock, hidden, shown, stretch, summaryKey, summaryValues, type Finding, type Rule } from './lib/assessment.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Badge, Button, ConfirmButton, Muted, Notice, Panel } from './ui/index.ts';

/**
 * The Dive's assessment for everything on the dive page that shows it (ADR 0036): the panel with the findings, and
 * the Primary recording's profile, which is coloured by ascent speed and carries the findings' time lane. Selecting a
 * finding in one highlights it in the other.
 */
interface AssessmentState {
  assessment: AssessmentView | undefined;
  selected: Rule | null;
  select: (rule: Rule | null) => void;
}
const AssessmentContext = createContext<AssessmentState>({ assessment: undefined, selected: null, select: () => {} });
export const useAssessment = () => useContext(AssessmentContext);

export function AssessmentProvider({ diveId, children }: { diveId: string; children: ReactNode }) {
  const assessment = useQuery(assessmentQuery(diveId));
  const [selected, select] = useState<Rule | null>(null);
  const value = useMemo(() => ({ assessment: assessment.data, selected, select }), [assessment.data, selected]);
  return <AssessmentContext value={value}>{children}</AssessmentContext>;
}

/** When a finding's stretch is: "Minute 13:20 to 16:02", or the whole dive. */
function useWhen() {
  const { t } = useTranslation();
  return (f: Pick<Finding, 'startSeconds' | 'endSeconds'>) => (f.startSeconds === null ? t('assessment.atWhole')
    : f.endSeconds === null || f.endSeconds - f.startSeconds < 1 ? t('assessment.atPoint', { from: clock(f.startSeconds) })
      : t('assessment.at', { from: clock(f.startSeconds), to: clock(f.endSeconds) }));
}

/** The sentence that says what was found, in the User's units. */
function useSummary() {
  const { t } = useTranslation();
  const display = useDisplay();
  return (f: Finding) => t(`assessment.summary.${summaryKey(f)}` as 'assessment.summary.sawtooth', summaryValues(f, display.units, display.locale));
}

/**
 * Under the profile: one bar per finding at its place in the dive (ADR 0036's time lane). A bar is a button that
 * shows its stretch on the profile; the panel below has the words. `left` and `width` position the lane over the
 * chart's plot area, in pixels.
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

/** The Dive's assessment in words: the findings with their guidance and sources, what the computer noted, the fixed note. */
export function AssessmentPanel({ dive, diverName }: { dive: DiveView; diverName: string | undefined }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const { assessment: a } = useAssessment();
  if (!a) return null;
  const visible = shown(a.findings);
  const aside = hidden(a.findings);
  return (
    <Panel title={t('assessment.panel')}>
      <div className="assessment">
        {!a.applies ? <Muted>{t('assessment.notCovered')}</Muted> : (
          <>
            <Muted>{t('assessment.lead')}</Muted>
            {!a.current && <Notice tone="info">{t('assessment.pending')}</Notice>}
            {visible.length === 0 ? <p>{t('assessment.none')}</p> : (
              <ul className="findings">
                {visible.map((f) => <FindingItem key={f.rule} dive={dive} finding={f} diverName={diverName} />)}
              </ul>
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
          <div className="assessment-part">
            <h3 className="subheading">{t('assessment.noFly.title')}</h3>
            <p>{t(`assessment.noFly.${a.noFly.reason}`, { hours: a.noFly.hours, until: display.dateTime(a.noFly.until) })}</p>
            <Muted>{t('assessment.noFly.guidance')} <a href={a.noFly.source.url} target="_blank" rel="noopener noreferrer" lang="en">{a.noFly.source.title}</a></Muted>
          </div>
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
        <p className="assessment-note">{t('assessment.note')}</p>
      </div>
    </Panel>
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

function FindingItem({ dive, finding: f, diverName }: { dive: DiveView; finding: Finding; diverName: string | undefined }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { selected, select } = useAssessment();
  const when = useWhen();
  const summary = useSummary();
  const { dismiss, mute } = useFindingActions(dive);
  const title = t(`assessment.title.${f.rule}`);
  const diver = diverName ?? t('dive.diver');
  const onProfile = f.startSeconds !== null;
  return (
    <li className="finding" data-selected={selected === f.rule || undefined}>
      <div className="finding-head">
        <h3 className="finding-title">{title}</h3>
        <Badge>{t(`assessment.severity.${f.severity}`)}</Badge>
        {onProfile
          ? (
            <button type="button" className="finding-when" aria-pressed={selected === f.rule} onClick={() => select(selected === f.rule ? null : f.rule)}>
              {when(f)}<span className="visually-hidden">: {title}{selected === f.rule && `, ${t('assessment.selected')}`}</span>
            </button>
          )
          : <span className="meta">{when(f)}</span>}
      </div>
      <p>{summary(f)}</p>
      <dl className="finding-facts">
        <div><dt>{t('assessment.guidanceLabel')}</dt><dd>{t(`assessment.guidance.${f.rule}`)}</dd></div>
        <div><dt>{t('assessment.evidenceLabel')}</dt><dd>{f.evidence.map((e) => t(`assessment.evidence.${e}`)).join(', ')}</dd></div>
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
          onPress={() => dismiss.mutate({ rule: f.rule, dismissed: true }, { onSuccess: () => { select(null); announce(t('assessment.dismissed', { title })); } })}
        >
          {t('assessment.dismiss')}
        </Button>
        <ConfirmButton
          variant="quiet" size="small" tone="primary" aria-label={t('common.forItem', { action: t('assessment.mute', { diver }), item: title })}
          title={t('assessment.muteTitle', { title, diver })} body={t('assessment.muteBody', { diver })} confirmLabel={t('assessment.muteConfirm')}
          onConfirm={() => mute.mutateAsync({ rule: f.rule, muted: true }).then(() => { select(null); announce(t('assessment.muted', { title, diver })); })}
        >
          {t('assessment.mute', { diver })}
        </ConfirmButton>
      </div>
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
    <li className="finding">
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

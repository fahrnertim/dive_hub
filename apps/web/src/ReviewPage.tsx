import { useTranslation } from 'react-i18next';
import { DeletedDives } from './DeletedDives.tsx';
import { DiscardedRecordings, RecordingDecisions } from './Decisions.tsx';
import { ImportHistory } from './ImportPanel.tsx';
import { AnsweredChecks, PairDecisions } from './LogbookChecks.tsx';
import { usePageTitle } from './lib/page.ts';
import { reviewHref, REVIEW_TABS, useReviewCounts, useWaiting, type ReviewTab } from './lib/review.ts';
import { Muted, PageHeader } from './ui/index.ts';

/**
 * Tidying the logbook (UI redesign 4.2): what waits for a decision, the Imports, what was decided and the deleted dives,
 * in parts of one page. The part is in the address, so a reload and a link keep it.
 */
export function ReviewPage({ tab }: { tab: ReviewTab }) {
  const { t } = useTranslation();
  const waiting = useWaiting();
  usePageTitle(t('review.title'));
  return (
    <>
      <PageHeader title={t('review.title')} meta={<p className="back"><a href="#/">‹ {t('nav.logbook')}</a></p>} />
      <nav className="subnav" aria-label={t('review.parts')}>
        {REVIEW_TABS.map((id) => (
          <a key={id} href={reviewHref(id)} {...(id === tab && { 'aria-current': 'page' as const })}>
            {t(`review.tab.${id}`)}
            {/* The count of what waits only; the others are lists to look at, not a duty. */}
            {id === 'decide' && waiting.total > 0 && <>{' '}<span className="count">{waiting.total}</span></>}
          </a>
        ))}
      </nav>
      {tab === 'decide' && <ToDecide />}
      {tab === 'imports' && <ImportHistory />}
      {tab === 'decided' && <Decided />}
      {tab === 'deleted' && <Deleted />}
    </>
  );
}

function ToDecide() {
  const { t } = useTranslation();
  const { total } = useWaiting();
  return (
    <>
      <PairDecisions />
      <RecordingDecisions />
      {total === 0 && <Muted>{t('review.nothingWaits')}</Muted>}
    </>
  );
}

function Decided() {
  const { t } = useTranslation();
  const { decided } = useReviewCounts();
  return (
    <>
      <DiscardedRecordings />
      <AnsweredChecks />
      {decided === 0 && <Muted>{t('review.nothingDecided')}</Muted>}
    </>
  );
}

function Deleted() {
  const { t } = useTranslation();
  const { deleted } = useReviewCounts();
  return (
    <>
      <DeletedDives />
      {deleted === 0 && <Muted>{t('review.nothingDeleted')}</Muted>}
    </>
  );
}

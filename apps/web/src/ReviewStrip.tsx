import { useTranslation } from 'react-i18next';
import { reviewHref, useReviewCounts, useWaiting } from './lib/review.ts';
import { LinkButton } from './ui/index.ts';

/**
 * On the logbook, one line for what waits for a decision, with the way to the Review page (UI redesign 4.1). Nothing
 * while nothing waits. The decisions themselves are on that page: one place, one behaviour.
 */
export function ReviewStrip() {
  const { t, i18n } = useTranslation();
  const { recordings, pairs, total } = useWaiting();
  if (total === 0) return null;
  const parts = [
    ...(recordings > 0 ? [t('review.strip.recordings', { count: recordings })] : []),
    ...(pairs > 0 ? [t('review.strip.pairs', { count: pairs })] : []),
  ];
  const list = new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(parts);
  return (
    <div className="strip">
      <p>{t('review.strip.things', { count: total, parts: list })}</p>
      <LinkButton size="small" href={reviewHref('decide')}>{t('review.strip.go')}</LinkButton>
    </div>
  );
}

/** Under the logbook: the other parts of the Review page, for those who look for them there. Nothing while they are empty. */
export function ReviewLinks() {
  const { t } = useTranslation();
  const { decided, deleted } = useReviewCounts();
  return (
    <nav className="review-links" aria-label={t('review.title')}>
      <a href={reviewHref('imports')}>{t('review.tab.imports')}</a>
      {decided > 0 && <a href={reviewHref('decided')}>{t('review.tab.decided')} ({decided})</a>}
      {deleted > 0 && <a href={reviewHref('deleted')}>{t('review.tab.deleted')} ({deleted})</a>}
    </nav>
  );
}

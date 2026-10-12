import { useTranslation } from 'react-i18next';
import { useProviders } from './lib/providers.ts';
import { reviewHref, useReviewCounts, useWaiting } from './lib/review.ts';
import { LinkButton } from './ui/index.ts';

/**
 * On the logbook, one line for what waits for a decision, with the way to the Review page (UI redesign 4.1). Nothing
 * while nothing waits. The decisions themselves are on that page: one place, one behaviour.
 */
export function ReviewStrip() {
  const { t, i18n } = useTranslation();
  const { recordings, pairs, shortDives, goneAt, total } = useWaiting();
  const providers = useProviders();
  if (total === 0) return null;
  const parts = [
    ...(recordings > 0 ? [t('review.strip.recordings', { count: recordings })] : []),
    ...(pairs > 0 ? [t('review.strip.pairs', { count: pairs })] : []),
    ...(shortDives > 0 ? [t('review.strip.shortDives', { count: shortDives })] : []),
    ...Object.entries(goneAt).map(([id, count]) => t('review.strip.gone', { count, name: providers.data?.find((p) => p.id === id)?.name ?? id })),
  ];
  const list = new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(parts);
  return (
    <div className="strip">
      <p>{t('review.strip.things', { count: total, parts: list })}</p>
      <LinkButton size="small" href={reviewHref('decide')}>{t('review.strip.go')}</LinkButton>
    </div>
  );
}

/**
 * Above the logbook's list: the other parts of the Review page, always there for those who look for them (UI review C9).
 * What was decided is a link only while there is something in it; the Imports and the deleted dives are always one.
 */
export function ReviewLinks() {
  const { t } = useTranslation();
  const { decided, deleted } = useReviewCounts();
  return (
    <nav className="review-links" aria-label={t('review.title')}>
      <a href={reviewHref('imports')}>{t('review.tab.imports')}</a>
      {decided > 0 && <a href={reviewHref('decided')}>{t('review.tab.decided')} ({decided})</a>}
      <a href={reviewHref('deleted')}>{t('review.tab.deleted')}{deleted > 0 && <> ({deleted})</>}</a>
    </nav>
  );
}

import { useTranslation } from 'react-i18next';
import { useProviders } from './lib/providers.ts';
import { reviewHref, useReviewCounts, useToDecideCounts } from './lib/review.ts';
import { ActionMenu } from './ui/index.ts';

/**
 * On the logbook, one line for what waits for a decision, with the way to the Review page (UI redesign 4.1). Nothing
 * while nothing waits. The decisions themselves are on that page: one place, one behaviour.
 */
export function ReviewStrip() {
  const { t, i18n } = useTranslation();
  const { recordings, pairs, surfaceBreaks, shortDives, goneAt, conflicts, exists, total } = useToDecideCounts();
  const providers = useProviders();
  if (total === 0) return null;
  const parts = [
    ...(recordings > 0 ? [t('review.strip.recordings', { count: recordings })] : []),
    ...(pairs > 0 ? [t('review.strip.pairs', { count: pairs })] : []),
    ...(surfaceBreaks > 0 ? [t('review.strip.surfaceBreaks', { count: surfaceBreaks })] : []),
    ...(shortDives > 0 ? [t('review.strip.shortDives', { count: shortDives })] : []),
    ...Object.entries(goneAt).map(([id, count]) => t('review.strip.gone', { count, name: providers.data?.find((p) => p.id === id)?.name ?? id })),
    ...(conflicts > 0 ? [t('review.strip.conflicts', { count: conflicts })] : []),
    ...(exists > 0 ? [t('review.strip.exists', { count: exists })] : []),
  ];
  const list = new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(parts);
  return (
    <div className="strip">
      <p>{t('review.strip.things', { count: total, parts: list })}</p>
      <a href={reviewHref('decide')}>{t('review.strip.go')}</a>
    </div>
  );
}

/**
 * The other parts of the Review page, one step away behind More in the logbook's title row (UI review C9), always there
 * for those who look for them. What was decided is an item only while there is something in it; the Imports and the
 * deleted dives always are one.
 */
export function ReviewMore() {
  const { t } = useTranslation();
  const { decided, deleted } = useReviewCounts();
  return (
    <ActionMenu
      label={t('logbook.more')}
      actions={[
        { id: 'imports', label: t('review.tab.imports'), href: reviewHref('imports') },
        ...(decided > 0 ? [{ id: 'decided', label: `${t('review.tab.decided')} (${decided})`, href: reviewHref('decided') }] : []),
        { id: 'deleted', label: `${t('review.tab.deleted')}${deleted > 0 ? ` (${deleted})` : ''}`, href: reviewHref('deleted') },
      ]}
    />
  );
}

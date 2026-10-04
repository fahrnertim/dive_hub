import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { siteRevisionsQuery, type SiteRevisionView, type SiteView } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Button, Muted, Notice, Panel } from './ui/index.ts';

/** Entries shown before "Show the whole history". */
const LATEST = 3;

/** Lines in the order of the site's form; the database keeps a Revision's fields in its own order. */
const ORDER = ['name', 'country', 'waterBody', 'position', 'maxDepthM', 'ssiSiteId', 'description', 'osmId', 'wikidataId'];
const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);

const asPosition = (v: unknown) => v as { latitude: number; longitude: number } | null;

/**
 * Who or what changed the Dive site, when, and from what to what (ADR 0021). Other Users are never
 * named (ADR 0020); a Site import is named by its Sources.
 */
export function SiteHistory({ site }: { site: SiteView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const revisions = useQuery(siteRevisionsQuery(site.id));
  const [showAll, setShowAll] = useState(false);
  const entries = revisions.data ?? [];
  return (
    <Panel title={t('history.title')}>
      {revisions.error && <Notice tone="danger">{errorText(revisions.error)}</Notice>}
      {revisions.data?.length === 0 && <Muted>{t('history.empty')}</Muted>}
      {entries.length > 0 && (
        <ol className="history">
          {(showAll ? entries : entries.slice(0, LATEST)).map((r) => <Entry key={r.id} revision={r} />)}
        </ol>
      )}
      {entries.length > LATEST && (
        <Button variant="quiet" onPress={() => setShowAll(!showAll)}>{showAll ? t('history.showFewer') : t('history.showAll')}</Button>
      )}
    </Panel>
  );
}

function Entry({ revision: r }: { revision: SiteRevisionView }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const who = r.actor.type === 'site_import' ? t('siteHistory.by.siteImport', { sources: r.actor.name ?? '' })
    : r.actor.type === 'you' ? t('siteHistory.by.you')
    : r.actor.type === 'user' ? t('siteHistory.by.user')
    : t('history.by.system');
  const none = t('common.none');
  const show = (key: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return none;
    if (key === 'position') return display.position(asPosition(v)!);
    if (key === 'country') return display.country(String(v));
    if (key === 'maxDepthM') return display.depth(Number(v));
    return String(v);
  };
  const lines = Object.entries(r.changes).sort(([a], [b]) => rank(a) - rank(b)).flatMap(([key, { from, to }]) => {
    if (key === 'deletedAt') return [];
    if (key === 'description') return [t('siteHistory.descriptionChanged')];
    const field = t(`siteHistory.field.${key}`, { defaultValue: key });
    // A new site lists only what it was created with.
    if (r.cause === 'create') return to === null ? [] : [t('history.changeTo', { field, value: show(key, to) })];
    return [t('history.change', { field, from: show(key, from), to: show(key, to) })];
  });

  return (
    <li>
      <div className="history-head">
        <strong>{t(`siteHistory.cause.${r.cause}`, { defaultValue: t(`history.cause.${r.cause}`) })}</strong>
        <span className="meta">{display.dateTime(r.at)} · {who}</span>
      </div>
      {lines.length > 0 && <ul className="history-changes">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>}
    </li>
  );
}

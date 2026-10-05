import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { siteRevisionsQuery, type SiteRevisionView, type SiteView } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Button, Muted, Notice, Panel } from './ui/index.ts';

/** Entries shown before "Show the whole history". */
const LATEST = 3;

/** Lines in the order of the site's form; the database keeps a Revision's fields in its own order. */
const ORDER = ['mergedSite', 'mergedInto', 'adopted', 'name', 'country', 'waterBody', 'position', 'waterType', 'maxDepthM', 'ssiSiteId', 'description', 'osmId', 'wikidataId'];
const WATER_TYPES = ['fresh', 'salt', 'brackish'] as const;
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
    const water = key === 'waterType' && WATER_TYPES.find((w) => w === v);
    if (water) return t(`vocabulary.waterType.${water}`);
    return typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v);
  };
  const lines = Object.entries(r.changes).sort(([a], [b]) => rank(a) - rank(b)).flatMap(([key, { from, to }]) => {
    if (key === 'deletedAt') return [];
    // A site created without a description has nothing to say about it.
    if (key === 'description') return r.cause === 'create' && to === null ? [] : [t('siteHistory.descriptionChanged')];
    // Merging (ADR 0022): the other site by the name it had then.
    if (key === 'mergedSite') return [t('siteHistory.mergedIn', { name: (to as { name: string }).name })];
    if (key === 'mergedInto') return [t('siteHistory.mergedInto', { name: (to as { name: string }).name })];
    // Taking up a Source's offer (ADR 0025).
    if (key === 'adopted') {
      const source = (to as { source: 'osm' | 'wikidata' | 'ssi' }).source;
      return [t('siteHistory.adopted', { source: t(`siteImport.sourceName.${source}`) })];
    }
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

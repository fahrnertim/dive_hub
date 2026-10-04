import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, keys, meQuery, siteQuery, sitesQuery, unwrap, type ExternalIdView, type SiteView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { mapsUrl } from './lib/geo.ts';
import { logbookHref } from './lib/logbook.ts';
import { usePageTitle } from './lib/page.ts';
import { countryOptions } from './lib/geo.ts';
import { needsOsmAttribution, siteOrigin } from './lib/site-origin.ts';
import { SITES_PAGE, sitesHref, type SiteSort, type SitesParams } from './lib/sites-list.ts';
import { SiteForm } from './SiteForm.tsx';
import { SiteHistory } from './SiteHistory.tsx';
import { ActionMenu, Button, Checkbox, ConfirmDialog, Icon, Muted, Notice, PageHeader, Panel, Select, Table, TextField } from './ui/index.ts';

/** "Egypt · Red Sea": where a site is, in words. */
function useSitePlace() {
  const display = useDisplay();
  return (s: Pick<SiteView, 'country' | 'waterBody'>) =>
    [s.country && display.country(s.country), s.waterBody].filter(Boolean).join(' · ');
}

/** The credit OpenStreetMap's license asks for wherever its data is shown (ADR 0021). */
function OsmAttribution({ attribution }: { attribution: { text: string; url: string } }) {
  const { t } = useTranslation();
  return (
    <p className="meta attribution">
      {t('sites.containsOsm')}{' '}
      <a href={attribution.url} target="_blank" rel="noopener noreferrer" className="external-link">{attribution.text}<Icon name="external" /></a>
    </p>
  );
}

const ALL_COUNTRIES = 'all';

/**
 * The instance's Dive sites (ADR 0020), a page at a time: searched, filtered by country and by the User's own
 * dives, sorted by column (ADR 0022). The settings live in the address; new sites are created here.
 */
export function SitesPage({ params }: { params: SitesParams }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const place = useSitePlace();
  usePageTitle(t('sites.title'));
  const [creating, setCreating] = useState(false);
  const sites = useQuery(sitesQuery(params));
  const any = useQuery(sitesQuery());
  const me = useQuery(meQuery());
  const newButton = useRef<HTMLButtonElement>(null);
  const close = () => { setCreating(false); requestAnimationFrame(() => newButton.current?.focus()); };
  const go = (changes: Partial<SitesParams>) => { location.hash = sitesHref({ ...params, ...changes, page: undefined }); };

  // Typing searches after a short pause; the address is replaced, not added to the history.
  const [text, setText] = useState(params.q ?? '');
  useEffect(() => {
    if (text.trim() === (params.q ?? '')) return;
    const timer = setTimeout(() => location.replace(sitesHref({ ...params, q: text.trim() || undefined, page: undefined })), 300);
    return () => clearTimeout(timer);
  }, [text, params]);

  const page = params.page ?? 1;
  const total = sites.data?.total ?? 0;
  const pages = Math.ceil(total / SITES_PAGE);
  const range = t('sites.range', { from: total === 0 ? 0 : (page - 1) * SITES_PAGE + 1, to: Math.min(page * SITES_PAGE, total), count: total });
  // Reaching the first or last page disables the button just pressed; focus moves to the other one.
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const goTo = (target: number) => {
    location.hash = sitesHref({ ...params, page: target });
    if (target <= 1) requestAnimationFrame(() => next.current?.focus());
    else if (target >= pages) requestAnimationFrame(() => previous.current?.focus());
  };
  const shownPage = useRef(page);
  useEffect(() => {
    if (sites.data && !sites.isPlaceholderData && shownPage.current !== page) announce(range);
    shownPage.current = page;
  }, [page, sites.data, sites.isPlaceholderData, range]);

  const sortable = (sort: SiteSort, label: string, numeric: boolean) => {
    const active = (params.sort ?? 'name') === sort;
    const order = active ? (params.order ?? (sort === 'diveCount' ? 'desc' : 'asc')) : undefined;
    return {
      label, ...(numeric && { numeric: true as const }),
      sort: {
        direction: order === 'asc' ? 'ascending' as const : order === 'desc' ? 'descending' as const : undefined,
        // First press: A to Z, or the most dives first; again: the other way.
        onSort: () => {
          const first = sort === 'diveCount' ? 'desc' : 'asc';
          const nextOrder = active ? (order === 'asc' ? 'desc' : 'asc') : first;
          location.hash = sitesHref({ ...params, sort, order: nextOrder, page: undefined });
        },
      },
    };
  };
  const filtered = !!(params.q || params.country || params.mine);
  const osmAttribution = sites.data && needsOsmAttribution(sites.data.sites)
    ? sites.data.sites.flatMap((s) => s.externalIds).find((e) => e.source === 'osm' && e.attribution)?.attribution : undefined;

  return (
    <>
      <PageHeader
        title={t('sites.title')}
        lead={t('sites.intro')}
        actions={!creating && (
          <>
            <Button ref={newButton} variant="primary" icon="add" onPress={() => setCreating(true)}>{t('sites.new')}</Button>
            {me.data?.user.role === 'admin' && (
              <a href="#/admin/site-imports" className="btn btn-secondary"><Icon name="siteImport" />{t('siteImport.title')}</a>
            )}
          </>
        )}
      />
      {creating && (
        <Panel title={t('sites.new')}>
          <SiteForm
            initial={{ name: text.trim() }}
            submitLabel={t('sites.create')}
            onSaved={(site) => { location.hash = `/sites/${site.id}`; }}
            onCancel={close}
          />
        </Panel>
      )}
      <Panel>
        {/* Search and filters only when there is something to search (page rules). */}
        {(any.data?.total ?? 0) > 0 && (
          <div className="site-filters">
            <TextField label={t('sites.search')} description={t('sites.searchHint')} type="search" value={text} onChange={setText} autoComplete="off" />
            <Select
              label={t('sites.country')}
              value={params.country ?? ALL_COUNTRIES}
              onChange={(v) => go({ country: !v || v === ALL_COUNTRIES ? undefined : v })}
              options={[{ id: ALL_COUNTRIES, label: t('sites.allCountries') }, ...countryOptions(display.locale)]}
            />
            <Checkbox isSelected={!!params.mine} onChange={(v) => go({ mine: v || undefined })}>{t('sites.onlyMine')}</Checkbox>
          </div>
        )}
        {sites.isPending && <Muted>{t('common.loading')}</Muted>}
        {sites.error && <Notice tone="danger">{errorText(sites.error)}</Notice>}
        {sites.data?.total === 0 && (
          <Muted>{params.q && !params.country && !params.mine ? t('sites.noMatch', { q: params.q }) : filtered ? t('sites.noMatchFilters') : t('sites.empty')}</Muted>
        )}
        {sites.data && sites.data.total > 0 && (
          <>
            <Table
              stacked
              label={t('sites.title')}
              head={[sortable('name', t('sites.name'), false), sortable('country', t('sites.where'), false), sortable('diveCount', t('sites.yourDives'), true)]}
            >
              {sites.data.sites.map((s) => (
                <tr key={s.id}>
                  <td className="cell-main"><a href={`#/sites/${s.id}`}>{s.name}</a></td>
                  <td className="cell-sub">{place(s) || t('common.none')}</td>
                  <td className="num cell-sub">{t('sites.dives', { count: s.diveCount })}</td>
                </tr>
              ))}
            </Table>
            <nav className="pager" aria-label={t('sites.pages')}>
              <span className="meta">{range}</span>
              {total > SITES_PAGE && (
                <span className="pager-buttons">
                  <Button ref={previous} size="small" icon="previous" isDisabled={page <= 1} onPress={() => goTo(page - 1)}>{t('logbook.previous')}</Button>
                  <Button ref={next} size="small" isDisabled={page >= pages} onPress={() => goTo(page + 1)}>{t('logbook.next')}<Icon name="next" /></Button>
                </span>
              )}
            </nav>
          </>
        )}
        {osmAttribution && <OsmAttribution attribution={osmAttribution} />}
      </Panel>
    </>
  );
}

/** One Dive site: where it is, the User's dives there; anyone edits, its creator or an admin deletes. */
export function SitePage({ id }: { id: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const place = useSitePlace();
  const queryClient = useQueryClient();
  const site = useQuery(siteQuery(id));
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const notFound = site.error instanceof ApiError && site.error.status === 404;
  // A merged site is gone: its links lead to the site it was merged into (ADR 0022).
  const mergedInto = site.data?.mergedInto;
  useEffect(() => { if (mergedInto) location.replace(`#/sites/${mergedInto}`); }, [mergedInto]);
  usePageTitle(site.data?.name ?? (notFound ? t('sites.notFound') : undefined));
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/dive-sites/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.site(id) });
      await queryClient.invalidateQueries({ queryKey: keys.sites });
    },
  });

  const back = <p><a href="#/sites" className="back-link"><Icon name="back" />{t('sites.back')}</a></p>;
  if (site.isPending || mergedInto) return <Muted>{t('common.loading')}</Muted>;
  if (notFound) {
    return (
      <>
        <PageHeader title={t('sites.notFound')} />
        <Panel>
          <div className="empty-state">
            <p>{errorText(site.error)}</p>
            <a href="#/sites" className="btn btn-secondary"><Icon name="back" />{t('sites.backToSites')}</a>
          </div>
        </Panel>
      </>
    );
  }
  if (site.error) return <>{back}<Notice tone="danger">{errorText(site.error)}</Notice></>;
  const s = site.data;
  const deletable = s.canDelete && !s.inUse;

  return (
    <>
      {back}
      <PageHeader
        title={s.name}
        meta={place(s) && <p className="title-meta">{place(s)}</p>}
        actions={!editing && (
          <>
            <Button ref={editButton} icon="edit" onPress={() => setEditing(true)}>{t('sites.edit')}</Button>
            {deletable && (
              <ActionMenu
                label={t('sites.moreActions')} aria-label={t('common.forItem', { action: t('sites.moreActions'), item: s.name })}
                actions={[{ id: 'delete', label: t('sites.delete'), icon: 'delete', onAction: () => setDeleting(true) }]}
              />
            )}
          </>
        )}
      />
      <Panel>
        {editing ? (
          <SiteForm
            key={s.version}
            site={s}
            submitLabel={t('sites.save')}
            onSaved={() => { setEditing(false); announce(t('sites.saved')); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <dl className="facts">
              <div className="fact-wide">
                <dt>{t('sites.position')}</dt>
                <dd>
                  {s.position ? (
                    <>
                      {display.position(s.position)}{' '}
                      <a href={mapsUrl(s.position)} target="_blank" rel="noopener noreferrer" className="external-link">
                        {t('sites.openInMaps')}<Icon name="external" />
                      </a>
                    </>
                  ) : t('sites.noPosition')}
                </dd>
              </div>
              <div>
                <dt>{t('sites.maxDepth')}</dt>
                <dd>{s.maxDepthM === null ? t('sites.notKnown') : display.depth(s.maxDepthM)}</dd>
              </div>
              <div>
                <dt>{t('sites.ssiSiteId')}</dt>
                <dd>{s.ssiSiteId ?? t('common.none')}</dd>
              </div>
              <div>
                <dt>{t('sites.yourDives')}</dt>
                <dd>
                  {s.diveCount > 0
                    ? <a href={logbookHref({ siteId: s.id })}>{t('sites.dives', { count: s.diveCount })}</a>
                    : t('sites.noDivesYet')}
                </dd>
              </div>
            </dl>
            <h2 className="subheading">{t('sites.description')}</h2>
            {s.description ? <p className="notes">{s.description}</p> : <Muted>{t('sites.noDescription')}</Muted>}
            <SiteOrigin externalIds={s.externalIds} />
            <Muted>{t('sites.sharedHint')}</Muted>
            {s.canDelete && s.inUse && <Muted>{t('sites.inUse')}</Muted>}
          </>
        )}
      </Panel>
      {!editing && <NearbySites site={s} />}
      <SiteHistory site={s} />
      <ConfirmDialog
        isOpen={deleting} onOpenChange={setDeleting}
        title={t('sites.deleteTitle')} body={t('sites.deleteBody')} confirmLabel={t('sites.deleteConfirm')}
        onConfirm={() => remove.mutateAsync()}
        onDone={() => { announce(t('sites.deleted', { name: s.name })); location.hash = '/sites'; }}
      />
    </>
  );
}

/**
 * "From OpenStreetMap: node/123" with the Attribution its license asks for, or "Also in Wikidata: Q42"
 * for a reference (ADR 0021). Nothing for a site made in this Dive Hub.
 */
function SiteOrigin({ externalIds }: { externalIds: ExternalIdView[] }) {
  const { t } = useTranslation();
  const { from, alsoIn } = siteOrigin(externalIds);
  if (from.length === 0 && alsoIn.length === 0) return null;
  const link = (e: ExternalIdView) => (e.url
    ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="external-link">{e.externalId}<Icon name="external" /></a>
    : e.externalId);
  return (
    <>
      <h2 className="subheading">{t('sites.origin')}</h2>
      <ul className="site-origin">
        {from.map((e) => (
          <li key={e.source}>
            {t('sites.from', { source: e.name })}: {link(e)}
            {e.attribution && (
              <span className="meta">
                {' · '}<a href={e.attribution.url} target="_blank" rel="noopener noreferrer" className="external-link">{e.attribution.text}<Icon name="external" /></a>
              </span>
            )}
          </li>
        ))}
        {alsoIn.map((e) => <li key={e.source}>{t('sites.alsoIn', { source: e.name })}: {link(e)}</li>)}
      </ul>
    </>
  );
}

/** Sites this close may be the same place (ADR 0022). */
const SAME_PLACE_M = 200;

/**
 * Other sites within 200 m, each of which can be merged into this one (ADR 0022). Merging can't be undone,
 * so the dialog says what happens: this site keeps its values and fills its gaps, Dives move here.
 */
function NearbySites({ site }: { site: SiteView }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const nearby = useQuery({ ...sitesQuery({ near: site.position ?? undefined, within: SAME_PLACE_M }), enabled: !!site.position });
  const others = nearby.data?.sites.filter((o) => o.id !== site.id) ?? [];
  const [merging, setMerging] = useState<SiteView | null>(null);
  const merge = useMutation({
    mutationFn: async (other: SiteView) => unwrap(await api.POST('/api/dive-sites/{id}/merge', {
      params: { path: { id: other.id } }, body: { intoId: site.id, version: other.version, intoVersion: site.version },
    })),
    onSuccess: async (kept, other) => {
      queryClient.setQueryData(keys.site(kept.id), kept);
      queryClient.removeQueries({ queryKey: keys.site(other.id) });
      await queryClient.invalidateQueries({ queryKey: keys.sites });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
    },
  });
  if (!site.position || others.length === 0) return null;

  const filled = (other: SiteView) => {
    const gaps: string[] = [];
    if (!site.country && other.country) gaps.push(t('sites.country'));
    if (!site.waterBody && other.waterBody) gaps.push(t('sites.waterBody'));
    if (site.maxDepthM === null && other.maxDepthM !== null) gaps.push(t('sites.maxDepth'));
    if (!site.ssiSiteId && other.ssiSiteId) gaps.push(t('sites.ssiSiteId'));
    if (!site.description && other.description) gaps.push(t('sites.description'));
    return gaps;
  };
  const body = (other: SiteView) => [
    t('sites.mergeGone', { name: other.name }),
    filled(other).length > 0 ? t('sites.mergeFills', { fields: filled(other).join(', ') }) : t('sites.mergeKeeps'),
    other.diveCount > 0 ? t('sites.mergeYourDives', { count: other.diveCount }) : '',
    // Whether other Users dive there, never how many (ADR 0020).
    other.inUse && other.diveCount === 0 ? t('sites.mergeOthersDives') : other.inUse ? t('sites.mergeOthersToo') : '',
    t('sites.mergeNoUndo'),
  ].filter(Boolean).join(' ');

  return (
    <Panel title={t('sites.closeBy')}>
      <Muted>{t('sites.closeByIntro', { distance: display.distance(SAME_PLACE_M) })}</Muted>
      <ul className="nearby-sites">
        {others.map((o) => (
          <li key={o.id}>
            <span>
              <a href={`#/sites/${o.id}`}>{o.name}</a>
              <span className="meta"> · {t('sites.away', { distance: display.distance(o.distanceM ?? 0) })}</span>
            </span>
            <Button size="small" aria-label={t('common.forItem', { action: t('sites.mergeHere'), item: o.name })} onPress={() => setMerging(o)}>
              {t('sites.mergeHere')}
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        isOpen={merging !== null} onOpenChange={(open) => { if (!open) setMerging(null); }}
        title={merging ? t('sites.mergeTitle', { name: merging.name, into: site.name }) : ''}
        body={merging ? body(merging) : ''}
        confirmLabel={t('sites.mergeConfirm')}
        onConfirm={() => merge.mutateAsync(merging!)}
        onDone={() => announce(t('sites.merged', { name: merging?.name ?? '', into: site.name }))}
      />
    </Panel>
  );
}

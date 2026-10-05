import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { divesQuery, diversQuery, PAGE_SIZE, siteQuery, type LogbookParams } from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { logbookHref } from './lib/logbook.ts';
import { useAddressSearch } from './lib/address-search.ts';
import { usePageTitle } from './lib/page.ts';
import { Button, Icon, Muted, Notice, PageHeader, Panel, Select, Table, TextField } from './ui/index.ts';

const ALL = 'all';
type Sort = NonNullable<LogbookParams['sort']>;

/**
 * The logbook page's head (visual refresh 2): the title, the Diver filter when there are several
 * Divers, and the import button for a returning User, with the hint that files can be dropped.
 */
export function LogbookHeader({ params, importAction }: { params: LogbookParams; importAction?: ReactNode }) {
  const { t } = useTranslation();
  const divers = useQuery(diversQuery());
  const several = (divers.data?.length ?? 0) > 1;
  usePageTitle(t('logbook.title'));
  return (
    <PageHeader
      title={t('logbook.title')}
      lead={importAction && t('import.dropAnywhere')}
      actions={(several || importAction) && (
        <>
          {several && (
            <div className="logbook-filter">
              <Select
                label={t('divers.filter')}
                value={params.diverId ?? ALL}
                onChange={(v) => { location.hash = logbookHref({ ...params, diverId: !v || v === ALL ? undefined : v, page: undefined }); }}
                options={[{ id: ALL, label: t('divers.allDivers') }, ...(divers.data ?? []).map((d) => ({ id: d.id, label: d.name }))]}
              />
            </div>
          )}
          {importAction}
        </>
      )}
    />
  );
}

/**
 * The logbook: Dives of the User's Divers, a page at a time, newest first unless sorted by a column,
 * searchable by number and notes (ADR 0017). With several Divers, a filter and a column. Everything
 * the User picks is in the address, so back, reload and links keep it.
 */
export function DiveList({ params, searchable = true }: { params: LogbookParams; searchable?: boolean }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const dives = useQuery(divesQuery(params));
  const divers = useQuery(diversQuery());
  const several = (divers.data?.length ?? 0) > 1;
  const nameOf = new Map(divers.data?.map((d) => [d.id, d.name]));

  // Typing searches after a short pause; the address is replaced, not added to the history.
  const [text, setText] = useAddressSearch(params.q, (q) => location.replace(logbookHref({ ...params, q, page: undefined })));

  const page = params.page ?? 1;
  const total = dives.data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const range = t('logbook.range', { from, to, count: total });
  const pages = Math.ceil(total / PAGE_SIZE);
  // Reaching the first or last page disables the button just pressed; focus moves to the other one.
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const goTo = (target: number) => {
    location.hash = logbookHref({ ...params, page: target });
    if (target <= 1) requestAnimationFrame(() => next.current?.focus());
    else if (target >= pages) requestAnimationFrame(() => previous.current?.focus());
  };
  // A new page is announced; the table changes without the page moving.
  const shownPage = useRef(page);
  useEffect(() => {
    if (dives.data && !dives.isPlaceholderData && shownPage.current !== page) announce(range);
    shownPage.current = page;
  }, [page, dives.data, dives.isPlaceholderData, range]);

  const sortable = (sort: Sort, label: string, numeric: boolean) => {
    const active = (params.sort ?? 'startsAt') === sort;
    const order = active ? (params.order ?? 'desc') : undefined;
    return {
      label, ...(numeric && { numeric: true as const }),
      sort: {
        direction: order === 'asc' ? 'ascending' as const : order === 'desc' ? 'descending' as const : undefined,
        // First press: the largest or newest first; again: the other way.
        onSort: () => { location.hash = logbookHref({ ...params, sort, order: active && order === 'desc' ? 'asc' : undefined, page: undefined }); },
      },
    };
  };

  return (
    <Panel>
      {params.siteId && <SiteFilter params={params} />}
      {/* Nothing to search before the first dive (visual refresh 8). */}
      {searchable && (
        <div className="logbook-search">
          <TextField label={t('logbook.search')} description={t('logbook.searchHint')} type="search" value={text} onChange={setText} autoComplete="off" />
        </div>
      )}
      {dives.isPending && <Muted>{t('common.loading')}</Muted>}
      {dives.error && <Notice tone="danger">{errorText(dives.error)}</Notice>}
      {dives.data?.total === 0 && <Muted>{params.q ? t('logbook.noMatch', { q: params.q }) : t('logbook.empty')}</Muted>}
      {dives.data && dives.data.total > 0 && (
        <>
          <Table
            stacked
            label={t('logbook.title')}
            head={[
              sortable('number', t('logbook.number'), true), sortable('startsAt', t('logbook.date'), false), ...(several ? [t('dive.diver')] : []),
              t('dive.site'),
              sortable('maxDepth', t('logbook.maxDepth'), true), sortable('duration', t('logbook.duration'), true),
            ]}
          >
            {dives.data.dives.map((d) => (
              // The date is the link (keyboard and screen readers); the whole row is a larger click target.
              <tr
                key={d.id}
                className="row-link"
                onClick={(e) => {
                  // A click with a modifier key or on the link itself is the browser's (new tab, etc.).
                  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0 || (e.target as Element).closest('a')) return;
                  location.hash = `/dives/${d.id}`;
                }}
              >
                <td className="num cell-lead">{d.number ?? t('common.none')}</td>
                <td className="cell-main"><a href={`#/dives/${d.id}`}>{display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource)}</a></td>
                {several && <td className="cell-sub">{nameOf.get(d.diverId) ?? t('common.none')}</td>}
                <td className="cell-sub">{d.site?.name ?? t('common.none')}</td>
                <td className="num cell-sub">{display.depth(d.maxDepthM)}</td>
                <td className="num cell-sub">{display.duration(d.durationSeconds)}</td>
              </tr>
            ))}
          </Table>
          <nav className="pager" aria-label={t('logbook.pages')}>
            <span className="meta">{range}</span>
            {total > PAGE_SIZE && (
              <span className="pager-buttons">
                <Button ref={previous} size="small" icon="previous" isDisabled={page <= 1} onPress={() => goTo(page - 1)}>{t('logbook.previous')}</Button>
                <Button ref={next} size="small" isDisabled={page >= pages} onPress={() => goTo(page + 1)}>{t('logbook.next')}<Icon name="next" /></Button>
              </span>
            )}
          </nav>
        </>
      )}
    </Panel>
  );
}

/** "Dives at Lighthouse" with the way back to all dives, while the logbook shows one site's dives (ADR 0020). */
function SiteFilter({ params }: { params: LogbookParams }) {
  const { t } = useTranslation();
  const site = useQuery(siteQuery(params.siteId!));
  return (
    <p className="site-filter">
      <span>{t('logbook.atSite', { name: site.data?.name ?? '…' })}</span>
      <a href={logbookHref({ ...params, siteId: undefined, page: undefined })}>{t('logbook.allSites')}</a>
    </p>
  );
}

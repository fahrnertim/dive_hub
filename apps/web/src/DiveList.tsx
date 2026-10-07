import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { connectionsQuery, divesQuery, diversQuery, PAGE_SIZE, siteQuery, type DiveSummary, type LogbookPage, type LogbookParams } from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import {
  diveHref, listQuery, LOGBOOK_FILTERS, logbookHref, mixName, monthGroups, SORT_CHOICES, sortChoice, toggled, type LogbookFilter, type MonthFigures,
} from './lib/logbook.ts';
import { useAddressSearch } from './lib/address-search.ts';
import { usePageTitle } from './lib/page.ts';
import { useNames, useProviders } from './lib/providers.ts';
import { ProfileSketch } from './ProfileSketch.tsx';
import { sketchScale } from './lib/sketch.ts';
import { Avatar, Button, DiverAvatar, Icon, Muted, Notice, PageHeader, Panel, Select, TextField, ToggleChip } from './ui/index.ts';

const ALL = 'all';
/** A stack shows this many circles, then "+2". */
const CIRCLES = 3;
/** A surface interval is said in a row while the dive before was the same day's. */
const SAME_DAY_SECONDS = 24 * 3600;
const COUNT_OF = { 'no-recording': 'noRecording', 'no-site': 'noSite', 'with-findings': 'withFindings', 'not-at-provider': 'notAtProvider' } as const;

/**
 * The logbook page's head (visual refresh 2): the title and the import button for a returning User, with the hint
 * that files can be dropped. What filters the list is in the list's toolbar (UI redesign 3.7).
 */
export function LogbookHeader({ importAction }: { importAction?: ReactNode }) {
  const { t } = useTranslation();
  usePageTitle(t('logbook.title'));
  return <PageHeader title={t('logbook.title')} lead={importAction && t('import.dropAnywhere')} actions={importAction} />;
}

/**
 * The logbook: Dives of the User's Divers as rows, a page at a time, newest first under their months unless sorted
 * otherwise, searchable by number and notes (ADR 0017), narrowed by "Show only" (ADR 0040). Above it the logbook's
 * totals and one toolbar. Everything the User picks is in the address, so back, reload and links keep it.
 */
export function DiveList({ params, searchable = true }: { params: LogbookParams; searchable?: boolean }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const names = useNames();
  const dives = useQuery(divesQuery(params));
  const divers = useQuery(diversQuery());
  const providers = useProviders();
  const several = (divers.data?.length ?? 0) > 1;
  const nameOf = new Map(divers.data?.map((d) => [d.id, d.name]));
  const providerName = (id: string) => providers.data?.find((p) => p.id === id)?.name ?? id;
  const filterName = useFilterNames();

  // Typing searches after a short pause; the address is replaced, not added to the history.
  const [text, setText] = useAddressSearch(params.q, (q) => location.replace(logbookHref({ ...params, q, page: undefined })));
  const search = useRef<HTMLDivElement>(null);

  const page = params.page ?? 1;
  const total = dives.data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const range = t('logbook.range', { from, to, count: total });
  const pages = Math.ceil(total / PAGE_SIZE);
  const filters = names((params.only ?? []).map(filterName));
  const nothing = params.only?.length
    ? (params.q ? t('logbook.noMatchBoth', { q: params.q, filters }) : t('logbook.noMatchOnly', { filters }))
    : params.q ? t('logbook.noMatch', { q: params.q }) : t('logbook.empty');
  // Reaching the first or last page disables the button just pressed; focus moves to the other one.
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const goTo = (target: number) => {
    location.hash = logbookHref({ ...params, page: target });
    if (target <= 1) requestAnimationFrame(() => next.current?.focus());
    else if (target >= pages) requestAnimationFrame(() => previous.current?.focus());
  };
  // A new page or another set of filters is announced; the rows change without the page moving.
  const view = `${page} ${params.only?.join() ?? ''}`;
  const shownView = useRef(view);
  useEffect(() => {
    if (dives.data && !dives.isPlaceholderData && shownView.current !== view) {
      announce(total === 0 ? nothing : range);
      shownView.current = view;
    }
  }, [view, dives.data, dives.isPlaceholderData, range, nothing, total]);

  const byDate = (params.sort ?? 'startsAt') === 'startsAt';
  return (
    <Panel>
      {params.siteId && <SiteFilter params={params} />}
      {/* Nothing to count, search or sort before the first dive (visual refresh 8). */}
      {searchable && (
        <>
          {dives.data && dives.data.totals.dives > 0 && <Totals totals={dives.data.totals} />}
          <div className="logbook-toolbar">
            <div className="logbook-search" ref={search}>
              <TextField label={t('logbook.search')} description={t('logbook.searchHint')} type="search" value={text} onChange={setText} autoComplete="off" />
            </div>
            {several && (
              <div className="logbook-choice">
                <Select
                  label={t('divers.filter')}
                  value={params.diverId ?? ALL}
                  onChange={(v) => { location.hash = logbookHref({ ...params, diverId: !v || v === ALL ? undefined : v, page: undefined }); }}
                  options={[{ id: ALL, label: t('divers.allDivers') }, ...(divers.data ?? []).map((d) => ({ id: d.id, label: d.name }))]}
                />
              </div>
            )}
            <div className="logbook-choice">
              <Select
                label={t('logbook.sortBy')}
                value={sortChoice(params)}
                onChange={(id) => {
                  const choice = SORT_CHOICES.find((c) => c.id === id);
                  location.hash = logbookHref({ ...params, sort: choice?.sort, order: choice?.order, page: undefined });
                }}
                options={SORT_CHOICES.map((c) => ({ id: c.id, label: t(`logbook.sort.${c.id}`) }))}
              />
            </div>
          </div>
          {dives.data && <ShowOnly params={params} counts={dives.data.counts} />}
        </>
      )}
      {dives.isPending && <Muted>{t('common.loading')}</Muted>}
      {dives.error && <Notice tone="danger">{errorText(dives.error)}</Notice>}
      {dives.data?.total === 0 && (
        <div className="logbook-nothing">
          <Muted>{nothing}</Muted>
          {/* No dead end: with filters applied, all dives are one press away, and focus goes to the search. */}
          {params.only?.length && (
            <Button
              size="small"
              onPress={() => {
                location.hash = logbookHref({ ...params, q: undefined, only: undefined, page: undefined });
                search.current?.querySelector('input')?.focus();
              }}
            >
              {t('logbook.showAll')}
            </Button>
          )}
        </div>
      )}
      {dives.data && dives.data.total > 0 && (
        <>
          <p className="logbook-range meta">{range}</p>
          <section className="dive-list" aria-label={t('logbook.dives')}>
            <div className="dive-grid">
            {monthGroups(dives.data.dives, dives.data.months).map((group) => (
              <div className="dive-group" key={group.month ?? 'all'}>
                {group.month && <MonthHead month={group.month} figures={group.figures} />}
                <ul className="dive-rows">
                  {group.dives.map((d) => (
                    <DiveRow
                      key={d.id} dive={d} list={listQuery(params)} year={!byDate} scaleM={sketchScale(dives.data.totals.deepestM)}
                      diver={several ? nameOf.get(d.diverId) : undefined}
                      from={d.fromProvider ? providerName(d.fromProvider) : undefined}
                    />
                  ))}
                </ul>
              </div>
            ))}
            </div>
          </section>
          {total > PAGE_SIZE && (
            <nav className="pager" aria-label={t('logbook.pages')}>
              <Button ref={previous} size="small" icon="previous" isDisabled={page <= 1} onPress={() => goTo(page - 1)}>{t('logbook.previous')}</Button>
              <Button ref={next} size="small" isDisabled={page >= pages} onPress={() => goTo(page + 1)}>{t('logbook.next')}<Icon name="next" /></Button>
            </nav>
          )}
        </>
      )}
    </Panel>
  );
}

/** The four numbers every logbook has on its first page (UI redesign 3.6): the Diver's whole logbook, whatever is searched or shown. */
function Totals({ totals }: { totals: LogbookPage['totals'] }) {
  const { t } = useTranslation();
  const display = useDisplay();
  return (
    <div className="logbook-totals" role="group" aria-label={t('logbook.totals.label')}>
      <dl>
        <div><dt>{t('logbook.totals.dives')}</dt><dd>{totals.dives.toLocaleString(display.locale)}</dd></div>
        <div><dt>{t('logbook.totals.underWater')}</dt><dd>{display.duration(totals.durationSeconds)}</dd></div>
        <div><dt>{t('logbook.totals.deepest')}</dt><dd>{display.depth(totals.deepestM)}</dd></div>
        {totals.lastDiveAt && <div><dt>{t('logbook.totals.lastDive')}</dt><dd>{display.date(totals.lastDiveAt)}</dd></div>}
      </dl>
    </div>
  );
}

/** A filter's name; "Not in SSI" names the Providers the User is connected to (the API has no Provider of its own, ADR 0040). */
function useFilterNames() {
  const { t } = useTranslation();
  const names = useNames();
  const providers = useProviders();
  const connections = useQuery(connectionsQuery());
  return (filter: LogbookFilter): string => {
    if (filter !== 'not-at-provider') return t(`logbook.only.${COUNT_OF[filter]}`);
    const connected = (providers.data ?? []).filter((p) => connections.data?.some((c) => c.provider === p.id)).map((p) => p.name);
    return t('logbook.only.notAtProvider', { names: connected.length > 0 ? names(connected) : t('provider.someService') });
  };
}

/**
 * "Show only": toggles that narrow the logbook to the dives that lack something, each with how many it would show.
 * The counts don't change when a filter is pressed. A filter that would show nothing isn't offered, unless it is pressed.
 */
function ShowOnly({ params, counts }: { params: LogbookParams; counts: LogbookPage['counts'] }) {
  const { t } = useTranslation();
  const label = useId();
  const filterName = useFilterNames();
  // Releasing a filter that shows nothing would take its chip away under the focus: it stays until focus leaves it.
  const [kept, setKept] = useState<LogbookFilter | null>(null);
  const pressed = params.only ?? [];
  const offered = LOGBOOK_FILTERS.filter((f) => counts[COUNT_OF[f]] > 0 || pressed.includes(f) || kept === f);
  if (offered.length === 0) return null;
  return (
    <div className="chips" role="group" aria-labelledby={label}>
      <span id={label} className="chips-label">{t('logbook.showOnly')}</span>
      {offered.map((f) => (
        <ToggleChip
          key={f}
          count={counts[COUNT_OF[f]]}
          isSelected={pressed.includes(f)}
          onChange={(on) => {
            if (!on && counts[COUNT_OF[f]] === 0) setKept(f);
            location.hash = logbookHref({ ...params, only: toggled(pressed, f), page: undefined });
          }}
          onBlur={() => { if (kept === f) setKept(null); }}
        >
          {filterName(f)}
        </ToggleChip>
      ))}
    </div>
  );
}

/** "April 2026" over its rows, with all the month's dives and their time, not only this page's share (ADR 0040). */
function MonthHead({ month, figures }: { month: string; figures: MonthFigures | undefined }) {
  const { t } = useTranslation();
  const display = useDisplay();
  return (
    <div className="month-head">
      <h2>{display.month(month)}</h2>
      {figures && <p className="meta">{t('logbook.monthFigures', { count: figures.dives, time: display.duration(figures.durationSeconds) })}</p>}
    </div>
  );
}

/**
 * One Dive: the site as its title (the date while it has none), then what makes it this dive, who was there, and the
 * two numbers in columns. The title is the link (keyboard and screen readers); the whole row is a larger click target.
 */
function DiveRow({ dive: d, diver, from, year, scaleM, list }: {
  /** The list the row is in; it goes into the Dive's address (ADR 0042). */
  list: string;
  dive: DiveSummary;
  /** The metres a sketch's height stands for, the same in every row. */
  scaleM: number;
  /** The Diver's name, with several Divers. */
  diver: string | undefined;
  /** The Provider whose entry the Dive was made from, by name. */
  from: string | undefined;
  /** Whether the day says its year: no month heading does. */
  year: boolean;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const open = (e: MouseEvent) => {
    // A click with a modifier key or on the link itself is the browser's (new tab, etc.).
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0 || (e.target as Element).closest('a')) return;
    location.hash = diveHref(d.id, list).slice(1);
  };
  return (
    <li className="dive-row" onClick={open}>
      <span className="dive-no num">
        {d.number === null ? <span aria-hidden="true">{t('common.none')}</span> : <><span className="visually-hidden">{t('logbook.numberLabel')} </span>{d.number}</>}
      </span>
      <div className="dive-main">
        <a className="dive-title" href={diveHref(d.id, list)}>
          {d.site?.name ?? display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource)}
        </a>
        <p className="dive-facts">
          <span>{d.site ? display.diveDay(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource, year) : t('logbook.noSite')}</span>
          {diver && <span>{diver}</span>}
          {d.gases.length > 0 && <span>{d.gases.map((g) => mixName(g, t('dive.air'))).join(', ')}</span>}
          {d.recordings === 0 && <span>{t('logbook.noRecording')}</span>}
          {from && d.recordings === 0 && <span>{t('logbook.fromProvider', { name: from })}</span>}
          {d.surfaceIntervalSeconds !== null && d.surfaceIntervalSeconds < SAME_DAY_SECONDS && (
            <span>{t('logbook.surfaceInterval', { time: display.duration(d.surfaceIntervalSeconds) })}</span>
          )}
          {/* The dive assessment found something that differs from guidance (ADR 0036): text, not a colour or an icon alone. */}
          {d.findings > 0 && <span className="badge">{t('logbook.findings', { count: d.findings })}</span>}
        </p>
      </div>
      <ProfileSketch profile={d.profile} hasRecording={d.recordings > 0} scaleM={scaleM} />
      <Buddies people={d.participants} />
      <span className="dive-figures">
        <span className="num">{display.depth(d.maxDepthM)}</span>
        <span className="num">{display.duration(d.durationSeconds)}</span>
      </span>
    </li>
  );
}

/**
 * Who was on the Dive, as overlapping circles with two letters (the owner's idea, UI redesign): scanned down the list
 * like a column. The circles are decoration; the names and roles are text for screen readers.
 */
function Buddies({ people }: { people: DiveSummary['participants'] }) {
  const { t } = useTranslation();
  const names = useNames();
  if (people.length === 0) return <span className="dive-buddies" />;
  const more = people.length - CIRCLES;
  return (
    <span className="dive-buddies">
      <span className="avatar-stack" aria-hidden="true">
        {people.slice(0, CIRCLES).map((p) => <DiverAvatar key={p.diverId} name={p.name} diverId={p.diverId} />)}
        {more > 0 && <span className="avatar avatar-more">{t('logbook.morePeople', { count: more })}</span>}
      </span>
      <span className="visually-hidden">
        {t('logbook.with', { people: names(people.map((p) => t('participants.withRole', { name: p.name, role: t(`participants.role.${p.role}`) }))) })}
      </span>
    </span>
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

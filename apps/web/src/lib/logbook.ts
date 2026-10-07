import type { LogbookParams } from '../api.ts';

/** The "Show only" filters of the logbook (ADR 0040), in the order they are offered and written to the address. */
export const LOGBOOK_FILTERS = ['no-recording', 'no-site', 'with-findings', 'not-at-provider'] as const;
export type LogbookFilter = (typeof LOGBOOK_FILTERS)[number];

/** The filters with this one pressed or released. */
export function toggled(only: readonly LogbookFilter[] | undefined, filter: LogbookFilter): LogbookFilter[] {
  return only?.includes(filter) ? only.filter((f) => f !== filter) : [...(only ?? []), filter];
}

/** The settings as a query string; defaults are left out. */
export function listQuery(p: LogbookParams): string {
  const query = new URLSearchParams();
  if (p.diverId) query.set('diver', p.diverId);
  if (p.siteId) query.set('site', p.siteId);
  if (p.q) query.set('q', p.q);
  if (p.sort && p.sort !== 'startsAt') query.set('sort', p.sort);
  if (p.order === 'asc') query.set('order', 'asc');
  const only = LOGBOOK_FILTERS.filter((f) => p.only?.includes(f));
  if (only.length > 0) query.set('only', only.join(','));
  if (p.page && p.page > 1) query.set('page', String(p.page));
  // A comma needs no escaping in a query: "?only=no-recording,no-site" stays readable.
  return query.toString().replaceAll('%2C', ',');
}

/** The logbook's address for these settings ("#/" is the newest first). */
export function logbookHref(p: LogbookParams): string {
  return logbookHrefOf(listQuery(p));
}

/** The logbook's address for a list's query string (see listQuery). */
export function logbookHrefOf(list: string | undefined): string {
  return list ? `#/?${list}` : '#/';
}

/**
 * A Dive's address. `list` is the logbook's query the User came from (ADR 0042): it makes previous and next follow that
 * list and "Logbook" go back to it, and survives a reload or a copied link.
 */
export function diveHref(id: string, list: string | undefined, recording?: string): string {
  const query = new URLSearchParams();
  if (list) query.set('list', list);
  if (recording) query.set('recording', recording);
  const text = query.toString();
  return text ? `#/dives/${id}?${text}` : `#/dives/${id}`;
}

/** The list named in a Dive's address, cleaned the way the logbook reads its own address. */
export function listOfDiveAddress(query: URLSearchParams): string {
  return listQuery(logbookParams(new URLSearchParams(query.get('list') ?? '')));
}

/** What the API's neighbours ask takes of a list: everything but the page. */
export function neighbourParams(p: LogbookParams) {
  return {
    ...(p.diverId && { diverId: p.diverId }), ...(p.siteId && { siteId: p.siteId }), ...(p.q && { q: p.q }),
    ...(p.sort && { sort: p.sort }), ...(p.order && { order: p.order }), ...(p.only?.length && { only: p.only.join(',') }),
  };
}

/** The settings in the address of the logbook (see logbookHref). */
export function logbookParams(query: URLSearchParams): LogbookParams {
  const sort = query.get('sort');
  const page = Number(query.get('page'));
  // A filter the API doesn't know would be refused (400): it is dropped here.
  const named = (query.get('only') ?? '').split(',');
  const only = LOGBOOK_FILTERS.filter((f) => named.includes(f));
  return {
    diverId: query.get('diver') ?? undefined,
    siteId: query.get('site') ?? undefined,
    q: query.get('q') ?? undefined,
    sort: sort === 'number' || sort === 'maxDepth' || sort === 'duration' ? sort : undefined,
    order: query.get('order') === 'asc' ? 'asc' : undefined,
    only: only.length > 0 ? only : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

export type SortChoice = 'newest' | 'oldest' | 'deepest' | 'shallowest' | 'longest' | 'shortest' | 'highestNumber' | 'lowestNumber';
/**
 * "Sort by" (UI redesign 3.7): the rows have no column headers to press, so every way the API sorts is a choice.
 * The first is the default.
 */
export const SORT_CHOICES: readonly ({ id: SortChoice } & Pick<LogbookParams, 'sort' | 'order'>)[] = [
  { id: 'newest' },
  { id: 'oldest', order: 'asc' },
  { id: 'deepest', sort: 'maxDepth' },
  { id: 'shallowest', sort: 'maxDepth', order: 'asc' },
  { id: 'longest', sort: 'duration' },
  { id: 'shortest', sort: 'duration', order: 'asc' },
  { id: 'highestNumber', sort: 'number' },
  { id: 'lowestNumber', sort: 'number', order: 'asc' },
];

/** The choice these settings sort by. */
export function sortChoice(p: Pick<LogbookParams, 'sort' | 'order'>): SortChoice {
  const sort = p.sort ?? 'startsAt';
  const order = p.order ?? 'desc';
  return SORT_CHOICES.find((c) => (c.sort ?? 'startsAt') === sort && (c.order ?? 'desc') === order)!.id;
}

/** "Air", "EAN32", "18/45": a mix by the name divers use. */
export const mixName = (g: { o2: number; he: number }, air: string) => (g.he > 0 ? `${g.o2}/${g.he}` : g.o2 === 21 ? air : `EAN${g.o2}`);

export interface MonthFigures { month: string; dives: number; durationSeconds: number }

/** The local month of a Dive as the API groups it (ADR 0040): the start plus the offset; without one, the time as stored. */
const monthOf = (d: { startsAt: string; utcOffsetSeconds: number | null }) =>
  new Date(Date.parse(d.startsAt) + (d.utcOffsetSeconds ?? 0) * 1000).toISOString().slice(0, 7);

/**
 * A page's Dives under their months, each with the month's figures from the API (all its Dives, not this page's
 * share). Without `months` (not sorted by date) the page is one group without a month.
 */
export function monthGroups<D extends { startsAt: string; utcOffsetSeconds: number | null }>(
  dives: D[], months: MonthFigures[],
): { month: string | null; figures: MonthFigures | undefined; dives: D[] }[] {
  if (months.length === 0) return [{ month: null, figures: undefined, dives }];
  const groups: { month: string; figures: MonthFigures | undefined; dives: D[] }[] = [];
  for (const d of dives) {
    const month = monthOf(d);
    if (groups.at(-1)?.month === month) groups.at(-1)!.dives.push(d);
    else groups.push({ month, figures: months.find((m) => m.month === month), dives: [d] });
  }
  return groups;
}

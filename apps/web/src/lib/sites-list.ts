// The Dive sites list's settings live in the address (ADR 0022), like the logbook's (ADR 0017).

export type SiteSort = 'name' | 'country' | 'diveCount';

export interface SitesParams {
  q?: string | undefined;
  /** ISO 3166-1 alpha-2. */
  country?: string | undefined;
  /** Only sites with the User's own dives. */
  mine?: boolean | undefined;
  sort?: SiteSort | undefined;
  order?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
}

/** Sites per page. */
export const SITES_PAGE = 50;

/** The list's address for these settings; defaults (by name, A to Z, first page) are left out. */
export function sitesHref(p: SitesParams): string {
  const query = new URLSearchParams();
  if (p.q) query.set('q', p.q);
  if (p.country) query.set('country', p.country);
  if (p.mine) query.set('mine', '1');
  if (p.sort && p.sort !== 'name') query.set('sort', p.sort);
  if (p.order === 'desc') query.set('order', 'desc');
  if (p.page && p.page > 1) query.set('page', String(p.page));
  const text = query.toString();
  return text ? `#/sites?${text}` : '#/sites';
}

/** The settings in the list's address (see sitesHref). */
export function sitesParams(query: URLSearchParams): SitesParams {
  const sort = query.get('sort');
  const country = query.get('country');
  const page = Number(query.get('page'));
  return {
    q: query.get('q') || undefined,
    country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
    mine: query.get('mine') === '1' ? true : undefined,
    sort: sort === 'country' || sort === 'diveCount' ? sort : undefined,
    order: query.get('order') === 'desc' ? 'desc' : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

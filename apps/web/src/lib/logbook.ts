import type { LogbookParams } from '../api.ts';

/** The logbook's address for these settings; defaults are left out ("#/" is the newest first). */
export function logbookHref(p: LogbookParams): string {
  const query = new URLSearchParams();
  if (p.diverId) query.set('diver', p.diverId);
  if (p.q) query.set('q', p.q);
  if (p.sort && p.sort !== 'startsAt') query.set('sort', p.sort);
  if (p.order === 'asc') query.set('order', 'asc');
  if (p.page && p.page > 1) query.set('page', String(p.page));
  const text = query.toString();
  return text ? `#/?${text}` : '#/';
}

/** The settings in the address of the logbook (see logbookHref). */
export function logbookParams(query: URLSearchParams): LogbookParams {
  const sort = query.get('sort');
  const page = Number(query.get('page'));
  return {
    diverId: query.get('diver') ?? undefined,
    q: query.get('q') ?? undefined,
    sort: sort === 'number' || sort === 'maxDepth' || sort === 'duration' ? sort : undefined,
    order: query.get('order') === 'asc' ? 'asc' : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

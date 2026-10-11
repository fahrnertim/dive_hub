// The conditions of the logbook's list (ADR 0017, 0040): the Diver, a site, a search and the "show only" filters. Shared by
// `GET /api/dives` and by a Push run that sends "the Dives the list shows" (ADR 0047).
import { and, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { dive, diveSite } from '../db/schema.js';

export const DIVE_ONLY = ['no-recording', 'no-site', 'with-findings', 'not-at-provider', 'changed-since-sent'] as const;
export type DiveOnly = (typeof DIVE_ONLY)[number];

/** Findings that differ from guidance and that the User neither dismissed on the Dive nor muted for its Diver. */
export const FINDINGS_SHOWN = sql<number>`(select count(*)::int from dive_finding f where f.dive_id = "dive"."id" and f.severity <> 'info'
  and not exists (select 1 from finding_dismissal x where x.dive_id = f.dive_id and x.rule = f.rule)
  and not exists (select 1 from muted_rule m where m.diver_id = "dive"."diver_id" and m.rule = f.rule))`.mapWith(Number);

const NO_RECORDING = sql`not exists (select 1 from recording r where r.dive_id = "dive"."id" and r.deleted_at is null)`;

/**
 * A Provider the User is connected to for the Dive's Diver has no current dive for it: the newest Push there that decides
 * ("found gone", or confirmed with a remote ID or a delete) is none, a delete or gone. The same rule as `currentRemote`.
 */
const notAtProvider = (userId: string) => sql`exists (select 1 from connection c where c.user_id = ${userId}::uuid and c.diver_id = "dive"."diver_id"
  and not exists (select 1 from (select p.action, p.remote_gone from push p where p.dive_id = "dive"."id" and p.provider = c.provider
      and (p.remote_gone or (p.state = 'confirmed' and (p.action = 'delete' or p.remote_id is not null)))
      order by p.created_at desc, p.id desc limit 1) newest
    where not newest.remote_gone and newest.action <> 'delete'))`;

export interface DiveListFilter {
  userId: string;
  diverIds: string[];
  siteId?: string | undefined;
  q?: string | undefined;
  only?: string | undefined;
  /**
   * The Dives that changed since they were sent (`PushService.changedSinceSent`). The adapters' fingerprints are not SQL,
   * so the caller works them out when this filter or the counts are asked for; without it the filter shows nothing.
   */
  changedIds?: string[] | undefined;
}

/** Whether the list's `only` asks for this filter: the caller then needs to work out what it holds. */
export const asksFor = (only: string | undefined, filter: DiveOnly) => (only?.split(',') ?? []).includes(filter);

/**
 * `base`: the Diver, the site and the search (the counts follow these but not the chosen filters, so a chip keeps its
 * number once pressed). `filters`: each "show only" condition. `where`: `base` and the chosen filters.
 */
export function diveListFilter({ userId, diverIds, siteId, q, only, changedIds }: DiveListFilter) {
  const filters: Record<DiveOnly, SQL> = {
    'no-recording': NO_RECORDING,
    'no-site': isNull(dive.siteId),
    'with-findings': sql`${FINDINGS_SHOWN} > 0`,
    'not-at-provider': notAtProvider(userId),
    'changed-since-sent': changedIds?.length ? inArray(dive.id, changedIds) : sql`false`,
  };
  const text = q?.trim();
  let search: SQL | undefined;
  if (text) {
    const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const asNumber = /^\d{1,9}$/.test(text) ? Number(text) : undefined;
    search = or(ilike(dive.notes, pattern), ilike(diveSite.name, pattern), asNumber === undefined ? undefined : eq(dive.number, asNumber));
  }
  const base = and(inArray(dive.diverId, diverIds), isNull(dive.deletedAt), siteId ? eq(dive.siteId, siteId) : undefined, search);
  const chosen = (only?.split(',') ?? []) as DiveOnly[];
  return { filters, base, where: and(base, ...chosen.map((f) => filters[f])) };
}

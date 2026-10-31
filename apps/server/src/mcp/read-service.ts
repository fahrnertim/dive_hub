// What the MCP tools read (ADR 0035): every query of tools-*.ts, over the tool call's read-only transaction. Each
// query is limited to the Divers the User manages; Dives deleted (ADR 0026) never count.
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { dive, type PARTICIPANT_ROLES, type RecordingSummary } from '../db/schema.js';
import { participantsOfDives } from '../dives/dive-service.js';
import type { SITE_WATER_TYPES } from '../vocabulary.js';
import type { ToolContext } from './tool.js';

/** Whom a read is for: the tool call's transaction, the User and the Divers they manage. */
export type Reader = Pick<ToolContext, 'tx' | 'userId' | 'diverIds'>;

type Role = (typeof PARTICIPANT_ROLES)[number];
type WaterType = (typeof SITE_WATER_TYPES)[number];

/**
 * A Dive's start as local wall-clock time, in SQL (ADR 0030): shifted by its offset; kept as it is when the offset is
 * unknown (then the stored time already is the wall clock); the UTC time when only the instant is known.
 */
const LOCAL_START = sql.raw(`(case when d.utc_offset_seconds is not null then d.starts_at + make_interval(secs => d.utc_offset_seconds) else d.starts_at end) at time zone 'UTC'`);

/** Words for a case-insensitive "contains" search. */
const like = (text: string) => `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const idList = (ids: string[]) => sql`(${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;
const all = (conditions: (SQL | undefined)[]) => sql.join(conditions.filter((c): c is SQL => c !== undefined), sql` and `);
const count = async (r: Reader, query: SQL) => ((await r.tx.execute(query)).rows as { n: number }[])[0]?.n ?? 0;

// --- Dives ------------------------------------------------------------------------------------------------------

/** The filters several tools share. `divers`: the User's Divers asked for (diversAsked in tool.ts). */
export interface DiveFilter {
  divers: string[]; site_id?: string | undefined; country?: string | undefined; from?: string | undefined; to?: string | undefined;
}

/** `filter` over `dive d` joined to `dive_site s`. */
const diveWhere = (f: DiveFilter): SQL => all([
  sql`d.deleted_at is null`,
  f.divers.length === 0 ? sql`false` : sql`d.diver_id in ${idList(f.divers)}`,
  f.site_id ? sql`d.site_id = ${f.site_id}::uuid` : undefined,
  f.country ? sql`s.country = ${f.country}` : undefined,
  f.from ? sql`(${LOCAL_START})::date >= ${f.from}::date` : undefined,
  f.to ? sql`(${LOCAL_START})::date <= ${f.to}::date` : undefined,
]);

export type DiveRow = {
  id: string; number: number | null; starts_ms: number; utc_offset_seconds: number | null; utc_offset_source: string;
  duration_seconds: number; max_depth_m: number | null; avg_depth_m: number | null; water_temperature_c: number | null;
  notes: string | null; diver_id: string; diver_name: string; site_id: string | null; site_name: string | null;
  site_country: string | null; site_water_type: WaterType | null;
  entry_latitude: number | null; entry_longitude: number | null; exit_latitude: number | null; exit_longitude: number | null;
};

const DIVE_COLUMNS = sql.raw(`d.id, d.number, (extract(epoch from d.starts_at) * 1000)::float8 as starts_ms, d.utc_offset_seconds, d.utc_offset_source, d.duration_seconds, d.max_depth_m,
  d.avg_depth_m, d.water_temperature_c, d.notes, d.diver_id, dv.name as diver_name, s.id as site_id, s.name as site_name,
  s.country as site_country, s.water_type as site_water_type,
  r.entry_latitude, r.entry_longitude, r.exit_latitude, r.exit_longitude`);
const DIVE_FROM = sql.raw(`dive d join diver dv on dv.id = d.diver_id left join dive_site s on s.id = d.site_id
  left join recording r on r.id = d.primary_recording_id and r.deleted_at is null`);

export interface DiveSearch extends DiveFilter {
  /** A dive number, or words from the notes or the site's name. */
  text?: string | undefined;
  min_depth_m?: number | undefined; max_depth_m?: number | undefined; with_diver_id?: string | undefined;
  sort: 'date' | 'depth' | 'duration' | 'number'; order: 'asc' | 'desc'; limit: number; offset: number;
}

export async function findDives(r: Reader, f: DiveSearch): Promise<{ rows: DiveRow[]; total: number }> {
  const asNumber = f.text && /^\d{1,9}$/.test(f.text) ? Number(f.text) : undefined;
  const where = all([
    diveWhere(f),
    f.text ? sql`(d.notes ilike ${like(f.text)} or s.name ilike ${like(f.text)}${asNumber === undefined ? sql`` : sql` or d.number = ${asNumber}`})` : undefined,
    f.min_depth_m === undefined ? undefined : sql`d.max_depth_m >= ${f.min_depth_m}::float8`,
    f.max_depth_m === undefined ? undefined : sql`d.max_depth_m <= ${f.max_depth_m}::float8`,
    f.with_diver_id ? sql`exists (select 1 from participant p where p.dive_id = d.id and p.diver_id = ${f.with_diver_id}::uuid)` : undefined,
  ]);
  const column = { date: 'd.starts_at', depth: 'd.max_depth_m', duration: 'd.duration_seconds', number: 'd.number' }[f.sort];
  const rows = (await r.tx.execute(sql`select ${DIVE_COLUMNS} from ${DIVE_FROM} where ${where}
    order by ${sql.raw(`${column} ${f.order} nulls last`)}, d.starts_at desc, d.id desc limit ${f.limit} offset ${f.offset}`)).rows as DiveRow[];
  return { rows, total: await count(r, sql`select count(*)::int as n from ${DIVE_FROM} where ${where}`) };
}

/** One of the User's Dives, with what logbook_get_dive adds; null when it is not theirs or deleted. */
export async function diveOf(r: Reader, diveId: string) {
  const [d] = (await r.tx.execute(sql`select ${DIVE_COLUMNS}, d.overrides, d.from_provider, d.primary_recording_id
    from ${DIVE_FROM} where ${diveWhere({ divers: r.diverIds })} and d.id = ${diveId}::uuid`)).rows as (DiveRow & {
    overrides: string[]; from_provider: string | null; primary_recording_id: string | null;
  })[];
  return d ?? null;
}

/** The stored row of one of the User's Dives; null when it is not theirs or deleted. */
export async function ownDive(r: Reader, diveId: string) {
  if (r.diverIds.length === 0) return null;
  const [d] = await r.tx.select().from(dive).where(and(eq(dive.id, diveId), inArray(dive.diverId, r.diverIds), isNull(dive.deletedAt)));
  return d ?? null;
}

export type Participant = { diver_id: string; role: Role; name?: string; shared_name?: string };

/** Who else was on these Dives, by Dive: named plainly when the User keeps that Diver, as shared text otherwise. */
export async function participantsOf(r: Reader, diveIds: string[]): Promise<Map<string, Participant[]>> {
  const byDive = await participantsOfDives(r.tx, diveIds);
  return new Map([...byDive].map(([diveId, people]) => [diveId, people.map(({ diverId, role, name }) =>
    ({ diver_id: diverId, role, ...(r.diverIds.includes(diverId) ? { name } : { shared_name: name }) }))]));
}

/** A Dive's live Recordings, oldest first, with their device and sample channels. */
export async function recordingsOf(r: Reader, diveId: string) {
  return (await r.tx.execute(sql`
    select r.id, (extract(epoch from r.starts_at) * 1000)::float8 as starts_ms, r.duration_seconds, r.max_depth_m, r.summary, dev.manufacturer, dev.product,
      coalesce((select array_agg(ss.channel order by ss.channel) from sample_series ss where ss.recording_id = r.id), '{}') as channels
    from recording r left join device dev on dev.id = r.device_id
    where r.dive_id = ${diveId}::uuid and r.deleted_at is null order by r.starts_at`)).rows as {
    id: string; starts_ms: number; duration_seconds: number; max_depth_m: number | null; summary: RecordingSummary;
    manufacturer: string | null; product: string | null; channels: string[];
  }[];
}

/** A Recording's sample series in these channels. */
export async function seriesOf(r: Reader, recordingId: string, channels: string[]) {
  return (await r.tx.execute(sql`select channel, offsets_ms, "values" from sample_series
    where recording_id = ${recordingId}::uuid and channel in ${sql`(${sql.join(channels.map((c) => sql`${c}`), sql`, `)})`}`))
    .rows as { channel: string; offsets_ms: number[]; values: number[] }[];
}

export const GROUPS = ['none', 'year', 'month', 'country', 'site', 'diver'] as const;

/** Counts and totals over the filtered Dives, and up to `maxGroups + 1` groups with how many there are in all. */
export async function statsOf(r: Reader, f: DiveFilter, groupBy: (typeof GROUPS)[number], maxGroups: number) {
  const where = diveWhere(f);
  const from = sql`dive d join diver dv on dv.id = d.diver_id left join dive_site s on s.id = d.site_id`;
  const [totals] = (await r.tx.execute(sql`select count(*)::int as dives, coalesce(sum(d.duration_seconds), 0)::float8 as seconds,
      avg(d.max_depth_m)::float8 as avg_max, min(d.water_temperature_c)::float8 as coldest,
      to_char(min(${LOCAL_START}), 'YYYY-MM-DD') as first, to_char(max(${LOCAL_START}), 'YYYY-MM-DD') as last,
      count(distinct d.site_id)::int as sites, count(distinct s.country)::int as countries,
      (count(*) filter (where d.site_id is null))::int as without_site
    from ${from} where ${where}`)).rows as {
    dives: number; seconds: number; avg_max: number | null; coldest: number | null; first: string | null; last: string | null;
    sites: number; countries: number; without_site: number;
  }[];
  const mark = async (column: string) => {
    const [row] = (await r.tx.execute(sql`select d.id, to_char(${LOCAL_START}, 'YYYY-MM-DD') as date, ${sql.raw(column)}::float8 as value
      from ${from} where ${where} and ${sql.raw(column)} is not null order by ${sql.raw(column)} desc, d.starts_at desc limit 1`))
      .rows as { id: string; date: string; value: number }[];
    return row ?? null;
  };
  const deepest = await mark('d.max_depth_m');
  const longest = await mark('d.duration_seconds');
  if (groupBy === 'none') return { totals: totals!, deepest, longest, groups: [], groupCount: 0 };
  const key = {
    year: sql`to_char(${LOCAL_START}, 'YYYY')`, month: sql`to_char(${LOCAL_START}, 'YYYY-MM')`, country: sql`s.country`,
    site: sql`d.site_id::text`, diver: sql`d.diver_id::text`,
  }[groupBy];
  const label = { year: sql`null`, month: sql`null`, country: sql`null`, site: sql`max(s.name)`, diver: sql`max(dv.name)` }[groupBy];
  const groups = (await r.tx.execute(sql`select ${key} as key, ${label} as label,
      count(*)::int as dives, coalesce(sum(d.duration_seconds), 0)::float8 as seconds, max(d.max_depth_m)::float8 as deepest
    from ${from} where ${where} group by 1
    order by ${sql.raw(groupBy === 'year' || groupBy === 'month' ? '1 desc nulls last' : '3 desc, 1 nulls last')} limit ${maxGroups + 1}`))
    .rows as { key: string | null; label: string | null; dives: number; seconds: number; deepest: number | null }[];
  const groupCount = await count(r, sql`select count(distinct coalesce(${key}, ''))::int as n from ${from} where ${where}`);
  return { totals: totals!, deepest, longest, groups, groupCount };
}

// --- Divers -----------------------------------------------------------------------------------------------------

/** The Divers the User manages, their own first, with their Dives' count and dates and their dive computers. */
export async function diversOf(r: Reader) {
  return (await r.tx.execute(sql`select dv.id, dv.name, m.is_own,
      (select count(*)::int from dive d where d.diver_id = dv.id and d.deleted_at is null) as dives,
      (select to_char(min(${LOCAL_START}), 'YYYY-MM-DD') from dive d where d.diver_id = dv.id and d.deleted_at is null) as first,
      (select to_char(max(${LOCAL_START}), 'YYYY-MM-DD') from dive d where d.diver_id = dv.id and d.deleted_at is null) as last,
      coalesce((select array_agg(concat_ws(' ', dev.manufacturer, dev.product) order by dev.manufacturer, dev.product)
        from device dev where dev.diver_id = dv.id and dev.deleted_at is null), '{}') as computers
    from diver_management m join diver dv on dv.id = m.diver_id
    where m.user_id = ${r.userId}::uuid and dv.deleted_at is null
    order by m.is_own desc, lower(dv.name), dv.id`)).rows as {
    id: string; name: string; is_own: boolean; dives: number; first: string | null; last: string | null; computers: string[];
  }[];
}

export interface BuddySearch {
  divers: string[]; role?: Role | undefined; from?: string | undefined; to?: string | undefined; limit: number; offset: number;
}

/** The people on these Divers' Dives, most Dives together first. `mine`: one of the User's own Divers. */
export async function buddiesOf(r: Reader, f: BuddySearch) {
  if (f.divers.length === 0) return { rows: [], total: 0 };
  const where = all([
    sql`d.deleted_at is null`,
    sql`d.diver_id in ${idList(f.divers)}`,
    f.role ? sql`p.role = ${f.role}` : undefined,
    f.from ? sql`(${LOCAL_START})::date >= ${f.from}::date` : undefined,
    f.to ? sql`(${LOCAL_START})::date <= ${f.to}::date` : undefined,
  ]);
  const from = sql`participant p join dive d on d.id = p.dive_id join diver b on b.id = p.diver_id`;
  const rows = (await r.tx.execute(sql`select b.id, max(b.name) as name,
      exists (select 1 from diver_management m where m.diver_id = b.id and m.user_id = ${r.userId}::uuid) as mine,
      count(*)::int as together,
      (count(*) filter (where p.role = 'buddy'))::int as buddy, (count(*) filter (where p.role = 'guide'))::int as guide,
      (count(*) filter (where p.role = 'instructor'))::int as instructor,
      to_char(min(${LOCAL_START}), 'YYYY-MM-DD') as first, to_char(max(${LOCAL_START}), 'YYYY-MM-DD') as last
    from ${from} where ${where} group by b.id
    order by together desc, lower(max(b.name)), b.id limit ${f.limit} offset ${f.offset}`)).rows as {
    id: string; name: string; mine: boolean; together: number; buddy: number; guide: number; instructor: number; first: string; last: string;
  }[];
  return { rows, total: await count(r, sql`select count(distinct b.id)::int as n from ${from} where ${where}`) };
}

// --- Dive sites -------------------------------------------------------------------------------------------------

export type SiteRow = {
  id: string; name: string; country: string | null; water_body: string | null; water_type: WaterType | null;
  max_depth_m: number | null; latitude: number | null; longitude: number | null; description: string | null; your_dives: number;
};

const mine = (r: Reader) => (r.diverIds.length === 0 ? sql`false` : sql`d.diver_id in ${idList(r.diverIds)}`);
/** How many of the User's Dives are at site `s`. */
const yourDives = (r: Reader): SQL => (r.diverIds.length === 0 ? sql`0` : sql`(select count(*)::int from dive d
  where d.site_id = s.id and d.deleted_at is null and ${mine(r)})`);
const SITE_COLUMNS = sql.raw('s.id, s.name, s.country, s.water_body, s.water_type, s.max_depth_m, s.latitude, s.longitude, s.description');

export interface SiteSearch {
  query?: string | undefined; country?: string | undefined;
  /** Only sites where the User has Dives, most dived first; otherwise every site, by name. */
  divedOnly: boolean;
  limit: number; offset: number;
}

export async function findSites(r: Reader, f: SiteSearch): Promise<{ rows: SiteRow[]; total: number }> {
  const dives = yourDives(r);
  const where = all([
    sql`s.deleted_at is null`,
    f.query ? sql`(s.name ilike ${like(f.query)} or s.water_body ilike ${like(f.query)})` : undefined,
    f.country ? sql`s.country = ${f.country}` : undefined,
    f.divedOnly ? sql`${dives} > 0` : undefined,
  ]);
  const rows = (await r.tx.execute(sql`select ${SITE_COLUMNS}, ${dives} as your_dives
    from dive_site s where ${where}
    order by ${f.divedOnly ? sql`your_dives desc, ` : sql``}lower(s.name), s.id limit ${f.limit} offset ${f.offset}`)).rows as SiteRow[];
  return { rows, total: await count(r, sql`select count(*)::int as n from dive_site s where ${where}`) };
}

/** A live Dive site; a merged site's id leads to the site it was merged into (ADR 0022). */
export async function siteOf(r: Reader, siteId: string): Promise<SiteRow | null> {
  const [s] = (await r.tx.execute(sql`select ${SITE_COLUMNS}, ${yourDives(r)} as your_dives
    from dive_site s
    where s.deleted_at is null and s.id = coalesce((select m.merged_into from dive_site m where m.id = ${siteId}::uuid and m.merged_into is not null), ${siteId}::uuid)`))
    .rows as SiteRow[];
  return s ?? null;
}

/** The User's latest Dives at a site, with the first date and the deepest of all of them. */
export async function divesAtSite(r: Reader, siteId: string, limit: number) {
  return (await r.tx.execute(sql`select d.id, d.number, to_char(${LOCAL_START}, 'YYYY-MM-DD') as date, d.max_depth_m,
      to_char(min(${LOCAL_START}) over (), 'YYYY-MM-DD') as first, max(d.max_depth_m) over () as deepest
    from dive d where d.site_id = ${siteId}::uuid and d.deleted_at is null and ${mine(r)}
    order by d.starts_at desc, d.id desc limit ${limit}`)).rows as {
    id: string; number: number | null; date: string; max_depth_m: number | null; first: string; deepest: number | null;
  }[];
}

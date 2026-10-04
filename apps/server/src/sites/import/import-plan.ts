// Planning a Site import (ADR 0021), without the database: which incoming objects belong to which site,
// and what may change. Matching: the object's own External ID, then the link between the Sources, then
// 100 m plus the same name. A re-import is a 3-way merge per field: a site's field follows its Source
// only while it still equals what the import last brought, so whatever a User changed stays.
import type { Position } from '../site-service.js';
import { IMPORT_SOURCES, type ImportSource, type SiteSource } from '../sources.js';
import { IMPORTED_FIELDS, inBox, type ImportArea, type ImportedValues, type SourceSite } from './site-source.js';

/** A site as it is in the hub, with its External IDs and what their Sources delivered last. */
export interface ExistingSite {
  id: string;
  deleted: boolean;
  values: ImportedValues;
  externalIds: { source: SiteSource; externalId: string; providesData: boolean; imported: ImportedValues | null }[];
}

export interface PlannedExternalId {
  source: ImportSource;
  externalId: string;
  /** False: a reference on a hand-made site; none of its data was taken. */
  providesData: boolean;
  /** What the Source delivered now: the base of the next import's merge (null for references). */
  imported: ImportedValues | null;
  /** New on the site with this run (otherwise only `imported` is refreshed). */
  added: boolean;
}

export type Field = (typeof IMPORTED_FIELDS)[number];

export interface PlannedCreate {
  values: ImportedValues;
  externalIds: { source: ImportSource; externalId: string; imported: ImportedValues }[];
  /** The closest live site within 200 m, for the admin to look at (merging comes later). */
  near: { siteId: string; name: string; distanceM: number } | null;
}

export interface PlannedUpdate {
  siteId: string;
  outcome: 'updated' | 'unchanged' | 'kept' | 'linked';
  set: Partial<ImportedValues>;
  /** Fields the Source changed but a User had changed first: left as they are. */
  kept: Field[];
  externalIds: PlannedExternalId[];
}

export interface SiteImportCounts {
  created: number;
  updated: number;
  unchanged: number;
  kept: number;
  linked: number;
  skippedNoName: number;
  skippedDeleted: number;
  gone: number;
}

export interface SiteImportPlan {
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  counts: SiteImportCounts;
}

/** Objects of the two Sources this close, with the same name, are one place. */
export const MATCH_WITHIN_M = 100;
/** New sites this close to an existing one are reported. */
export const NEAR_WITHIN_M = 200;

const EARTH_RADIUS_M = 6_371_008.8;
export function distanceM(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Words that say what a place is, not which one. */
const GENERIC = /\b(dive ?sites?|dive ?spots?|tauch ?platz|tauch ?spot|tauchplatze?|site de plongee|spot de plongee|plongee)\b/g;
/** A shorter name must be at least this long to count when the other name merely contains it. */
const MIN_CONTAINED = 6;

const normalised = new Map<string, string>();
const normalise = (name: string) => {
  let n = normalised.get(name);
  if (n === undefined) {
    n = normaliseUncached(name);
    if (normalised.size > 50_000) normalised.clear();
    normalised.set(name, n);
  }
  return n;
};
const normaliseUncached = (name: string) => name
  .normalize('NFKD').replace(/\p{M}/gu, '').replace(/ħ/g, 'h').replace(/Ħ/g, 'h').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();

/** Same name after ignoring case, accents, punctuation and generic words; or one contains the other as words. */
export function namesMatch(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= MIN_CONTAINED && ` ${long} `.includes(` ${short} `);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Further apart in latitude than this, two places can't be within `MATCH_WITHIN_M`: skips the haversine. */
const MATCH_DEGREES = (MATCH_WITHIN_M / (Math.PI * EARTH_RADIUS_M / 180)) * 1.01;
const NEAR_DEGREES = (NEAR_WITHIN_M / (Math.PI * EARTH_RADIUS_M / 180)) * 1.01;

/** The value of each field from the Source with precedence that has one (OSM, then Wikidata). */
function merged(rows: { source: SiteSource; imported: ImportedValues | null }[]): ImportedValues {
  const ordered = IMPORT_SOURCES.flatMap((s) => rows.filter((r) => r.source === s && r.imported).map((r) => r.imported!));
  const out = {} as Record<Field, unknown>;
  for (const field of IMPORTED_FIELDS) out[field] = ordered.find((v) => v[field] !== null)?.[field] ?? null;
  return out as unknown as ImportedValues;
}

/** Where incoming objects go: an existing site, or a new one. One object per Source each. */
type Target =
  | { kind: 'site'; site: ExistingSite; members: Map<ImportSource, SourceSite> }
  | { kind: 'new'; members: Map<ImportSource, SourceSite> };

const has = (t: Target, source: ImportSource) =>
  t.members.has(source) || (t.kind === 'site' && t.site.externalIds.some((e) => e.source === source));

const targetPosition = (t: Target): Position | null => {
  for (const s of IMPORT_SOURCES) {
    const p = t.members.get(s)?.values.position;
    if (p) return p;
  }
  return t.kind === 'site' ? t.site.values.position : null;
};
const targetNames = (t: Target) => [
  ...[...t.members.values()].map((m) => m.values.name!),
  ...(t.kind === 'site' ? [t.site.values.name!] : []),
];

function inArea(site: ExistingSite, row: ExistingSite['externalIds'][number], area: ImportArea) {
  const country = row.imported?.country ?? site.values.country;
  const position = row.imported?.position ?? site.values.position;
  if (area.kind === 'world') return true;
  if (area.kind === 'country') return country === area.country;
  return !!position && inBox(position, area);
}

export function planSiteImport(input: {
  sources: readonly ImportSource[];
  area: ImportArea;
  incoming: SourceSite[];
  existing: ExistingSite[];
}): SiteImportPlan {
  const counts: SiteImportCounts = { created: 0, updated: 0, unchanged: 0, kept: 0, linked: 0, skippedNoName: 0, skippedDeleted: 0, gone: 0 };
  const byId = new Map<string, ExistingSite>();
  for (const site of input.existing) for (const e of site.externalIds) byId.set(`${e.source}:${e.externalId}`, site);
  const seen = new Set<string>();

  const targets: Target[] = [];
  const siteTargets = new Map<string, Target>();
  const targetOfSite = (site: ExistingSite) => {
    let t = siteTargets.get(site.id);
    if (!t) {
      t = { kind: 'site', site, members: new Map() };
      siteTargets.set(site.id, t);
      targets.push(t);
    }
    return t;
  };
  const targetOfObject = new Map<string, Target>();
  const join = (t: Target, o: SourceSite) => {
    t.members.set(o.source, o);
    targetOfObject.set(`${o.source}:${o.externalId}`, t);
  };

  // Precedence order, so a Wikidata item meets the OSM objects already placed.
  const incoming = [...input.incoming].sort((a, b) => IMPORT_SOURCES.indexOf(a.source) - IMPORT_SOURCES.indexOf(b.source));
  const pending: SourceSite[] = [];

  // 1. The object's own External ID.
  for (const o of incoming) {
    const key = `${o.source}:${o.externalId}`;
    seen.add(key);
    if (!o.values.name) { counts.skippedNoName++; continue; }
    const site = byId.get(key);
    if (!site) { pending.push(o); continue; }
    if (site.deleted) { counts.skippedDeleted++; continue; }
    join(targetOfSite(site), o);
  }

  // 2. The link between the Sources, either way round: to the site or object that has the other ID.
  const keyOf = (o: SourceSite) => `${o.source}:${o.externalId}`;
  const placed = (o: SourceSite) => targetOfObject.has(keyOf(o));
  const pendingByKey = new Map(pending.map((o) => [keyOf(o), o]));
  const unlinked: SourceSite[] = [];
  for (const o of pending) {
    if (placed(o)) continue;
    const other: ImportSource = o.source === 'osm' ? 'wikidata' : 'osm';
    const named = o.sameAs[other];
    const linkedSite = named ? byId.get(`${other}:${named}`) : undefined;
    const target = (named ? targetOfObject.get(`${other}:${named}`) : undefined)
      ?? (linkedSite && !linkedSite.deleted ? targetOfSite(linkedSite) : undefined)
      ?? targets.find((t) => t.members.get(other)?.sameAs[o.source] === o.externalId);
    if (target && !has(target, o.source)) { join(target, o); continue; }
    const partner = named ? pendingByKey.get(`${other}:${named}`)
      : pending.find((p) => p.source === other && p.sameAs[o.source] === o.externalId);
    if (!target && partner && !placed(partner)) {
      const t: Target = { kind: 'new', members: new Map() };
      targets.push(t);
      join(t, o);
      join(t, partner);
      continue;
    }
    unlinked.push(o);
  }

  // 3. Within 100 m and the same name: the other Source's objects first, then the sites in the hub.
  const live = input.existing.filter((s) => !s.deleted);
  for (const o of unlinked) {
    if (placed(o)) continue;
    const position = o.values.position;
    let best: { target: () => Target; distance: number } | undefined;
    if (position) {
      for (const t of targets) {
        const p = targetPosition(t);
        if (!p || Math.abs(p.latitude - position.latitude) > MATCH_DEGREES || has(t, o.source)) continue;
        const d = distanceM(position, p);
        if (d > MATCH_WITHIN_M || (best && d >= best.distance)) continue;
        if (targetNames(t).some((n) => namesMatch(n, o.values.name!))) best = { target: () => t, distance: d };
      }
      if (!best) {
        for (const site of live) {
          const p = site.values.position;
          if (!p || Math.abs(p.latitude - position.latitude) > MATCH_DEGREES) continue;
          if (siteTargets.has(site.id) && has(siteTargets.get(site.id)!, o.source)) continue;
          if (site.externalIds.some((e) => e.source === o.source)) continue;
          const d = distanceM(position, p);
          if (d > MATCH_WITHIN_M || (best && d >= best.distance) || !namesMatch(site.values.name!, o.values.name!)) continue;
          best = { target: () => targetOfSite(site), distance: d };
        }
      }
    }
    const t = best?.target() ?? (() => { const n: Target = { kind: 'new', members: new Map() }; targets.push(n); return n; })();
    join(t, o);
  }

  const creates: PlannedCreate[] = [];
  const updates: PlannedUpdate[] = [];
  for (const t of targets) {
    const members = IMPORT_SOURCES.flatMap((s) => (t.members.has(s) ? [t.members.get(s)!] : []));
    if (members.length === 0) continue;
    if (t.kind === 'new') {
      const values = merged(members.map((m) => ({ source: m.source, imported: m.values })));
      let near: PlannedCreate['near'] = null;
      if (values.position) {
        for (const site of live) {
          if (!site.values.position || Math.abs(site.values.position.latitude - values.position.latitude) > NEAR_DEGREES) continue;
          const d = distanceM(values.position, site.values.position);
          if (d <= NEAR_WITHIN_M && (!near || d < near.distanceM)) near = { siteId: site.id, name: site.values.name!, distanceM: Math.round(d) };
        }
      }
      creates.push({ values, externalIds: members.map((m) => ({ source: m.source, externalId: m.externalId, imported: m.values })), near });
      counts.created++;
      continue;
    }
    const { site } = t;
    const handMade = !site.externalIds.some((e) => e.providesData);
    if (handMade) {
      // References only; a later import finds them by ID and changes nothing.
      const externalIds = members.map((m) => ({
        source: m.source, externalId: m.externalId, providesData: false, imported: null,
        added: !site.externalIds.some((e) => e.source === m.source),
      }));
      const outcome = externalIds.some((e) => e.added) ? 'linked' : 'unchanged';
      updates.push({ siteId: site.id, outcome, set: {}, kept: [], externalIds });
      counts[outcome]++;
      continue;
    }
    const before = site.externalIds.filter((e) => e.providesData);
    const after = [
      ...before.filter((e) => !t.members.has(e.source as ImportSource)),
      ...members.map((m) => ({ source: m.source as SiteSource, imported: m.values })),
    ];
    const old = merged(before);
    const now = merged(after);
    const set: Partial<Record<Field, unknown>> = {};
    const kept: Field[] = [];
    for (const field of IMPORTED_FIELDS) {
      if (same(old[field], now[field]) || (field === 'name' && !now.name)) continue;
      if (same(site.values[field], old[field])) set[field] = now[field];
      else kept.push(field);
    }
    const externalIds = members.map((m) => {
      const existing = site.externalIds.find((e) => e.source === m.source);
      // A reference stays a reference: its site was made by hand.
      const providesData = existing ? existing.providesData : true;
      return { source: m.source, externalId: m.externalId, providesData, imported: providesData ? m.values : null, added: !existing };
    });
    const addsData = externalIds.some((e) => e.added);
    const outcome = Object.keys(set).length > 0 || addsData ? 'updated' : kept.length > 0 ? 'kept' : 'unchanged';
    counts[outcome]++;
    updates.push({ siteId: site.id, outcome, set: set as Partial<ImportedValues>, kept, externalIds });
  }

  for (const site of input.existing) {
    for (const e of site.externalIds) {
      if (!(input.sources as readonly string[]).includes(e.source) || seen.has(`${e.source}:${e.externalId}`)) continue;
      if (inArea(site, e, input.area)) counts.gone++;
    }
  }
  return { creates, updates, counts };
}

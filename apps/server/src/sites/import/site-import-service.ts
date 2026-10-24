// The admin's Site import (ADR 0021, 0025): started over the API, run by the worker. It asks each Source once,
// plans against the sites in the hub (import-plan.ts), then saves in small transactions so the admin page
// can show progress. Every site it creates, updates or links gets a Revision with the Site import as actor.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import { diveSite, siteImport, type SiteImportFinding, type SiteImportProgress } from '../../db/schema.js';
import { writeRevision, type Actor, type Changes } from '../../dives/revisions.js';
import type { ProblemCode } from '../../http/problems.js';
import { isUniqueViolation } from '../site-error.js';
import { allPublicIds, heldIds, insertImportedIds, publishIds, updateImported } from '../site-ids.js';
import { IMPORT_SOURCES, revisionKey, type ImportSource } from '../sources.js';
import { planSiteImport, type ExistingSite, type Field, type PlannedCreate, type PlannedUpdate } from './import-plan.js';
import { IMPORTED_FIELDS, SiteSourceError, type ImportArea, type ImportedValues, type SiteSourceAdapter, type SourceSite } from './site-source.js';

export const IMPORT_SITES_TASK = 'import_dive_sites';

export class SiteImportError extends Error {
  constructor(readonly code: 'odbl_not_confirmed' | 'ssi_not_confirmed' | 'site_import_running' | 'site_import_not_found') {
    super(code);
  }
}

export interface SiteImportRequest {
  sources: ImportSource[];
  area: ImportArea;
  language: string;
  /** The admin ticked "I understand" under the ODbL explanation (needed for OSM). */
  confirmOdbl: boolean;
  /** The admin confirmed that SSI gives no licence and that importing is their decision and risk (needed for SSI). */
  confirmSsi: boolean;
  /** False: only match and fill sites already in the hub. */
  createSites: boolean;
}

/** Saved per transaction; small enough that a User's edit never waits long for a site's row lock. */
const BATCH = 50;

const columnsOf = (v: Partial<ImportedValues>) => {
  const { position, name, ...rest } = v;
  return {
    ...rest,
    // A site always has a name; the plan never clears one.
    ...(name && { name }),
    ...(position !== undefined && { latitude: position?.latitude ?? null, longitude: position?.longitude ?? null }),
  };
};

const valuesOf = (s: typeof diveSite.$inferSelect): ImportedValues => ({
  name: s.name,
  position: s.latitude === null || s.longitude === null ? null : { latitude: s.latitude, longitude: s.longitude },
  country: s.country, waterBody: s.waterBody, description: s.description, maxDepthM: s.maxDepthM, waterType: s.waterType,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const idKey = revisionKey;

export function createSiteImportService(deps: { db: Db; sources: Record<ImportSource, SiteSourceAdapter> }) {
  const { db } = deps;

  const setProgress = (id: string, progress: SiteImportProgress) =>
    db.update(siteImport).set({ progress }).where(eq(siteImport.id, id));

  /** The sites with their public IDs: the plan never sees a private one (ADR 0057). */
  async function loadExisting(): Promise<ExistingSite[]> {
    const sites = await db.select().from(diveSite);
    const bySite = await allPublicIds(db);
    return sites.map((s) => ({
      id: s.id, deleted: s.deletedAt !== null, mergedInto: s.mergedInto, values: valuesOf(s),
      externalIds: (bySite.get(s.id) ?? []).map((e) => ({ source: e.source, externalId: e.externalId, providesData: e.providesData, imported: e.imported })),
    }));
  }

  /**
   * A new site from the Sources' objects; null when a row here already holds every one of their IDs (a private ID the plan
   * didn't see: its site is already here, and no second one is made).
   */
  async function create(tx: Tx, actor: Actor, c: PlannedCreate): Promise<string | null> {
    const held = await heldIds(tx, c.externalIds);
    const free = c.externalIds.filter((e) => !held.has(`${e.source}:${e.externalId}`));
    if (free.length === 0) return null;
    const [created] = await tx.insert(diveSite).values({ ...columnsOf(c.values), name: c.values.name!, createdBy: null }).returning({ id: diveSite.id });
    const id = created!.id;
    const changes: Changes = {};
    for (const field of IMPORTED_FIELDS) if (c.values[field] !== null) changes[field] = { from: null, to: c.values[field] };
    const stored = await insertImportedIds(tx, actor.id, free.map((e) => ({ siteId: id, source: e.source, externalId: e.externalId, providesData: true, imported: e.imported })));
    for (const e of free) if (stored.has(`${e.source}:${e.externalId}`)) changes[idKey(e.source)] = { from: null, to: e.externalId };
    await writeRevision(tx, 'dive_site', id, actor, 'create', changes);
    return id;
  }

  /** `snapshot`: the site's values the plan saw. A field a User changed since then stays as it is now. */
  async function update(tx: Tx, actor: Actor, u: PlannedUpdate, snapshot: ImportedValues) {
    const [row] = await tx.select().from(diveSite).where(eq(diveSite.id, u.siteId)).for('update');
    if (!row || row.deletedAt) return;
    const current = valuesOf(row);
    const set: Partial<Record<Field, unknown>> = {};
    const changes: Changes = {};
    for (const [field, to] of Object.entries(u.set) as [Field, unknown][]) {
      if (!same(current[field], snapshot[field])) continue;
      set[field] = to;
      changes[field] = { from: current[field], to };
    }
    // New IDs in one insert; one a row already holds (a private ID the plan didn't see) is left where it is.
    const added = u.externalIds.filter((e) => e.added);
    const stored = await insertImportedIds(tx, actor.id, added.map((e) => ({
      siteId: u.siteId, source: e.source, externalId: e.externalId, providesData: e.providesData, imported: e.imported,
    })));
    for (const e of added) if (stored.has(`${e.source}:${e.externalId}`)) changes[idKey(e.source)] = { from: null, to: e.externalId };
    for (const e of u.externalIds) {
      if (!e.added) await updateImported(tx, e.source, e.externalId, { providesData: e.providesData, imported: e.imported, siteImportId: actor.id });
    }
    if (Object.keys(changes).length === 0) return;
    await tx.update(diveSite)
      .set({ ...columnsOf(set as Partial<ImportedValues>), version: sql`${diveSite.version} + 1`, updatedAt: new Date() })
      .where(eq(diveSite.id, u.siteId));
    await writeRevision(tx, 'dive_site', u.siteId, actor, u.outcome === 'linked' ? 'link' : 'update', changes);
  }

  return {
    /** Queues a Site import (admins only, checked by the route); one at a time. */
    async start(userId: string, request: SiteImportRequest) {
      if (request.sources.includes('osm') && !request.confirmOdbl) throw new SiteImportError('odbl_not_confirmed');
      if (request.sources.includes('ssi') && !request.confirmSsi) throw new SiteImportError('ssi_not_confirmed');
      try {
        return await db.transaction(async (tx) => {
          const [row] = await tx.insert(siteImport).values({
            startedBy: userId,
            sources: IMPORT_SOURCES.filter((s) => request.sources.includes(s)),
            area: request.area,
            language: request.language,
            odblConfirmedAt: request.sources.includes('osm') ? new Date() : null,
            ssiConfirmedAt: request.sources.includes('ssi') ? new Date() : null,
            createSites: request.createSites,
          }).returning();
          // One attempt: a failed import says why and is started again by the admin, not retried behind their back.
          await tx.execute(sql`select graphile_worker.add_job(${IMPORT_SITES_TASK}, json_build_object('siteImportId', ${row!.id}::text), max_attempts => 1)`);
          return row!;
        });
      } catch (error) {
        if (isUniqueViolation(error, 'site_import_one_active_uq')) throw new SiteImportError('site_import_running');
        throw error;
      }
    },

    async get(id: string) {
      const [row] = await db.select().from(siteImport).where(eq(siteImport.id, id));
      if (!row) throw new SiteImportError('site_import_not_found');
      return row;
    },

    /** The latest Site imports, newest first. */
    async list(limit = 10) {
      return db.select().from(siteImport).orderBy(desc(siteImport.createdAt), desc(siteImport.id)).limit(limit);
    },

    /** Runs a queued Site import (the worker's job). A Source failing leaves the sites untouched. */
    async run(id: string) {
      const [row] = await db.update(siteImport).set({ status: 'running' })
        .where(and(eq(siteImport.id, id), eq(siteImport.status, 'queued'))).returning();
      if (!row) return;
      const actor: Actor = { type: 'site_import', id };
      try {
        const incoming: SourceSite[] = [];
        for (const source of row.sources) {
          await setProgress(id, { step: source, done: 0, total: 0 });
          incoming.push(...await deps.sources[source].fetch(row.area, row.language));
        }
        // An ID the Source lists publicly is public here too (SSI published a site that was private to an account).
        await db.transaction(async (tx) => {
          for (const source of row.sources) await publishIds(tx, source, incoming.filter((o) => o.source === source).map((o) => o.externalId));
        });
        const existing = await loadExisting();
        const snapshots = new Map(existing.map((s) => [s.id, s.values]));
        const plan = planSiteImport({ sources: row.sources, area: row.area, incoming, existing, createSites: row.createSites });
        const work = [...plan.creates.map((c) => ({ create: c })), ...plan.updates.map((u) => ({ update: u }))];
        const findings: SiteImportFinding[] = [];
        await setProgress(id, { step: 'saving', done: 0, total: work.length });
        for (let i = 0; i < work.length; i += BATCH) {
          await db.transaction(async (tx) => {
            for (const item of work.slice(i, i + BATCH)) {
              if ('create' in item) {
                const siteId = await create(tx, actor, item.create);
                if (!siteId) continue;
                const near = item.create.near;
                if (near) findings.push({ kind: 'near', siteId, name: item.create.values.name!, nearSiteId: near.siteId, nearName: near.name, distanceM: near.distanceM });
              } else {
                await update(tx, actor, item.update, snapshots.get(item.update.siteId)!);
                for (const source of item.update.offers) {
                  findings.push({ kind: 'offer', siteId: item.update.siteId, name: snapshots.get(item.update.siteId)!.name!, source });
                }
              }
            }
          });
          await setProgress(id, { step: 'saving', done: Math.min(i + BATCH, work.length), total: work.length });
        }
        await db.update(siteImport).set({ status: 'done', counts: plan.counts, findings, finishedAt: new Date() }).where(eq(siteImport.id, id));
      } catch (error) {
        const code: ProblemCode = error instanceof SiteSourceError
          ? (error.reason === 'rate_limited' ? 'source_rate_limited' : 'source_unavailable')
          : 'internal_error';
        await db.update(siteImport).set({
          status: 'failed', errorCode: code, errorDetail: (error instanceof Error ? error.message : String(error)).slice(0, 500), finishedAt: new Date(),
        }).where(eq(siteImport.id, id));
        if (!(error instanceof SiteSourceError)) throw error;
      }
    },

    /** At worker start: an import still running was cut off by a stop or crash. */
    async failInterrupted() {
      await db.update(siteImport).set({ status: 'failed', errorCode: 'site_import_interrupted', finishedAt: new Date() })
        .where(inArray(siteImport.status, ['running']));
    },
  };
}

export type SiteImportService = ReturnType<typeof createSiteImportService>;

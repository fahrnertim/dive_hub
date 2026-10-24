// What an import and a send share about a Provider's dive and the Dive it is linked to (ADR 0030, 0056): the base the
// last import or send left, the Dive as the comparison sees it, what changed at the Provider since, and taking those
// changes. Generic; the adapter says what it has. Lives apart from the import so that the send can use it as well (ADR 0053).
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import {
  dive, diveSite, diveSiteExternalId, diver, diverExternalId, importJob, importOriginal, original, participant, push,
  type ComputerChoice, type DiveImportMode,
} from '../db/schema.js';
import { managedDiverIds, participantsOf } from '../dives/dive-service.js';
import { columnsOf } from '../dives/dive-values.js';
import { writeRevision, type Actor, type Changes } from '../dives/revisions.js';
import { placeLocalTime, wallClockMs, type PlacedTime } from '../dives/time-zone.js';
import { siteRef } from '../sites/dive-site-link.js';
import { siteDataAllowed, siteForProvider, type ProviderSite } from '../sites/provider-sites.js';
import type { SiteSource } from '../sites/sources.js';
import type { BlobStore } from '../storage/blob-store.js';
import { loadOutgoingDive } from './outgoing-dive.js';
import type { DiveField, ImportContext, ImportedDive, ProviderAdapter, ProviderCylinder } from './provider.js';
import { currentRemote, fingerprintNow } from './remote-state.js';
import { comparableOf, SYNCED_FIELDS, threeWay, VALUE_FIELDS, type Comparable, type SyncedField } from './three-way.js';
import { cylindersOf, mergeProviderCylinder, providerCylinderOf } from '../dives/cylinders.js';
import { leadOf, leadTotalKg, mergeProviderLead } from '../dives/weighting.js';
import { renumber } from '../dives/dive-numbers.js';

/** Everything one run needs to know, the same in the preview and in the worker. */
export interface ProviderRun {
  userId: string;
  adapter: ProviderAdapter;
  diverId: string;
  connectionId: string | null;
  mode: DiveImportMode;
  windowMinutes: number;
  /** The choice for every computer found. */
  choices: Record<string, ComputerChoice>;
  managed: Set<string>;
  /** Whose account each person entry is, each site's name and position. */
  context: ImportContext;
  /** An admin allowed creating sites from the Provider's site data. */
  sitesAllowed: boolean;
}

/** A field's value as the import preview says it (`shown`). */
export type ShownValue = string | number | string[] | ProviderCylinder | null;

/** Whether the Provider's `dives.fields` let this field come in: no map means every field does. */
export function importsField(run: Pick<ProviderRun, 'adapter'>, field: DiveField): boolean {
  const directions = run.adapter.capabilities.data.dives?.fields;
  return !directions || !!directions[field]?.includes('import');
}

export function createDiveChanges(deps: { db: Db; blobs: BlobStore }) {
  const { db, blobs } = deps;

  /**
   * The sites a Provider's dive names, with what the Provider says about them. A site missing from the context can only be
   * found by its ID (no name to match or create it by).
   */
  function sitesOf(run: ProviderRun, d: ImportedDive): ProviderSite[] {
    return Object.entries(d.siteIds).map(([source, externalId]) => {
      const known = run.context.sites[externalId];
      return {
        source: source as SiteSource, externalId, name: known?.name ?? '',
        position: known && known.latitude !== null && known.longitude !== null ? { latitude: known.latitude, longitude: known.longitude } : null,
        country: known?.country ?? null, waterType: known?.waterType ?? null,
      };
    });
  }

  /** The start's instant: from the dive's position, else its site's at the Provider, else nearby Dives, else unknown. */
  const placeTime = (q: Db | Tx, run: ProviderRun, d: ImportedDive): Promise<PlacedTime> =>
    placeLocalTime(q, run.diverId, wallClockMs(d.localStart)!, [d.exit, d.entry, d.sitePosition]);

  /** The Dive's site from the first of the Provider's sites that is here (or may be created): its ID, or null. */
  async function fillSite(tx: Tx, run: ProviderRun, d: ImportedDive, actor: Actor): Promise<string | null> {
    for (const site of sitesOf(run, d)) {
      const siteId = await siteForProvider(tx, site, { allowCreate: run.sitesAllowed, userId: run.userId, actor });
      if (siteId) return siteId;
    }
    return null;
  }

  /** The Participants the Dive lacks, by their accounts at the Provider: the Dive's `participants` change, if any. */
  async function fillBuddies(tx: Tx, run: ProviderRun, diveId: string, d: ImportedDive, ownerId: string): Promise<Changes> {
    const source = run.adapter.accountSource;
    if (!source || d.people.length === 0 || (await participantsOf(tx, diveId)).length > 0) return {};
    const divers = await tx.select({ diverId: diverExternalId.diverId }).from(diverExternalId)
      .innerJoin(diver, eq(diver.id, diverExternalId.diverId))
      .where(and(eq(diverExternalId.source, source), inArray(diverExternalId.externalId, d.people), isNull(diver.deletedAt)));
    const ids = [...new Set(divers.map((x) => x.diverId))].filter((id) => id !== ownerId);
    if (ids.length === 0) return {};
    await tx.insert(participant).values(ids.map((diverId) => ({ diveId, diverId, role: 'buddy' as const })));
    return { participants: { from: [], to: await participantsOf(tx, diveId) } };
  }

  /**
   * Fills what the Dive lacks from the Provider's dive (ADR 0030), overwriting nothing: the site (only one that already
   * has the Provider's site ID), the Participants (by their accounts at the Provider, when the Dive has none), the notes,
   * the tank typed there (a Cylinder where the Dive has none, the gaps of its only one; ADR 0045).
   * One Revision; whether anything changed.
   */
  async function fill(tx: Tx, run: ProviderRun, diveId: string, d: ImportedDive, actor: Actor): Promise<boolean> {
    const [current] = await tx.select().from(dive).where(eq(dive.id, diveId)).for('update');
    if (!current) return false;
    const changes: Changes = {};
    const columns: Partial<typeof dive.$inferInsert> = {};
    if (!current.siteId && importsField(run, 'site')) {
      const siteId = await fillSite(tx, run, d, actor);
      if (siteId) {
        columns.siteId = siteId;
        changes.site = { from: null, to: await siteRef(tx, siteId) };
      }
    }
    if (importsField(run, 'notes') && !current.notes?.trim() && d.notes) {
      columns.notes = d.notes;
      changes.notes = { from: current.notes, to: d.notes };
    }
    if (importsField(run, 'buddies')) Object.assign(changes, await fillBuddies(tx, run, diveId, d, current.diverId));
    if (d.cylinder && importsField(run, 'cylinder')) Object.assign(changes, await mergeProviderCylinder(tx, diveId, d.cylinder, 'fill'));
    if (d.leadKg !== null && importsField(run, 'lead')) Object.assign(changes, await mergeProviderLead(tx, diveId, d.leadKg, 'fill'));
    if (Object.keys(changes).length === 0) return false;
    await tx.update(dive).set({ ...columns, version: sql`${dive.version} + 1`, updatedAt: new Date() }).where(eq(dive.id, diveId));
    await writeRevision(tx, 'dive', diveId, actor, 'fill', changes);
    return true;
  }

  /**
   * What the Provider had for this dive when Dive Hub last saw it (ADR 0030, amended): the newer of the Original an
   * earlier finished Import brought and what Dive Hub last sent there. Null when Dive Hub never saw it.
   */
  async function baseOf(q: Db | Tx, run: ProviderRun, diveId: string, remoteId: string, notImport?: string): Promise<ImportedDive | null> {
    const [seen] = await q.select({ storageKey: original.storageKey, at: importJob.createdAt }).from(original)
      .innerJoin(importOriginal, eq(importOriginal.originalId, original.id))
      .innerJoin(importJob, eq(importJob.id, importOriginal.importId))
      .where(and(
        eq(original.userId, run.userId), eq(original.fileName, `${run.adapter.id}-dive-${remoteId}.json`), eq(importJob.status, 'done'),
        notImport ? sql`${importJob.id} <> ${notImport}` : undefined,
      ))
      .orderBy(desc(importJob.createdAt)).limit(1);
    const [sent] = await q.select({ payload: push.payload, at: push.createdAt }).from(push)
      .where(and(eq(push.diveId, diveId), eq(push.provider, run.adapter.id), eq(push.remoteId, remoteId), eq(push.state, 'confirmed'),
        inArray(push.action, ['create', 'update'])))
      .orderBy(desc(push.createdAt)).limit(1);
    const parse = run.adapter.dives!.parse!;
    if (sent?.payload && (!seen || sent.at > seen.at)) return parse(sent.payload, run.context, remoteId);
    if (!seen) return null;
    return parse(JSON.parse((await blobs.read(seen.storageKey)).toString('utf8')) as Record<string, unknown>, run.context, remoteId);
  }

  /** The Dive here as the comparison sees it, and the fields it compares (values only without a Recording). */
  async function hubOf(q: Db | Tx, run: ProviderRun, diveId: string, siteSource: SiteSource | null) {
    const [row] = await q.select().from(dive).where(eq(dive.id, diveId));
    if (!row) return null;
    const [siteId] = row.siteId && siteSource ? await q.select({ id: diveSiteExternalId.externalId }).from(diveSiteExternalId)
      .where(and(eq(diveSiteExternalId.siteId, row.siteId), eq(diveSiteExternalId.source, siteSource))) : [];
    const source = run.adapter.accountSource;
    const people = await participantsOf(q, diveId);
    const accounts = source && people.length > 0 ? await q.select({ diverId: diverExternalId.diverId, account: diverExternalId.externalId })
      .from(diverExternalId).where(and(eq(diverExternalId.source, source), inArray(diverExternalId.diverId, people.map((p) => p.diverId)))) : [];
    const cylinders = await cylindersOf(q, diveId);
    const entries = await leadOf(q, diveId);
    const hub: Comparable = {
      site: siteId?.id ?? null, notes: row.notes?.trim() || null, buddies: accounts.map((a) => a.account).sort(),
      startsAt: Math.floor((row.startsAt.getTime() + (row.utcOffsetSeconds ?? 0) * 1000) / 60_000),
      durationSeconds: row.durationSeconds, maxDepthM: row.maxDepthM, avgDepthM: row.avgDepthM, waterTemperatureC: row.waterTemperatureC,
      cylinder: cylinders.length === 1 ? providerCylinderOf(cylinders[0]!) : null, lead: leadTotalKg(entries),
    };
    // The Provider's one tank can't be told to be one of several Cylinders: not compared then.
    // Nor can the Provider's one weight be told to be one of several Lead entries.
    const fields = SYNCED_FIELDS.filter((f) => importsField(run, f)).filter((f) => (f === 'cylinder' ? cylinders.length <= 1 : f === 'lead' ? entries.length <= 1 : !row.primaryRecordingId || !VALUE_FIELDS.includes(f)));
    return { row, hub, fields, people, accounts };
  }

  /** What changed at the Provider since Dive Hub last saw the dive, compared with the Dive here; null without a base. */
  async function changesOf(q: Db | Tx, run: ProviderRun, diveId: string, d: ImportedDive, notImport?: string) {
    const base = await baseOf(q, run, diveId, d.remoteId, notImport);
    if (!base) return null;
    const source = (Object.keys(d.siteIds)[0] ?? Object.keys(base.siteIds)[0] ?? null) as SiteSource | null;
    const here = await hubOf(q, run, diveId, source);
    if (!here) return null;
    const provider = comparableOf(d);
    return { ...threeWay(here.fields, comparableOf(base), provider, here.hub), here, provider };
  }

  /** What one `takeChanges` collects while it goes through the fields. */
  interface Taking {
    tx: Tx; run: ProviderRun; diveId: string; d: ImportedDive; actor: Actor; current: typeof dive.$inferSelect;
    changes: Changes; columns: Partial<typeof dive.$inferInsert>; overrides: Set<(typeof dive.$inferSelect)['overrides'][number]>;
  }

  /** The Provider's site becomes the Dive's. */
  async function takeSite(t: Taking) {
    const { tx, run, d, actor, current } = t;
    const site = sitesOf(run, d)[0];
    const siteId = site ? await siteForProvider(tx, site, { allowCreate: run.sitesAllowed, userId: run.userId, actor }) : null;
    if (!siteId || siteId === current.siteId) return;
    t.columns.siteId = siteId;
    t.changes.site = { from: await siteRef(tx, current.siteId), to: await siteRef(tx, siteId) };
  }

  /** The Provider's list of people replaces the Participants it can know of; the others stay. */
  async function takeBuddies(t: Taking) {
    const { tx, run, diveId, d, current } = t;
    const source = run.adapter.accountSource;
    if (!source) return;
    const before = await participantsOf(tx, diveId);
    const withAccount = before.length === 0 ? [] : await tx.select({ diverId: diverExternalId.diverId }).from(diverExternalId)
      .where(and(eq(diverExternalId.source, source), inArray(diverExternalId.diverId, before.map((p) => p.diverId))));
    const wanted = d.people.length === 0 ? [] : await tx.select({ diverId: diverExternalId.diverId }).from(diverExternalId)
      .innerJoin(diver, eq(diver.id, diverExternalId.diverId))
      .where(and(eq(diverExternalId.source, source), inArray(diverExternalId.externalId, d.people), isNull(diver.deletedAt)));
    // Participants the Provider can't know (no account there) stay; the others are the Provider's list now.
    const keep = before.filter((p) => !withAccount.some((w) => w.diverId === p.diverId));
    const add = [...new Set(wanted.map((w) => w.diverId))].filter((id) => id !== current.diverId && !keep.some((k) => k.diverId === id));
    await tx.delete(participant).where(eq(participant.diveId, diveId));
    const list = [...keep.map((k) => ({ diveId, diverId: k.diverId, role: k.role })), ...add.map((diverId) => ({ diveId, diverId, role: 'buddy' as const }))];
    if (list.length > 0) await tx.insert(participant).values(list);
    t.changes.participants = { from: before, to: await participantsOf(tx, diveId) };
  }

  /** The Provider's start, placed in time like an imported file's. */
  async function takeStartsAt(t: Taking) {
    const { tx, run, d, current } = t;
    const time = await placeTime(tx, run, d);
    t.columns = { ...t.columns, ...columnsOf('startsAt', { at: time.startsAt, utcOffsetSeconds: time.utcOffsetSeconds }), utcOffsetSource: time.utcOffsetSource };
    t.changes.startsAt = {
      from: { at: current.startsAt.toISOString(), utcOffsetSeconds: current.utcOffsetSeconds },
      to: { at: time.startsAt.toISOString(), utcOffsetSeconds: time.utcOffsetSeconds },
    };
    t.overrides.delete('startsAt');
  }

  /** One of the plain value fields: the Provider's value becomes the Dive's, and no longer an override. */
  function takeValue(t: Taking, field: Exclude<SyncedField, 'site' | 'notes' | 'buddies' | 'cylinder' | 'lead' | 'startsAt'>) {
    const { d, current } = t;
    const to = field === 'durationSeconds' ? d.durationSeconds : d[field];
    if (field === 'durationSeconds' && !to) return;
    t.columns = { ...t.columns, [field]: to };
    t.changes[field] = { from: current[field], to };
    t.overrides.delete(field);
  }

  /** One field's take, by its kind. */
  async function takeField(t: Taking, field: SyncedField) {
    const { tx, diveId, d, current } = t;
    if (field === 'site') await takeSite(t);
    else if (field === 'notes') {
      const notes = d.notes?.trim() || null;
      t.columns.notes = notes;
      t.changes.notes = { from: current.notes, to: notes };
    } else if (field === 'buddies') await takeBuddies(t);
    else if (field === 'cylinder') Object.assign(t.changes, await mergeProviderCylinder(tx, diveId, d.cylinder, 'take'));
    else if (field === 'lead') Object.assign(t.changes, await mergeProviderLead(tx, diveId, d.leadKg, 'take'));
    else if (field === 'startsAt') await takeStartsAt(t);
    else takeValue(t, field);
  }

  /**
   * Takes the Provider's values for these fields (ADR 0030, amended): one Revision (`update`). A Dive that was up to date
   * at the Provider stays so (a new `link` Push with its fingerprint), unless `sending`: the send's own Push follows.
   * Answers the fields it changed: a site Dive Hub can't use, or a tank a Recording brought, changes nothing.
   */
  async function takeChanges(
    tx: Tx, run: ProviderRun, diveId: string, d: ImportedDive, fields: SyncedField[], actor: Actor, sending = false,
  ): Promise<SyncedField[]> {
    const [current] = await tx.select().from(dive).where(eq(dive.id, diveId)).for('update');
    if (!current) return [];
    const pushes = await tx.select().from(push).where(and(eq(push.diveId, diveId), eq(push.provider, run.adapter.id)))
      .orderBy(desc(push.createdAt), desc(push.id));
    const remote = currentRemote(pushes);
    const wasUpToDate = !!remote?.fingerprint && remote.fingerprint === fingerprintNow(run.adapter, await loadOutgoingDive(tx, run.userId, diveId));
    const t: Taking = { tx, run, diveId, d, actor, current, changes: {}, columns: {}, overrides: new Set(current.overrides) };
    const taken: SyncedField[] = [];
    for (const field of fields) {
      const before = Object.keys(t.changes).length;
      await takeField(t, field);
      if (Object.keys(t.changes).length > before) taken.push(field);
    }
    const { changes } = t;
    if (taken.length === 0) return [];
    if (t.overrides.size !== current.overrides.length) {
      changes.overrides = { from: current.overrides, to: [...t.overrides] };
      t.columns.overrides = [...t.overrides];
    }
    await tx.update(dive).set({ ...t.columns, version: sql`${dive.version} + 1`, updatedAt: new Date() }).where(eq(dive.id, diveId));
    await writeRevision(tx, 'dive', diveId, actor, 'update', changes);
    if (changes.startsAt) await renumber(tx, [current.diverId]);
    if (wasUpToDate && remote && !sending) {
      const loaded = await loadOutgoingDive(tx, run.userId, diveId);
      await tx.insert(push).values({
        diveId, connectionId: run.connectionId, userId: run.userId, provider: run.adapter.id, mode: run.adapter.dives!.mode,
        action: 'link', state: 'confirmed', remoteId: remote.remoteId, remoteNumber: remote.remoteNumber, diveVersion: loaded.row.version,
        fingerprint: fingerprintNow(run.adapter, loaded),
      });
    }
    return taken;
  }

  /** A field's value as the preview shows it: the site's and people's names, the local start, the number or text. */
  async function shown(run: ProviderRun, field: SyncedField, c: Comparable, hubSiteId: string | null): Promise<ShownValue> {
    if (field === 'site') {
      if (hubSiteId) return (await db.select({ name: diveSite.name }).from(diveSite).where(eq(diveSite.id, hubSiteId)))[0]?.name ?? null;
      return c.site ? run.context.sites[c.site]?.name ?? c.site : null;
    }
    if (field === 'buddies') {
      const source = run.adapter.accountSource;
      if (!source || c.buddies.length === 0) return [];
      const rows = await db.select({ name: diver.name }).from(diverExternalId).innerJoin(diver, eq(diver.id, diverExternalId.diverId))
        .where(and(eq(diverExternalId.source, source), inArray(diverExternalId.externalId, c.buddies)));
      return rows.map((r) => r.name).sort();
    }
    if (field === 'startsAt') return c.startsAt === null ? null : new Date(c.startsAt * 60_000).toISOString().slice(0, 16).replace('T', ' ');
    return c[field];
  }

  async function runOf(q: Db | Tx, userId: string, adapter: ProviderAdapter, s: {
    diverId: string; connectionId: string | null; mode: DiveImportMode; windowMinutes: number; choices: Record<string, ComputerChoice>;
    context: ImportContext;
  }): Promise<ProviderRun> {
    return { userId, adapter, ...s, managed: await managedDiverIds(q, userId), sitesAllowed: await siteDataAllowed(q, adapter.id) };
  }

  return { runOf, sitesOf, placeTime, baseOf, hubOf, changesOf, takeChanges, fill, shown };
}

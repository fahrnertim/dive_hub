// A Diver's certification cards (ADR 0050): typed by hand or imported from a Provider's own record (SSI's `get_ccards`).
// Seen and changed only by the Users who manage the Diver; an external Diver has none (nobody manages it, ADR 0028).
// An imported card is the agency's record: its fields are read-only here, only its notes change. A card's picture is
// fetched by a worker job into the blob store and served only through the API.
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db, Queryable } from '../db/client.js';
import { certification, original } from '../db/schema.js';
import type { CertificationImageState, CertificationVerification } from '../db/schema.js';
import { managementOf } from '../divers/management.js';
import { writeRevision } from '../dives/revisions.js';
import type { ConnectionService } from '../providers/connection-service.js';
import { ProviderError, type RemoteCertification } from '../providers/provider.js';
import { named, ProviderServiceError, type ProviderRegistry } from '../providers/registry.js';
import type { BlobStore } from '../storage/blob-store.js';

/** The worker task that fetches one card's picture (payload `{ certificationId }`). */
export const CERTIFICATION_IMAGE_TASK = 'certification_image';
/** Attempts before a picture is `failed` (a "Fetch again" starts afresh). */
export const CERTIFICATION_IMAGE_ATTEMPTS = 3;

/** A card expiring within this many days is `soon` (ADR 0050, as built in slice 25c). */
export const EXPIRING_SOON_DAYS = 90;

export type CertificationExpiry = 'none' | 'valid' | 'soon' | 'expired';

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Where a card stands on `today` (a UTC day): a card is valid on the day it expires. */
export function expiryOf(expiresOn: string | null, today = isoDay(new Date())): CertificationExpiry {
  if (!expiresOn) return 'none';
  if (expiresOn < today) return 'expired';
  const limit = isoDay(new Date(new Date(`${today}T00:00:00Z`).getTime() + EXPIRING_SOON_DAYS * 86_400_000));
  return expiresOn <= limit ? 'soon' : 'valid';
}

/** What the Divers list shows of a Diver's cards. `newest` is the first card of the list: an expired card only when all are. */
export interface CertificationSummary {
  count: number;
  newest: { agency: string; level: string } | null;
  expired: number;
  expiringSoon: number;
}

export const NO_CERTIFICATIONS: CertificationSummary = { count: 0, newest: null, expired: 0, expiringSoon: 0 };

export class CertificationError extends Error {
  constructor(
    readonly code:
      | 'diver_not_found' | 'certification_not_found' | 'certification_changed' | 'certification_read_only'
      | 'certification_image_not_found' | 'invalid_input',
  ) {
    super(code);
  }
}

export interface CertificationInput {
  agency: string;
  level: string;
  number?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  divesAtIssue?: number | null;
  instructorName?: string | null;
  instructorNumber?: string | null;
  centreName?: string | null;
  centreNumber?: string | null;
  centreCity?: string | null;
  centreCountry?: string | null;
  notes?: string | null;
  /** The User has looked at the card (`card_seen`); false: only declared. */
  cardSeen?: boolean;
}

type Row = typeof certification.$inferSelect;

export interface CertificationView {
  id: string;
  diverId: string;
  agency: string;
  level: string;
  number: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  divesAtIssue: number | null;
  instructorName: string | null;
  instructorNumber: string | null;
  centreName: string | null;
  centreNumber: string | null;
  centreCity: string | null;
  centreCountry: string | null;
  verification: CertificationVerification;
  notes: string | null;
  /** The Provider the card was imported from (`ssi`); null for one typed by hand. Its fields are then read-only. */
  source: string | null;
  cardId: string | null;
  category: string | null;
  /** `none` without an expiry date; `soon` within 90 days; `expired` after the day. */
  expiry: CertificationExpiry;
  imageState: CertificationImageState;
  /** The API path of the picture, only while `imageState` is `stored`. */
  imageUrl: string | null;
  importedAt: string | null;
  version: number;
  createdAt: string;
}

export type ImportResult = 'created' | 'updated' | 'unchanged' | 'deleted_earlier' | 'not_at_provider';

export interface ImportReport {
  created: number;
  updated: number;
  unchanged: number;
  items: { result: ImportResult; level: string; certificationId: string | null }[];
}

const isCalendarDate = (text: string) => {
  const parsed = new Date(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(text);
};

const TEXT_FIELDS = [
  'number', 'instructorName', 'instructorNumber', 'centreName', 'centreNumber', 'centreCity', 'centreCountry', 'notes',
] as const;
const LIMIT: Record<string, number> = { agency: 100, level: 200, notes: 2000 };

/** What a card is called in a Revision: never the instructor or the numbers. */
const label = (r: { agency: string; level: string }) => `${r.agency} ${r.level}`;

export function createCertificationService(deps: { db: Db; blobs: BlobStore; registry: ProviderRegistry; connections: ConnectionService }) {
  const { db, blobs, registry, connections } = deps;

  async function managedOrThrow(userId: string, diverId: string) {
    if (!(await managementOf(db, userId, diverId))) throw new CertificationError('diver_not_found');
  }

  async function rowOrThrow(diverId: string, id: string): Promise<Row> {
    const [row] = await db.select().from(certification)
      .where(and(eq(certification.id, id), eq(certification.diverId, diverId), isNull(certification.deletedAt)));
    if (!row) throw new CertificationError('certification_not_found');
    return row;
  }

  const view = (r: Row): CertificationView => ({
    id: r.id, diverId: r.diverId, agency: r.agency, level: r.level, number: r.number, issuedOn: r.issuedOn, expiresOn: r.expiresOn,
    divesAtIssue: r.divesAtIssue, instructorName: r.instructorName, instructorNumber: r.instructorNumber, centreName: r.centreName,
    centreNumber: r.centreNumber, centreCity: r.centreCity, centreCountry: r.centreCountry, verification: r.verification,
    notes: r.notes, source: r.source, cardId: r.externalId, category: r.category, expiry: expiryOf(r.expiresOn), imageState: r.imageState,
    imageUrl: r.imageState === 'stored' ? `/api/divers/${r.diverId}/certifications/${r.id}/image` : null,
    importedAt: r.importedAt?.toISOString() ?? null, version: r.version, createdAt: r.createdAt.toISOString(),
  });

  /** Trims text; empty is null. Checks the lengths and dates a card may have. */
  function cleaned(input: CertificationInput) {
    const text = (v: string | null | undefined) => {
      const t = v?.trim();
      return t ? t : null;
    };
    const agency = input.agency.trim();
    const level = input.level.trim();
    if (!agency || !level || agency.length > LIMIT.agency! || level.length > LIMIT.level!) throw new CertificationError('invalid_input');
    const out = {
      agency, level,
      ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, text(input[k])])),
    } as Record<string, string | number | null>;
    for (const k of TEXT_FIELDS) {
      const max = LIMIT[k] ?? 200;
      if (typeof out[k] === 'string' && (out[k] as string).length > max) throw new CertificationError('invalid_input');
    }
    for (const k of ['issuedOn', 'expiresOn'] as const) {
      const v = input[k] ?? null;
      if (v !== null && !isCalendarDate(v)) throw new CertificationError('invalid_input');
      out[k] = v;
    }
    if (out.issuedOn && out.expiresOn && out.expiresOn < out.issuedOn) throw new CertificationError('invalid_input');
    const dives = input.divesAtIssue ?? null;
    if (dives !== null && (!Number.isInteger(dives) || dives < 0 || dives > 100_000)) throw new CertificationError('invalid_input');
    out.divesAtIssue = dives;
    return out as { agency: string; level: string; issuedOn: string | null; expiresOn: string | null; divesAtIssue: number | null } & Record<(typeof TEXT_FIELDS)[number], string | null>;
  }

  /** Deletes a blob unless another card (or an Original, which share the store) still has its key. */
  async function releaseBlob(key: string | null, exceptId: string | null) {
    if (!key) return;
    const [card] = await db.select({ id: certification.id }).from(certification)
      .where(and(eq(certification.imageKey, key), exceptId ? ne(certification.id, exceptId) : undefined)).limit(1);
    const [file] = await db.select({ id: original.id }).from(original).where(eq(original.storageKey, key)).limit(1);
    if (!card && !file) await blobs.delete(key);
  }

  const queueImage = (tx: Queryable, certificationId: string) =>
    tx.execute(sql`select graphile_worker.add_job(${CERTIFICATION_IMAGE_TASK}, json_build_object('certificationId', ${certificationId}::text),
      job_key => ${'certification-image:' + certificationId}, max_attempts => ${CERTIFICATION_IMAGE_ATTEMPTS})`);

  /** The fields an import writes, from the Provider's card. */
  const fromRemote = (c: RemoteCertification) => ({
    agency: c.agency, level: c.level, number: null as string | null, issuedOn: c.issuedOn, expiresOn: c.expiresOn, divesAtIssue: c.divesAtIssue,
    instructorName: c.instructorName, instructorNumber: c.instructorNumber, centreName: c.centreName, centreNumber: c.centreNumber,
    centreCity: c.centreCity, centreCountry: c.centreCountry, remoteCourseId: c.courseId, category: c.category, imageUrl: c.imageUrl,
  });
  const IMPORTED_FIELDS = [
    'agency', 'level', 'issuedOn', 'expiresOn', 'divesAtIssue', 'instructorName', 'instructorNumber', 'centreName', 'centreNumber',
    'centreCity', 'centreCountry', 'remoteCourseId', 'category', 'imageUrl',
  ] as const;

  /** Expired cards last: the list's first sort key. */
  const listOrder = () => sql`coalesce(${certification.expiresOn} < ${isoDay(new Date())}::date, false)`;

  return {
    /** A Diver's cards, the newest issue first. Only for a User who manages the Diver. */
    async list(userId: string, diverId: string): Promise<CertificationView[]> {
      await managedOrThrow(userId, diverId);
      const rows = await db.select().from(certification)
        .where(and(eq(certification.diverId, diverId), isNull(certification.deletedAt)))
        .orderBy(listOrder(), sql`${certification.issuedOn} desc nulls last`, desc(certification.createdAt));
      return rows.map(view);
    },

    /** The summaries of several Divers' cards, by Diver id (no managing check: the caller passes the User's own Divers). */
    async summaries(diverIds: string[]): Promise<Map<string, CertificationSummary>> {
      const out = new Map<string, CertificationSummary>();
      if (diverIds.length === 0) return out;
      const rows = await db.select({
        diverId: certification.diverId, agency: certification.agency, level: certification.level, expiresOn: certification.expiresOn,
      }).from(certification)
        .where(and(inArray(certification.diverId, diverIds), isNull(certification.deletedAt)))
        .orderBy(listOrder(), sql`${certification.issuedOn} desc nulls last`, desc(certification.createdAt));
      for (const r of rows) {
        const s = out.get(r.diverId) ?? { count: 0, newest: { agency: r.agency, level: r.level }, expired: 0, expiringSoon: 0 };
        const expiry = expiryOf(r.expiresOn);
        s.count += 1;
        if (expiry === 'expired') s.expired += 1;
        if (expiry === 'soon') s.expiringSoon += 1;
        out.set(r.diverId, s);
      }
      return out;
    },

    async create(userId: string, diverId: string, input: CertificationInput): Promise<CertificationView> {
      await managedOrThrow(userId, diverId);
      const values = cleaned(input);
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(certification).values({
          diverId, ...values, verification: input.cardSeen ? 'card_seen' : 'self_declared',
        }).returning();
        await writeRevision(tx, 'diver', diverId, { type: 'user', id: userId }, 'create', { certification: { from: null, to: label(row!) } });
        return view(row!);
      });
    },

    /**
     * Changes a card with the version the client saw. An imported card takes only its notes (`certification_read_only`
     * for anything else). `version` is checked in the update itself.
     */
    async update(userId: string, diverId: string, id: string, version: number, input: CertificationInput): Promise<CertificationView> {
      await managedOrThrow(userId, diverId);
      const current = await rowOrThrow(diverId, id);
      const imported = current.source !== null;
      const values = cleaned(imported ? { ...input, agency: current.agency, level: current.level } : input);
      if (imported) {
        // A field the client leaves out isn't a change; one it sends has to be what the agency's record says.
        const touched = [
          ...(['number', 'instructorName', 'instructorNumber', 'centreName', 'centreNumber', 'centreCity', 'centreCountry'] as const)
            .filter((k) => input[k] !== undefined && values[k] !== current[k]),
          ...(['issuedOn', 'expiresOn', 'divesAtIssue'] as const).filter((k) => input[k] !== undefined && values[k] !== current[k]),
        ];
        if (input.agency.trim() !== current.agency || input.level.trim() !== current.level || touched.length > 0 || input.cardSeen === true) {
          throw new CertificationError('certification_read_only');
        }
      }
      return db.transaction(async (tx) => {
        const set = imported
          ? { notes: values.notes }
          : { ...values, verification: (input.cardSeen ? 'card_seen' : 'self_declared') as CertificationVerification };
        const [row] = await tx.update(certification)
          .set({ ...set, version: current.version + 1, updatedAt: new Date() })
          .where(and(eq(certification.id, id), eq(certification.version, version), isNull(certification.deletedAt)))
          .returning();
        if (!row) throw new CertificationError('certification_changed');
        await writeRevision(tx, 'diver', diverId, { type: 'user', id: userId }, 'edit', { certification: { from: label(current), to: label(row) } });
        return view(row);
      });
    },

    /** Deletes a card (soft: a re-import leaves it deleted) and its picture. */
    async remove(userId: string, diverId: string, id: string): Promise<void> {
      await managedOrThrow(userId, diverId);
      const current = await rowOrThrow(diverId, id);
      // Only the request that deletes it records the deletion and lets the picture go; one at the same time finds it gone.
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx.update(certification).set({
          deletedAt: new Date(), updatedAt: new Date(), version: sql`${certification.version} + 1`,
          imageKey: null, imageSha256: null, imageBytes: null, imageState: 'none',
        }).where(and(eq(certification.id, id), isNull(certification.deletedAt))).returning({ id: certification.id });
        if (row) await writeRevision(tx, 'diver', diverId, { type: 'user', id: userId }, 'delete', { certification: { from: label(current), to: null } });
        return !!row;
      });
      if (!deleted) throw new CertificationError('certification_not_found');
      await releaseBlob(current.imageKey, id);
    },

    /** The blob keys of a Diver's card pictures, before the Diver is deleted (its cards go with it). */
    async imageKeysOf(diverId: string): Promise<string[]> {
      const rows = await db.select({ key: certification.imageKey }).from(certification)
        .where(and(eq(certification.diverId, diverId), sql`${certification.imageKey} is not null`));
      return [...new Set(rows.map((r) => r.key!))];
    },

    /** Removes pictures nothing refers to any more (after their cards are gone). */
    async releaseKeys(keys: string[]): Promise<void> {
      for (const key of keys) await releaseBlob(key, null);
    },

    /** The card's picture; `certification_image_not_found` until it is stored. */
    async image(userId: string, diverId: string, id: string): Promise<{ bytes: Buffer; mediaType: string; sha256: string }> {
      await managedOrThrow(userId, diverId);
      const row = await rowOrThrow(diverId, id);
      if (row.imageState !== 'stored' || !row.imageKey) throw new CertificationError('certification_image_not_found');
      return { bytes: await blobs.read(row.imageKey), mediaType: 'image/png', sha256: row.imageSha256! };
    },

    /** "Fetch again": a card of a Provider whose picture failed (or any imported card's) is queued afresh. */
    async refetchImage(userId: string, diverId: string, id: string): Promise<void> {
      await managedOrThrow(userId, diverId);
      const row = await rowOrThrow(diverId, id);
      if (!row.imageUrl) throw new CertificationError('certification_image_not_found');
      await db.transaction(async (tx) => {
        await tx.update(certification).set({ imageState: 'pending' }).where(eq(certification.id, id));
        await queueImage(tx, id);
      });
    },

    /**
     * Reads the account's cards live and brings the Connection's Diver up to date (ADR 0050): a new card is created
     * `verified_with_agency`, a card already here (same Provider and card ID) is updated from the Provider's data, a
     * card the User deleted stays deleted, a card the Provider no longer lists stays and is reported.
     */
    async importFrom(userId: string, connectionId: string): Promise<ImportReport> {
      const conn = await connections.own(userId, connectionId);
      const adapter = registry.get(conn.provider);
      if (!adapter.certifications) throw new ProviderServiceError('provider_unsupported', named(adapter));
      await managedOrThrow(userId, conn.diverId);
      const remote = await connections.withAccess(conn, (ctx) => adapter.certifications!.find(ctx));
      const existing = await db.select().from(certification)
        .where(and(eq(certification.diverId, conn.diverId), eq(certification.source, conn.provider)));
      const byCard = new Map(existing.map((r) => [r.externalId, r]));
      const report: ImportReport = { created: 0, updated: 0, unchanged: 0, items: [] };
      const actor = { type: 'user' as const, id: userId };
      const seen = new Set<string>();

      await db.transaction(async (tx) => {
        for (const card of remote) {
          if (seen.has(card.remoteId)) continue;
          seen.add(card.remoteId);
          const values = fromRemote(card);
          const row = byCard.get(card.remoteId);
          if (!row) {
            const [created] = await tx.insert(certification).values({
              diverId: conn.diverId, ...values, source: conn.provider, externalId: card.remoteId, verification: 'verified_with_agency',
              imageState: card.imageUrl ? 'pending' : 'none', importedAt: new Date(),
            }).returning();
            await writeRevision(tx, 'diver', conn.diverId, actor, 'create', { certification: { from: null, to: label(created!) } });
            if (card.imageUrl) await queueImage(tx, created!.id);
            report.created += 1;
            report.items.push({ result: 'created', level: card.level, certificationId: created!.id });
            continue;
          }
          if (row.deletedAt) {
            report.items.push({ result: 'deleted_earlier', level: card.level, certificationId: null });
            continue;
          }
          const changed = IMPORTED_FIELDS.some((k) => values[k] !== row[k]);
          const needsImage = !!card.imageUrl && (changed || row.imageState === 'none' || row.imageState === 'failed' || row.imageState === 'pending');
          if (changed || needsImage) {
            await tx.update(certification).set({
              ...values, importedAt: new Date(), updatedAt: new Date(), ...(changed && { version: sql`${certification.version} + 1` }),
              ...(needsImage && { imageState: 'pending' as const }),
            }).where(eq(certification.id, row.id));
            if (needsImage) await queueImage(tx, row.id);
          }
          if (changed) {
            await writeRevision(tx, 'diver', conn.diverId, actor, 'edit', { certification: { from: label(row), to: label(values) } });
            report.updated += 1;
            report.items.push({ result: 'updated', level: card.level, certificationId: row.id });
          } else {
            report.unchanged += 1;
            report.items.push({ result: 'unchanged', level: card.level, certificationId: row.id });
          }
        }
        for (const row of existing) {
          if (row.deletedAt || !row.externalId || seen.has(row.externalId)) continue;
          report.items.push({ result: 'not_at_provider', level: row.level, certificationId: row.id });
        }
      });
      return report;
    },

    /**
     * The worker's job: fetches one card's picture and stores it. `final`: this was the last attempt, so a failure ends
     * as `failed`; otherwise the error is rethrown and the queue tries again.
     */
    async fetchImage(id: string, options: { final: boolean }): Promise<'stored' | 'failed' | 'skipped'> {
      const [row] = await db.select().from(certification).where(and(eq(certification.id, id), isNull(certification.deletedAt)));
      if (!row || !row.imageUrl || !row.source || row.imageState === 'stored') return 'skipped';
      try {
        const adapter = registry.get(row.source);
        if (!adapter.certifications) return 'skipped';
        const { bytes } = await adapter.certifications.image(row.imageUrl);
        const stored = await blobs.putOriginal(bytes);
        const old = row.imageKey;
        await db.update(certification).set({
          imageKey: stored.key, imageSha256: stored.sha256, imageBytes: stored.sizeBytes, imageState: 'stored', updatedAt: new Date(),
        }).where(and(eq(certification.id, id), isNull(certification.deletedAt)));
        // The row may have been deleted while the picture came: then nothing refers to it.
        const [after] = await db.select({ deletedAt: certification.deletedAt }).from(certification).where(eq(certification.id, id));
        if (after?.deletedAt) await releaseBlob(stored.key, id);
        else if (old && old !== stored.key) await releaseBlob(old, id);
        return 'stored';
      } catch (error) {
        if (!options.final) throw error;
        await db.update(certification).set({ imageState: 'failed', updatedAt: new Date() }).where(eq(certification.id, id));
        // Only the kind of failure; the address holds a card ID.
        if (!(error instanceof ProviderError || error instanceof ProviderServiceError)) throw error;
        return 'failed';
      }
    },
  };
}

export type CertificationService = ReturnType<typeof createCertificationService>;

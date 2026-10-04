// Database schema for the first slice: Garmin FIT import → Dive with Recording and samples.
// Terms follow docs/glossary.md; structure follows docs/spec/data-model.md.
// Users, sessions and credentials are Better Auth's tables in ./auth-schema.ts (ADR 0011).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { SiteImportCounts } from '../sites/import/import-plan.js';
import type { ImportArea, ImportedValues } from '../sites/import/site-source.js';
import type { ImportSource } from '../sites/sources.js';
import { WATER_TYPES, type DecoModel, type DiveMode, type GasCircuit, type WaterType } from '../vocabulary.js';
import { user } from './auth-schema.js';

export * from './auth-schema.js';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

export const diver = pgTable('diver', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

/** Which User manages which Diver; `isOwn` marks the User's own Diver. */
export const diverManagement = pgTable(
  'diver_management',
  {
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    diverId: uuid('diver_id').notNull().references(() => diver.id),
    isOwn: boolean('is_own').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.diverId] }),
    uniqueIndex('diver_management_own_uq').on(t.userId).where(sql`${t.isOwn}`),
  ],
);

export const userRole = pgEnum('user_role', ['user', 'admin']);

/**
 * An admin's offer to a person to become a User: a single-use, expiring link bound to an e-mail.
 * Only the SHA-256 of the token is stored; the link is shown once, when it is created.
 */
export const invitation = pgTable(
  'invitation',
  {
    id: id(),
    tokenSha256: text('token_sha256').notNull(),
    email: text('email').notNull(),
    role: userRole('role').notNull().default('user'),
    createdBy: uuid('created_by').notNull().references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => user.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('invitation_token_uq').on(t.tokenSha256),
    index('invitation_created_by_idx').on(t.createdBy),
  ],
);

/**
 * An admin-issued, single-use link with which a User sets a new password (ADR 0013).
 * Only the SHA-256 of the token is stored; the link is shown once, when it is created.
 */
export const passwordReset = pgTable(
  'password_reset',
  {
    id: id(),
    tokenSha256: text('token_sha256').notNull(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').notNull().references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('password_reset_token_uq').on(t.tokenSha256),
    index('password_reset_user_idx').on(t.userId),
    index('password_reset_created_by_idx').on(t.createdBy),
  ],
);

export const unitSystem = pgEnum('unit_system', ['metric', 'imperial']);

/** A User's display settings (ADR 0014). Null means: follow the browser. */
export const userPreference = pgTable('user_preference', {
  userId: uuid('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  /** BCP 47 language tag such as "de" or "en-GB". */
  language: text('language'),
  units: unitSystem('units'),
  updatedAt: updatedAt(),
});

export const device = pgTable(
  'device',
  {
    id: id(),
    diverId: uuid('diver_id').notNull().references(() => diver.id),
    manufacturer: text('manufacturer').notNull(),
    product: text('product'),
    serialNumber: text('serial_number').notNull(),
    firmware: text('firmware'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('device_serial_uq')
      .on(t.manufacturer, t.serialNumber)
      .where(sql`${t.deletedAt} is null`),
    index('device_diver_idx').on(t.diverId),
  ],
);

/** A file exactly as received from a Source. Belongs to one User; never shared between Users. */
export const original = pgTable(
  'original',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => user.id),
    sha256: text('sha256').notNull(),
    mediaType: text('media_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    fileName: text('file_name'),
    storageKey: text('storage_key').notNull(),
    receivedAt: createdAt(),
  },
  (t) => [uniqueIndex('original_user_sha_uq').on(t.userId, t.sha256)],
);

export const importStatus = pgEnum('import_status', ['pending', 'processing', 'done', 'failed']);

/** Why a file was skipped, failed or needs a decision; clients translate it (ADR 0014). */
export const OUTCOME_REASONS = [
  'no_fit_file', 'not_a_dive', 'not_your_diver', 'overlaps_several_dives', 'max_depth_differs', 'file_failed',
] as const;
export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

/** Why a whole Import failed; anything unexpected is 'processing_failed', with details in `error`. */
export const IMPORT_ERROR_CODES = ['unsupported_file', 'processing_failed'] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export type ImportOutcome = {
  fileName: string;
  result: 'created' | 'attached' | 'updated' | 'unchanged' | 'duplicate-candidate' | 'skipped' | 'failed';
  diveId?: string;
  recordingId?: string;
  reason?: OutcomeReason;
  /** Technical detail in English (e.g. a parser error), shown next to the translated reason. */
  message?: string;
}[];

/** One ingestion of what a User delivered at once. */
export const importJob = pgTable(
  'import',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => user.id),
    status: importStatus('status').notNull().default('pending'),
    /** Uploaded file (single FIT or archive) awaiting processing; removed once processed. */
    uploadName: text('upload_name').notNull(),
    uploadSha256: text('upload_sha256').notNull(),
    uploadStorageKey: text('upload_storage_key'),
    outcome: jsonb('outcome').$type<ImportOutcome>().notNull().default([]),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('import_user_idx').on(t.userId, t.createdAt)],
);

/** Which Originals an Import delivered (an Original can be delivered again by a later Import). */
export const importOriginal = pgTable(
  'import_original',
  {
    importId: uuid('import_id').notNull().references(() => importJob.id),
    originalId: uuid('original_id').notNull().references(() => original.id),
  },
  (t) => [primaryKey({ columns: [t.importId, t.originalId] })],
);

export const waterType = pgEnum('water_type', [...WATER_TYPES]);

/**
 * A place where dives happen, shared by every User of the instance (ADR 0020). Any User edits it
 * (with `version` for optimistic locking, and Revisions); its creator or an admin deletes it while
 * no Dive is there. Position in WGS84 degrees, both or neither.
 */
export const diveSite = pgTable(
  'dive_site',
  {
    id: id(),
    name: text('name').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** ISO 3166-1 alpha-2, e.g. "EG"; clients show the name in their language. */
    country: text('country'),
    /** Free text, e.g. "Red Sea" or "Attersee". */
    waterBody: text('water_body'),
    description: text('description'),
    /** Deepest point divers reach here, in metres (ADR 0021). */
    maxDepthM: doublePrecision('max_depth_m'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** Set when this site was merged into another (merging comes later). */
    mergedInto: uuid('merged_into').references((): AnyPgColumn => diveSite.id),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('dive_site_position_idx').on(t.latitude, t.longitude),
    check('dive_site_position_ck', sql`(${t.latitude} is null) = (${t.longitude} is null) and ${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180`),
    check('dive_site_max_depth_ck', sql`${t.maxDepthM} > 0 and ${t.maxDepthM} <= 400`),
  ],
);

export const siteSource = pgEnum('site_source', ['osm', 'wikidata', 'ssi']);

/**
 * A Dive site's identifier at a Source (ADR 0021): unique per Source, at most one per Source and site.
 * `providesData`: the site was created or filled from this Source; `imported` holds what the Source
 * delivered last, the base of the next import's 3-way merge. Otherwise it is a reference only.
 */
export const diveSiteExternalId = pgTable(
  'dive_site_external_id',
  {
    id: id(),
    siteId: uuid('site_id').notNull().references(() => diveSite.id),
    source: siteSource('source').notNull(),
    externalId: text('external_id').notNull(),
    providesData: boolean('provides_data').notNull().default(false),
    imported: jsonb('imported').$type<ImportedValues>(),
    /** The Site import that last delivered it; null when a User entered it. */
    siteImportId: uuid('site_import_id').references((): AnyPgColumn => siteImport.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('dive_site_external_id_source_uq').on(t.source, t.externalId),
    uniqueIndex('dive_site_external_id_site_source_uq').on(t.siteId, t.source),
    check('dive_site_external_id_imported_ck', sql`${t.providesData} = (${t.imported} is not null)`),
  ],
);

export const siteImportStatus = pgEnum('site_import_status', ['queued', 'running', 'done', 'failed']);

export interface SiteImportProgress {
  /** What the import is doing now. */
  step: 'waiting' | 'osm' | 'wikidata' | 'saving';
  /** While saving: sites done of all. */
  done: number;
  total: number;
}

export interface SiteImportFinding {
  /** A new site within 200 m of one that was there before; merging comes later. */
  kind: 'near';
  siteId: string;
  name: string;
  nearSiteId: string;
  nearName: string;
  distanceM: number;
}

/**
 * An admin's run that fetches Dive sites from open Sources (ADR 0021). Only one is queued or running at
 * a time; the partial unique index refuses a second.
 */
export const siteImport = pgTable(
  'site_import',
  {
    id: id(),
    startedBy: uuid('started_by').references(() => user.id, { onDelete: 'set null' }),
    sources: jsonb('sources').$type<ImportSource[]>().notNull(),
    area: jsonb('area').$type<ImportArea>().notNull(),
    /** Language of names where a Source has several (Wikidata labels). */
    language: text('language').notNull(),
    /** When the admin confirmed the ODbL explanation (OSM imports only). */
    odblConfirmedAt: timestamp('odbl_confirmed_at', { withTimezone: true }),
    status: siteImportStatus('status').notNull().default('queued'),
    progress: jsonb('progress').$type<SiteImportProgress>().notNull().default({ step: 'waiting', done: 0, total: 0 }),
    counts: jsonb('counts').$type<SiteImportCounts>(),
    findings: jsonb('findings').$type<SiteImportFinding[]>().notNull().default([]),
    /** Why it failed, as a problem code (e.g. source_unavailable). */
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('site_import_one_active_uq').on(sql`(true)`).where(sql`${t.status} in ('queued', 'running')`),
    index('site_import_created_idx').on(t.createdAt),
  ],
);

/**
 * Dive values that come from the Primary recording unless the User overrode them (ADR 0015).
 * `startsAt` covers the start time and its UTC offset together.
 */
export const OVERRIDABLE_FIELDS = [
  'number', 'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC', 'waterType',
] as const;
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

/**
 * One Diver's logbook entry. The recording-derived columns hold the value in effect: the User's
 * Override for the fields listed in `overrides`, the Primary recording's value for all others.
 */
export const dive = pgTable(
  'dive',
  {
    id: id(),
    diverId: uuid('diver_id').notNull().references(() => diver.id),
    number: integer('number'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** Local UTC offset at the dive, in seconds (gap A8). */
    utcOffsetSeconds: integer('utc_offset_seconds'),
    durationSeconds: real('duration_seconds').notNull(),
    maxDepthM: real('max_depth_m'),
    avgDepthM: real('avg_depth_m'),
    /** Lowest water temperature (UDDF: lowesttemperature). */
    waterTemperatureC: real('water_temperature_c'),
    waterType: waterType('water_type'),
    /** The Dive's own notes; not a recording value. */
    notes: text('notes'),
    /** Where the Dive was (ADR 0020); the Dive's own value, not an Override. */
    siteId: uuid('site_id').references(() => diveSite.id),
    /** Fields whose value the User set by hand; they win over the Primary recording. */
    overrides: text('overrides').array().$type<OverridableField[]>().notNull().default(sql`'{}'`),
    primaryRecordingId: uuid('primary_recording_id'),
    /** Increases with every change; edits name the version they started from (optimistic locking). */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('dive_diver_start_idx').on(t.diverId, t.startsAt), index('dive_site_idx').on(t.siteId)],
);

/** A Device's own summary of a Recording, in our vocabulary (ADR 0015). */
export type RecordingSummary = {
  diveNumber?: number;
  diveMode?: DiveMode;
  decoModel?: DecoModel;
  gfLow?: number;
  gfHigh?: number;
  waterType?: WaterType;
  waterDensity?: number;
  gases?: { o2: number; he: number; circuit?: GasCircuit }[];
  minTemperatureC?: number;
  maxTemperatureC?: number;
  avgHeartRate?: number;
  surfaceIntervalSeconds?: number;
  cnsStart?: number;
  cnsEnd?: number;
  n2Start?: number;
  n2End?: number;
  avgAscentRateMps?: number;
  /** Source values we have no word for yet, by source field name (data model: extension area). */
  extras?: Record<string, string>;
};

/** The data one Device captured for one Dive. */
export const recording = pgTable(
  'recording',
  {
    id: id(),
    diveId: uuid('dive_id').references(() => dive.id),
    deviceId: uuid('device_id').references(() => device.id),
    originalId: uuid('original_id').notNull().references(() => original.id),
    importId: uuid('import_id').notNull().references(() => importJob.id),
    /** Identity for re-imports: device serial + device start time (or source + external id). */
    recordingKey: text('recording_key').notNull(),
    parser: text('parser').notNull(),
    parserVersion: text('parser_version').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    utcOffsetSeconds: integer('utc_offset_seconds'),
    durationSeconds: real('duration_seconds').notNull(),
    maxDepthM: real('max_depth_m'),
    avgDepthM: real('avg_depth_m'),
    /** Where the Device placed the start and the end of the dive, WGS84 degrees (B6, ADR 0020). */
    entryLatitude: doublePrecision('entry_latitude'),
    entryLongitude: doublePrecision('entry_longitude'),
    exitLatitude: doublePrecision('exit_latitude'),
    exitLongitude: doublePrecision('exit_longitude'),
    /** Set once the Original was read for positions (imported with them, or backfilled). */
    positionsReadAt: timestamp('positions_read_at', { withTimezone: true }),
    summary: jsonb('summary').$type<RecordingSummary>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('recording_key_uq').on(t.recordingKey).where(sql`${t.deletedAt} is null`),
    index('recording_dive_idx').on(t.diveId),
    index('recording_original_idx').on(t.originalId),
  ],
);

/**
 * One channel of a Recording's samples (depth, temperature, …) as parallel arrays:
 * offsets from the Recording start in milliseconds, and values in SI-based display units
 * (m, °C, bar, bpm). A cache that can always be re-derived from the Original.
 */
export const sampleSeries = pgTable(
  'sample_series',
  {
    recordingId: uuid('recording_id').notNull().references(() => recording.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    offsetsMs: integer('offsets_ms').array().notNull(),
    values: real('values').array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.channel] })],
);

export const recordingEvent = pgTable(
  'recording_event',
  {
    id: id(),
    recordingId: uuid('recording_id').notNull().references(() => recording.id, { onDelete: 'cascade' }),
    offsetMs: integer('offset_ms').notNull(),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('recording_event_recording_idx').on(t.recordingId)],
);

export const candidateResolution = pgEnum('candidate_resolution', ['attached', 'new_dive', 'discarded']);

/**
 * A Recording that might belong to more than one Dive, or doesn't clearly match one, waiting for
 * the User (ADR 0016). Open while `resolution` is null. A discarded Recording stays, detached and
 * hidden, so importing the same file again doesn't bring the question back; it can be reopened.
 */
export const duplicateCandidate = pgTable(
  'duplicate_candidate',
  {
    id: id(),
    recordingId: uuid('recording_id').notNull().references(() => recording.id),
    candidateDiveIds: uuid('candidate_dive_ids').array().notNull(),
    reason: text('reason').notNull(),
    resolution: candidateResolution('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('duplicate_candidate_recording_idx').on(t.recordingId)],
);

export const diverSource = pgEnum('diver_source', ['ssi', 'padi']);

/**
 * A Diver's account at a service (ADR 0024), e.g. the SSI user master ID: unique per Source, at most one per
 * Source and Diver. Certification and membership numbers are not External IDs.
 */
export const diverExternalId = pgTable(
  'diver_external_id',
  {
    id: id(),
    diverId: uuid('diver_id').notNull().references(() => diver.id),
    source: diverSource('source').notNull(),
    externalId: text('external_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('diver_external_id_source_uq').on(t.source, t.externalId),
    uniqueIndex('diver_external_id_diver_source_uq').on(t.diverId, t.source),
  ],
);

export const target = pgEnum('target', ['ssi']);
export const connectionState = pgEnum('connection_state', ['active', 'needs_sign_in']);

/**
 * One User's link to a Target for one of their Divers (ADR 0024): the account there, and what lets Dive Hub
 * act for it. `token` and `password` are sealed (src/secrets/secret-box.ts); the password is kept only when
 * the User chose "Keep me signed in".
 */
export const connection = pgTable(
  'connection',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    diverId: uuid('diver_id').notNull().references(() => diver.id),
    target: target('target').notNull(),
    /** The account at the Target (SSI: user master ID) and the e-mail it signs in with. */
    accountId: text('account_id').notNull(),
    accountEmail: text('account_email').notNull(),
    keepSignedIn: boolean('keep_signed_in').notNull(),
    token: text('token'),
    password: text('password'),
    state: connectionState('state').notNull().default('active'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('connection_user_diver_target_uq').on(t.userId, t.diverId, t.target),
    check('connection_password_ck', sql`${t.password} is null or ${t.keepSignedIn}`),
  ],
);

export const pushMode = pgEnum('push_mode', ['api', 'qr']);
export const pushAction = pgEnum('push_action', ['create', 'update', 'link', 'delete']);
export const pushState = pgEnum('push_state', ['pending', 'handed_over', 'confirmed', 'failed']);

/** A field SSI stored differently from what was sent (read back after saving). */
export interface PushDifference {
  field: string;
  sent: string | number | null;
  stored: string | number | null;
}

/**
 * One Dive sent to one Target (ADR 0024): what was done (create, update, link to a dive already there,
 * delete), the Target's own ID and number for it, what was sent and what it stored. Whether a Push is
 * outdated is worked out from `fingerprint`, not stored.
 */
export const push = pgTable(
  'push',
  {
    id: id(),
    diveId: uuid('dive_id').notNull().references(() => dive.id),
    connectionId: uuid('connection_id').references(() => connection.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    target: target('target').notNull(),
    mode: pushMode('mode').notNull(),
    action: pushAction('action').notNull(),
    state: pushState('state').notNull(),
    /** The Target's ID and number of the dive (SSI dive ID, SSI dive number). */
    remoteId: text('remote_id'),
    remoteNumber: integer('remote_number'),
    /** What we sent to find the dive again (SSI: the dive computer's dive reference). */
    remoteReference: text('remote_reference'),
    diveVersion: integer('dive_version').notNull(),
    /** A hash of the Dive's values as sent; the Push is outdated when the Dive's differs. */
    fingerprint: text('fingerprint'),
    /** The record sent, without its sample datasets. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    differences: jsonb('differences').$type<PushDifference[]>(),
    /** Why it failed, as a problem code. */
    errorCode: text('error_code'),
    createdAt: createdAt(),
  },
  (t) => [index('push_dive_idx').on(t.diveId, t.createdAt)],
);

export const actorType = pgEnum('actor_type', ['user', 'import', 'system', 'site_import']);

/** A recorded change to logbook data: who or what changed which values, and when. */
export const revision = pgTable(
  'revision',
  {
    id: id(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    cause: text('cause').notNull(),
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    at: createdAt(),
  },
  (t) => [index('revision_entity_idx').on(t.entityType, t.entityId)],
);

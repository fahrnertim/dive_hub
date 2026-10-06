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
import { WATER_TYPES, type DecoModel, type DiveMode, type GasCircuit, type SiteWaterType, type WaterType } from '../vocabulary.js';
import { user } from './auth-schema.js';

export * from './auth-schema.js';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

/**
 * A person who dives (ADR 0016, 0028). Every User sees every Diver by name; one without managing Users is external
 * (a buddy), shared like a Dive site: anyone renames it, `created_by` or an admin deletes it while no Dive lists it.
 */
export const diver = pgTable('diver', {
  id: id(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  /**
   * Set when this external Diver was merged into another (ADR 0028, amended): claimed by its person's User through their
   * account at a Provider, or merged by an admin. It is deleted then, and kept for the history.
   */
  mergedInto: uuid('merged_into').references((): AnyPgColumn => diver.id),
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

/**
 * Where a start time's UTC offset came from (ADR 0030): the device recorded it, the time zone at the dive's position, the
 * Diver's Dives nearby, or nothing (`unknown`: the wall-clock time is kept as if it were UTC, the offset is null, and
 * matching compares local times). `device` with a null offset is a true instant whose local offset isn't known.
 */
export const UTC_OFFSET_SOURCES = ['device', 'position', 'nearby', 'unknown'] as const;
export type UtcOffsetSource = (typeof UTC_OFFSET_SOURCES)[number];
export const utcOffsetSource = pgEnum('utc_offset_source', [...UTC_OFFSET_SOURCES]);

/** Why a file was skipped, failed or needs a decision; clients translate it (ADR 0014). */
export const OUTCOME_REASONS = [
  // `no_fit_file` is what `no_dive_file` was called before other formats were read (ADR 0037); old Imports keep it.
  'no_dive_file', 'no_fit_file', 'not_a_dive', 'not_your_diver', 'overlaps_several_dives', 'max_depth_differs', 'file_failed',
  // The Recording is on a Dive the User deleted: it isn't created again (ADR 0026).
  'deleted_earlier',
  // The same dive is here from a file that holds more (Suunto's JSON beside its FIT, ADR 0037).
  'fuller_copy_here',
  // A Provider's dive (ADR 0030): sent by Dive Hub (already ours); a logbook entry matching no Dive while the import only
  // adds; several Dives and no decision that still fits; left out by the User.
  'sent_by_dive_hub', 'no_match', 'ambiguous', 'left_out',
] as const;
export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

/** Why a whole Import failed; anything unexpected is 'processing_failed', with details in `error`. */
export const IMPORT_ERROR_CODES = ['unsupported_file', 'processing_failed'] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export type ImportOutcome = {
  fileName: string;
  /** `linked`: a Provider's logbook entry tied to a Dive here and filled where it was empty (ADR 0030). */
  result: 'created' | 'attached' | 'linked' | 'updated' | 'unchanged' | 'duplicate-candidate' | 'skipped' | 'failed';
  diveId?: string;
  recordingId?: string;
  reason?: OutcomeReason;
  /** Technical detail in English (e.g. a parser error), shown next to the translated reason. */
  message?: string;
  /** A Provider's dive: its ID and number there (ADR 0030). */
  remoteId?: string;
  remoteNumber?: number;
}[];

/** How a Provider's dives from one dive computer are used (ADR 0030). */
export type ComputerChoice = 'recordings' | 'entries';
/** What an import from a Provider may do (ADR 0030): nothing, only link and fill Dives here, or also create Dives. */
export const DIVE_IMPORT_MODES = ['off', 'add', 'create'] as const;
export type DiveImportMode = (typeof DIVE_IMPORT_MODES)[number];
/** Matching windows for a Provider's logbook entries, in minutes (ADR 0030). */
export const MATCHING_WINDOWS = [5, 15, 30, 60] as const;

/**
 * What an Import from a Provider keeps besides its Originals (ADR 0030): the context of the Provider's records (whose
 * account each person entry is, each site's name and position; no names of people), the choice per computer and per
 * ambiguous logbook entry, and the settings it ran with.
 */
export interface ProviderImportPlan {
  context: {
    people: Record<string, string>;
    /** Country: ISO 3166-1 alpha-2 when the Provider gives one we know. */
    sites: Record<string, {
      name: string; latitude: number | null; longitude: number | null; country: string | null;
      /** Missing on Imports made before it was kept. */
      waterType?: SiteWaterType | null;
    }>;
  };
  computers: Record<string, ComputerChoice>;
  /** Per remote dive ID: a Dive's ID, `new`, or `leave_out`. */
  decisions: Record<string, string>;
  /** Per `remoteId:field` changed in both places: whose value the Dive keeps (`hub` when missing). */
  conflicts?: Record<string, 'hub' | 'provider'>;
  mode: DiveImportMode;
  windowMinutes: number;
  /** The Connection's Diver: an import still runs after the Connection is gone. */
  diverId: string;
}

/** One ingestion of what a User delivered at once. */
export const importJob = pgTable(
  'import',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => user.id),
    status: importStatus('status').notNull().default('pending'),
    /** Uploaded file (single FIT or archive) awaiting processing; removed once processed. A Provider's import: its name. */
    uploadName: text('upload_name').notNull(),
    /** Null for an import from a Provider, whose Originals are stored when it starts (ADR 0030). */
    uploadSha256: text('upload_sha256'),
    uploadStorageKey: text('upload_storage_key'),
    /** An import of a Provider's dives (ADR 0030): which Provider, through which Connection, and what it was told. */
    provider: text('provider'),
    connectionId: uuid('connection_id').references((): AnyPgColumn => connection.id, { onDelete: 'set null' }),
    plan: jsonb('plan').$type<ProviderImportPlan>(),
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
    /**
     * Fresh, salt or brackish (ADR 0025): the water type of every Dive here. The device-only words of the enum
     * (en13319, custom) are the computer's setting, kept in the Recording's summary, never here.
     */
    waterType: waterType('water_type').$type<SiteWaterType>(),
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
    check('dive_site_water_type_ck', sql`${t.waterType} in ('fresh', 'salt', 'brackish')`),
  ],
);

export const siteSource = pgEnum('site_source', ['osm', 'wikidata', 'ssi']);

/**
 * A Dive site's identifier at a Source (ADR 0021): unique per Source, at most one per Source and site.
 * `providesData`: the site was created or filled from this Source; `imported` holds what the Source
 * delivered last, the base of the next import's 3-way merge. Otherwise it is a reference only; on a
 * hand-made site an import still keeps the Source's values in `imported`, offered on the site page (ADR 0025).
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
    check('dive_site_external_id_imported_ck', sql`not ${t.providesData} or ${t.imported} is not null`),
  ],
);

export const siteImportStatus = pgEnum('site_import_status', ['queued', 'running', 'done', 'failed']);

export interface SiteImportProgress {
  /** What the import is doing now. */
  step: 'waiting' | 'osm' | 'wikidata' | 'ssi' | 'saving';
  /** While saving: sites done of all. */
  done: number;
  total: number;
}

export type SiteImportFinding =
  /** A new site within 200 m of one that was there before (merge it there, ADR 0022). */
  | { kind: 'near'; siteId: string; name: string; nearSiteId: string; nearName: string; distanceM: number }
  /** A hand-made site that a Source describes: its page offers the Source's data (ADR 0025). */
  | { kind: 'offer'; siteId: string; name: string; source: ImportSource };

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
    /** When the admin confirmed that SSI gives no licence and importing is their risk (SSI imports only, ADR 0025). */
    ssiConfirmedAt: timestamp('ssi_confirmed_at', { withTimezone: true }),
    /** False: the run only matched and filled sites already in the hub. */
    createSites: boolean('create_sites').notNull().default(true),
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
  'number', 'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC',
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
    /** Where the offset came from (ADR 0030); follows the Primary recording like the start time. */
    utcOffsetSource: utcOffsetSource('utc_offset_source').notNull().default('device'),
    durationSeconds: real('duration_seconds').notNull(),
    maxDepthM: real('max_depth_m'),
    avgDepthM: real('avg_depth_m'),
    /** Lowest water temperature (UDDF: lowesttemperature). */
    waterTemperatureC: real('water_temperature_c'),
    /** The Dive's own notes; not a recording value. */
    notes: text('notes'),
    /** Where the Dive was (ADR 0020); the Dive's own value, not an Override. */
    siteId: uuid('site_id').references(() => diveSite.id),
    /** Fields whose value the User set by hand; they win over the Primary recording. */
    overrides: text('overrides').array().$type<OverridableField[]>().notNull().default(sql`'{}'`),
    primaryRecordingId: uuid('primary_recording_id'),
    /**
     * The Provider whose logbook entry this Dive was made from, without a Recording (ADR 0030): its values are that
     * entry's until a Recording attaches and becomes primary.
     */
    fromProvider: text('from_provider'),
    /** Increases with every change; edits name the version they started from (optimistic locking). */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('dive_diver_start_idx').on(t.diverId, t.startsAt), index('dive_site_idx').on(t.siteId)],
);

export const PARTICIPANT_ROLES = ['buddy', 'guide', 'instructor'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export const participantRole = pgEnum('participant_role', [...PARTICIPANT_ROLES]);

/** A Diver on a Dive besides its own Diver, with a role (ADR 0028): one role per Diver and Dive. */
export const participant = pgTable(
  'participant',
  {
    diveId: uuid('dive_id').notNull().references(() => dive.id, { onDelete: 'cascade' }),
    diverId: uuid('diver_id').notNull().references(() => diver.id),
    role: participantRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.diveId, t.diverId] }), index('participant_diver_idx').on(t.diverId)],
);

/** A Device's own summary of a Recording, in our vocabulary (ADR 0015). */
export type RecordingSummary = {
  diveNumber?: number;
  diveMode?: DiveMode;
  decoModel?: DecoModel;
  gfLow?: number;
  gfHigh?: number;
  /** The computer's salinity setting; the water of the Dive is its site's (ADR 0025). */
  waterType?: WaterType;
  /** Density the computer computed depths with, kg/m³. */
  waterDensity?: number;
  /** The mixes the computer knew; with a tank pod also the tank's size and its pressures at the start and the end. */
  gases?: { o2: number; he: number; circuit?: GasCircuit; tankVolumeL?: number; startPressureBar?: number; endPressureBar?: number }[];
  minTemperatureC?: number;
  maxTemperatureC?: number;
  avgHeartRate?: number;
  surfaceIntervalSeconds?: number;
  cnsStart?: number;
  cnsEnd?: number;
  /** The oxygen dose in OTU. */
  otuStart?: number;
  otuEnd?: number;
  /** Gas consumption at the surface as a tank pod measured it, L/min. */
  sacLpm?: number;
  /** The computer's personal setting where its model has one (Suunto: −2 to +2). */
  conservatism?: number;
  /** Air pressure at the surface as the computer measured it, bar. */
  surfacePressureBar?: number;
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
    /** Where the offset came from (ADR 0030): a Provider's copy without a time zone gets it from its position or nearby. */
    utcOffsetSource: utcOffsetSource('utc_offset_source').notNull().default('device'),
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

export const connectionState = pgEnum('connection_state', ['active', 'needs_sign_in']);
export const diveImportMode = pgEnum('dive_import_mode', [...DIVE_IMPORT_MODES]);

/**
 * One User's link to a Provider for one of their Divers (ADR 0024, 0027): the account there, and what lets Dive Hub
 * act for it. `credentials` is sealed (src/secrets/secret-box.ts) and shaped by the Provider's sign-in kind; a
 * password is in it only when the User chose "Keep me signed in".
 */
export const connection = pgTable(
  'connection',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    diverId: uuid('diver_id').notNull().references(() => diver.id),
    /** The Provider's id (src/providers/registry.ts knows which exist). */
    provider: text('provider').notNull(),
    /** The account at the Provider (SSI: user master ID) and what the User recognises it by (SSI: the e-mail). */
    accountId: text('account_id').notNull(),
    accountLabel: text('account_label').notNull(),
    /** Dive Hub may sign in again by itself (the password is kept). */
    keepSignedIn: boolean('keep_signed_in').notNull(),
    credentials: text('credentials'),
    state: connectionState('state').notNull().default('active'),
    /**
     * Pacing (src/providers/leases.ts): the next action may start from then on. An action holds its turn by setting
     * it a lease ahead, and sets it the Provider's pause after its end when done.
     */
    nextActionAt: timestamp('next_action_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** What an import of the account's dives may do (ADR 0030), and the window for matching logbook entries, in minutes. */
    importMode: diveImportMode('import_mode').notNull().default('off'),
    importWindowMinutes: integer('import_window_minutes').notNull().default(15),
    /** The User's choice per dive computer found at the Provider, by `manufacturer:serial`; kept here, not on the Device. */
    importComputers: jsonb('import_computers').$type<Record<string, ComputerChoice>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('connection_user_diver_provider_uq').on(t.userId, t.diverId, t.provider),
    check('connection_import_window_ck', sql`${t.importWindowMinutes} in (5, 15, 30, 60)`),
  ],
);

/**
 * An admin's permission (ADR 0030) to create Dive sites from a Provider's site data when Users import their dives: the
 * sites their dives name that no site here matches. SSI gives no licence for its site data (ADR 0024), so it is the
 * operator's decision, confirmed once, like an SSI site import. Without it, an import only links sites already here.
 */
export const providerSiteData = pgTable('provider_site_data', {
  provider: text('provider').primaryKey(),
  allowedAt: timestamp('allowed_at', { withTimezone: true }).notNull().defaultNow(),
  allowedBy: uuid('allowed_by').references(() => user.id, { onDelete: 'set null' }),
});

export const pushMode = pgEnum('push_mode', ['api', 'qr']);
export const pushAction = pgEnum('push_action', ['create', 'update', 'link', 'delete']);
export const pushState = pgEnum('push_state', ['pending', 'handed_over', 'confirmed', 'failed']);

/** A field the Provider stored differently from what was sent (read back after saving). */
export interface PushDifference {
  field: string;
  sent: string | number | null;
  stored: string | number | null;
}

/**
 * A Participant a Push left out (ADR 0029). `no_reference`: nothing tells the Provider who they are (an advisory
 * requirement unmet). `not_at_provider`: the Provider doesn't have them (SSI: not in the User's buddy list).
 */
export interface PushLeftOut {
  diverId: string;
  name: string;
  reason: 'no_reference' | 'not_at_provider';
}

/**
 * One Dive sent to one Provider (ADR 0024, 0027): what was done (create, update, link to a dive already there,
 * delete), the Provider's own ID and number for it, what was sent and what it stored. Whether a Push is
 * outdated is worked out from `fingerprint`, not stored.
 */
export const push = pgTable(
  'push',
  {
    id: id(),
    diveId: uuid('dive_id').notNull().references(() => dive.id),
    connectionId: uuid('connection_id').references(() => connection.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    mode: pushMode('mode').notNull(),
    action: pushAction('action').notNull(),
    state: pushState('state').notNull(),
    /** The Provider's ID and number of the dive (SSI dive ID, SSI dive number). */
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
    /** The remote dive was found gone (deleted at the Provider): the Dive has none there from here on. */
    remoteGone: boolean('remote_gone').notNull().default(false),
    /** Participants this Push couldn't carry (ADR 0029): an advisory requirement unmet, or not at the Provider. */
    leftOut: jsonb('left_out').$type<PushLeftOut[]>(),
    createdAt: createdAt(),
  },
  (t) => [index('push_dive_idx').on(t.diveId, t.createdAt)],
);

/**
 * One action per Dive and Provider at a time (src/providers/leases.ts), across every app process: held until
 * `locked_until` by `holder`, removed when the action ends. A row left by a process that crashed runs out by itself.
 */
export const diveLease = pgTable(
  'dive_lease',
  {
    diveId: uuid('dive_id').notNull().references(() => dive.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    holder: uuid('holder').notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.diveId, t.provider] })],
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

/**
 * Whether this instance offers the MCP endpoint (ADR 0035): one row once an admin decided, none means off. Switching
 * it off rejects every AI access at once; the accesses stay, so switching it on again restores those not revoked.
 */
export const aiAccessSetting = pgTable(
  'ai_access_setting',
  {
    /** Always true: the table holds one row. */
    id: boolean('id').primaryKey().default(true),
    enabled: boolean('enabled').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedBy: uuid('changed_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [check('ai_access_setting_one_row_ck', sql`${t.id}`)],
);

/** How a tool call ended: `error` carries a code in `error_code` (dive_not_found, invalid_input, timeout, …). */
export const aiAccessOutcome = pgEnum('ai_access_outcome', ['ok', 'error']);

/**
 * The AI access log (ADR 0035): one row per tool call through the MCP endpoint, shown to its User and kept 90 days.
 * `access_id` is the AI access (an `apikey` row) without a foreign key, and its name is copied, so the entries of a
 * revoked access stay readable. `arguments` never holds free text (search words are replaced, src/mcp/tools.ts).
 */
export const aiAccessLog = pgTable(
  'ai_access_log',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessId: uuid('access_id').notNull(),
    accessName: text('access_name').notNull(),
    tool: text('tool').notNull(),
    arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull().default({}),
    /** Dives, sites or Divers returned. */
    rows: integer('rows').notNull().default(0),
    outcome: aiAccessOutcome('outcome').notNull(),
    errorCode: text('error_code'),
    durationMs: integer('duration_ms').notNull(),
    at: createdAt(),
  },
  (t) => [index('ai_access_log_user_idx').on(t.userId, t.at), index('ai_access_log_at_idx').on(t.at)],
);

export const findingSeverity = pgEnum('finding_severity', ['info', 'note', 'caution']);

/**
 * That a Dive was assessed (ADR 0036), and from what: the engine version and the Primary recording as it was then.
 * A Dive is assessed again when either differs (src/assessment/assessment-service.ts). `applies` is false for dives
 * the rules don't cover (apnea, rebreathers): they have no findings.
 */
export const diveAssessment = pgTable('dive_assessment', {
  diveId: uuid('dive_id').primaryKey().references(() => dive.id, { onDelete: 'cascade' }),
  engineVersion: integer('engine_version').notNull(),
  recordingId: uuid('recording_id'),
  /** The Recording's `updated_at` when it was read: a re-import changes it. */
  recordingStamp: timestamp('recording_stamp', { withTimezone: true }),
  applies: boolean('applies').notNull(),
  /** The computer's no-decompression limit reached zero; the series rules read it. */
  enteredDeco: boolean('entered_deco').notNull().default(false),
  /** Typical seconds between depth samples; at 5 s and more short bursts can be missed. */
  sampleIntervalS: real('sample_interval_s'),
  /** Stretches of the ascent by speed, for colouring the profile: [start s, end s, band 1–3]. */
  ascentBands: jsonb('ascent_bands').$type<[number, number, 1 | 2 | 3][]>().notNull().default([]),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One thing the dive assessment noticed on a Dive (ADR 0036): at most one per rule. `values` holds what was measured
 * and the threshold it was held against; clients render the text from them. Kept on deleted Dives, which count nowhere.
 */
export const diveFinding = pgTable(
  'dive_finding',
  {
    id: id(),
    diveId: uuid('dive_id').notNull().references(() => dive.id, { onDelete: 'cascade' }),
    /** The Recording whose samples gave it; null for a finding from the Diver's dives around this one. */
    recordingId: uuid('recording_id'),
    rule: text('rule').notNull(),
    severity: findingSeverity('severity').notNull(),
    /** The stretch of the profile, seconds from the Recording's start. */
    startS: real('start_s'),
    endS: real('end_s'),
    values: jsonb('values').$type<Record<string, number | string | boolean | null>>().notNull(),
    engineVersion: integer('engine_version').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('dive_finding_dive_rule_uq').on(t.diveId, t.rule)],
);

/** A User put a finding on a Dive aside (ADR 0036). It goes when the finding does. */
export const findingDismissal = pgTable(
  'finding_dismissal',
  {
    diveId: uuid('dive_id').notNull().references(() => dive.id, { onDelete: 'cascade' }),
    rule: text('rule').notNull(),
    dismissedBy: uuid('dismissed_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.diveId, t.rule] })],
);

/** A rule a Diver's Users don't want to see on any of the Diver's Dives (ADR 0036). The findings stay as computed. */
export const mutedRule = pgTable(
  'muted_rule',
  {
    diverId: uuid('diver_id').notNull().references(() => diver.id, { onDelete: 'cascade' }),
    rule: text('rule').notNull(),
    mutedBy: uuid('muted_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.diverId, t.rule] })],
);

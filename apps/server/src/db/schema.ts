// Database schema for the first slice: Garmin FIT import → Dive with Recording and samples.
// Terms follow docs/glossary.md; structure follows docs/spec/data-model.md.
// Users, sessions and credentials are Better Auth's tables in ./auth-schema.ts (ADR 0011).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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

export type ImportOutcome = {
  fileName: string;
  result: 'created' | 'attached' | 'updated' | 'unchanged' | 'duplicate-candidate' | 'skipped' | 'failed';
  diveId?: string;
  recordingId?: string;
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
    primaryRecordingId: uuid('primary_recording_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('dive_diver_start_idx').on(t.diverId, t.startsAt)],
);

export type RecordingSummary = {
  diveNumber?: number;
  diveMode?: string;
  decoModel?: string;
  gfLow?: number;
  gfHigh?: number;
  waterType?: string;
  waterDensity?: number;
  gases?: { o2: number; he: number; mode?: string }[];
  minTemperatureC?: number;
  maxTemperatureC?: number;
  avgHeartRate?: number;
  surfaceIntervalSeconds?: number;
  cnsStart?: number;
  cnsEnd?: number;
  n2Start?: number;
  n2End?: number;
  avgAscentRateMps?: number;
  hasEndPosition?: boolean;
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

export const duplicateCandidate = pgTable('duplicate_candidate', {
  id: id(),
  recordingId: uuid('recording_id').notNull().references(() => recording.id),
  candidateDiveIds: uuid('candidate_dive_ids').array().notNull(),
  reason: text('reason').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const actorType = pgEnum('actor_type', ['user', 'import', 'system']);

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

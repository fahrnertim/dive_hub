import { isNull } from 'drizzle-orm';
import { recording } from '../db/schema.js';

/**
 * A Recording that counts on its own (ADR 0063): not a part of a joined Recording. A joined Dive's parts stay live on it,
 * but the joined Recording stands for them in every count, as Primary, and when it is split off, moved or merged.
 */
export const isUnit = () => isNull(recording.joinedRecordingId);

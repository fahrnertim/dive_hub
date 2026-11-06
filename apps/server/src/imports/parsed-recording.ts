// What every file format's adapter delivers (ADR 0003, ADR 0037): one Recording in our own model, whatever the file was.
import type { RecordingSummary, UtcOffsetSource } from '../db/schema.js';
import type { Position } from '../vocabulary.js';

/**
 * A file an adapter can't read as its format: not that format after all, broken, or without what a dive needs. Its
 * message is the parser's detail for the server log (an Import's `file_failed`); the cause, when there is one, the
 * error underneath.
 */
export class ParseError extends Error {
  override name = 'ParseError';
}

export interface ParsedDevice {
  manufacturer: string;
  product?: string;
  serialNumber: string;
  firmware?: string;
}

export interface ParsedSeries {
  channel: string;
  /** Offsets from the Recording start, in milliseconds. */
  offsetsMs: number[];
  values: number[];
}

export interface ParsedEvent {
  offsetMs: number;
  type: string;
  data: Record<string, unknown>;
}

export type { Position };

export interface ParsedRecording {
  device: ParsedDevice | undefined;
  /** Identity for re-imports, stable across copies of the same file. */
  recordingKey: string;
  /**
   * The key the same dive has when read from a poorer file of the same Source (ADR 0037: Suunto's FIT beside its JSON).
   * A Recording with that key is replaced by this one in place.
   */
  replacesKey?: string;
  /**
   * A fuller file's Recording of the same dive has a key like this (SQL LIKE), with the same duration and maximum
   * depth. When it is here, this Recording changes nothing (ADR 0037).
   */
  fullerCopyLike?: string;
  startsAt: Date;
  utcOffsetSeconds: number | undefined;
  /** Where the offset came from (ADR 0030); a file's comes from its device unless it says otherwise. */
  utcOffsetSource?: UtcOffsetSource;
  durationSeconds: number;
  maxDepthM: number | undefined;
  avgDepthM: number | undefined;
  /** Where the Device placed the start and the end of the dive (both optional, B6). */
  entryPosition: Position | undefined;
  exitPosition: Position | undefined;
  summary: RecordingSummary;
  series: ParsedSeries[];
  events: ParsedEvent[];
}

/** Optional properties whose value may be undefined become truly optional (exactOptionalPropertyTypes). */
export type WithoutUndefined<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export function stripUndefined<T extends Record<string, unknown>>(o: T): WithoutUndefined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as WithoutUndefined<T>;
}

/** The Source a Recording key belongs to: its namespace before the first `:` (ADR 0037). */
export function recordingKeySource(recordingKey: string): string {
  const colon = recordingKey.indexOf(':');
  return colon === -1 ? recordingKey : recordingKey.slice(0, colon);
}

/**
 * Sources that name each dive's own tanks even when the file has no pressure or size for them: Oceanic+ links one
 * `tankdata` per scuba dive. A tank it names is a tank the diver used, not a mix the computer merely lists.
 */
const NAMES_TANKS_WITHOUT_PRESSURE = new Set(['oceanicplus']);

/** The gases that are tanks the file names for this Recording even without a pressure (ADR 0045, `tankdata`). */
export function namedTanks(recordingKey: string, summary: RecordingSummary): NonNullable<RecordingSummary['gases']> {
  return NAMES_TANKS_WITHOUT_PRESSURE.has(recordingKeySource(recordingKey)) ? summary.gases ?? [] : [];
}

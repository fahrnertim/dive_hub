// What every file format's adapter delivers (ADR 0003, ADR 0037): one Recording in our own model, whatever the file was.
import type { RecordingSummary, UtcOffsetSource } from '../db/schema.js';

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

/** WGS84 degrees. */
export interface Position {
  latitude: number;
  longitude: number;
}

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

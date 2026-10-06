// The file formats an Import reads (ADR 0037). The import service, the zip reader and the position backfill ask this
// registry and name no format; a new format is one adapter and one line here.
import { createFitAdapter, looksLikeFit } from '../fit/fit-adapter.js';
import { createSuuntoJsonAdapter, looksLikeSuuntoJson } from '../suunto/suunto-json.js';
import type { ParsedRecording } from './parsed-recording.js';

export interface FileFormat {
  /** Our name for the format, as the docs use it. */
  readonly format: string;
  /** The media type its Originals are stored with. */
  readonly mediaType: string;
  /** The parser that reads it, as a Recording names it. */
  readonly parser: string;
  readonly parserVersion: string;
  /** Whether these bytes are this format, judged by their content, never by a file name. Cheap: it runs on every zip entry. */
  detect(data: Uint8Array): boolean;
  /** Returns the dives in the file; an empty list when it holds no dive. */
  parse(data: Uint8Array): Promise<ParsedRecording[]>;
}

export function createFileFormats(): FileFormat[] {
  const fit = createFitAdapter();
  const suuntoJson = createSuuntoJsonAdapter();
  return [
    { format: 'fit', mediaType: 'application/vnd.ant.fit', parser: fit.parser, parserVersion: fit.parserVersion, detect: looksLikeFit, parse: (data) => fit.parse(data) },
    { format: 'suunto_json', mediaType: 'application/json', parser: suuntoJson.parser, parserVersion: suuntoJson.parserVersion, detect: looksLikeSuuntoJson, parse: (data) => suuntoJson.parse(data) },
  ];
}

export const formatOf = (formats: readonly FileFormat[], data: Uint8Array): FileFormat | undefined => formats.find((f) => f.detect(data));

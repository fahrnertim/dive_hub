/**
 * What the Import accepts: FIT files, the Suunto app's JSON export and zip archives (Garmin "Export Original").
 * The server decides by a file's content (ADR 0037); the endings only keep other files from being uploaded.
 */
export const IMPORTABLE = ['.fit', '.json', '.zip'] as const;

/**
 * Dropped files are not filtered by the browser the way the file picker is: keep the importable
 * ones and name the rest, so the User learns why they didn't arrive.
 */
export function splitImportable(names: string[]) {
  const ok = (name: string) => IMPORTABLE.some((ext) => name.toLowerCase().endsWith(ext));
  return { accepted: names.filter(ok), skipped: names.filter((n) => !ok(n)) };
}

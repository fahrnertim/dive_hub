/** What the Import accepts: FIT files and zip archives (Garmin "Export Original"). */
export const IMPORTABLE = ['.fit', '.zip'] as const;

/**
 * Dropped files are not filtered by the browser the way the file picker is: keep the importable
 * ones and name the rest, so the User learns why they didn't arrive.
 */
export function splitImportable(names: string[]) {
  const ok = (name: string) => IMPORTABLE.some((ext) => name.toLowerCase().endsWith(ext));
  return { accepted: names.filter(ok), skipped: names.filter((n) => !ok(n)) };
}

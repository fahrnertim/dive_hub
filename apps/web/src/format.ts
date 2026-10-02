/** Dive time as the diver experienced it: local time at the dive site (UTC + the dive's offset). */
export function formatLocalDateTime(isoUtc: string, offsetSeconds: number | null): string {
  const utc = new Date(isoUtc);
  if (offsetSeconds === null) return utc.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const local = new Date(utc.getTime() + offsetSeconds * 1000);
  const text = local.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const hours = offsetSeconds / 3600;
  return `${text} (UTC${hours >= 0 ? '+' : ''}${Number.isInteger(hours) ? hours : hours.toFixed(1)})`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export const formatDepth = (m: number | null) => (m === null ? '–' : `${m.toFixed(1)} m`);

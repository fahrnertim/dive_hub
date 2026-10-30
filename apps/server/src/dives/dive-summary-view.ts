// A Dive as a short view over HTTP shows it: in a logbook check, a merge, the deleted Dives and what waits for a decision
// about a Provider. The views add their own fields (id, version, …) around these.
import { Type } from 'typebox';
import { UTC_OFFSET_SOURCES, type dive } from '../db/schema.js';
import { DateTime, Nullable } from '../http/schemas.js';

export const DiveSummaryFields = {
  number: Nullable(Type.Integer()),
  startsAt: DateTime,
  utcOffsetSeconds: Nullable(Type.Integer()),
  utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES]),
  durationSeconds: Type.Number(),
  maxDepthM: Nullable(Type.Number()),
  site: Nullable(Type.Object({ id: Type.String(), name: Type.String() })),
};

type SummaryRow = Pick<typeof dive.$inferSelect,
  'number' | 'startsAt' | 'utcOffsetSeconds' | 'utcOffsetSource' | 'durationSeconds' | 'maxDepthM' | 'siteId'>;

/** The Dive's site as a view names it; null without one. */
export const siteRef = (siteId: string | null, siteName: string | null) => (siteId && siteName !== null ? { id: siteId, name: siteName } : null);

/** DiveSummaryFields of a Dive row and its site's name. */
export const diveSummaryOf = (d: SummaryRow, siteName: string | null) => ({
  number: d.number, startsAt: d.startsAt.toISOString(), utcOffsetSeconds: d.utcOffsetSeconds, utcOffsetSource: d.utcOffsetSource,
  durationSeconds: d.durationSeconds, maxDepthM: d.maxDepthM, site: siteRef(d.siteId, siteName),
});

/** The Providers a Dive is at now, each with its number there, from PushService.currentOf. */
export const providersOf = (remote: Map<string, Map<string, { remoteNumber: number | null }>>, diveId: string) =>
  [...(remote.get(diveId)?.entries() ?? [])].map(([provider, p]) => ({ provider, remoteNumber: p.remoteNumber }));

// Push requirements (ADR 0029): what a Provider's export needs, checked against Dive Hub's own data only. Never calls
// the Provider: the status is read on every dive page. Whether the Provider still has what we point at is the
// adapter's check when it sends.
import type { ParticipantRole, PushLeftOut } from '../db/schema.js';
import type { SiteSource } from '../sites/sources.js';
import type { DiverSource, OutgoingDive, Requirement } from './provider.js';

/** A requirement not met by one Dive, with what a client needs to offer the fix. */
export type Unmet = { severity: Requirement['severity'] } & (
  /** `siteId` null: the Dive has no site yet, which is the first step. */
  | { type: 'site_external_id'; source: SiteSource; siteId: string | null }
  /** One per Participant nothing identifies at the Provider; `fixes` lists the ways Dive Hub has to fix it. */
  | { type: 'diver_mapping'; source: DiverSource; diverId: string; diverName: string; role: ParticipantRole; fixes: 'diver_external_id'[] }
);

/** What of `requirements` the Dive doesn't meet, in the order the Provider declares them. */
export function unmetRequirements(requirements: Requirement[], siteId: string | null, dive: OutgoingDive): Unmet[] {
  return requirements.flatMap((r): Unmet[] => {
    if (r.type === 'site_external_id') {
      return siteId && dive.siteIds[r.source] ? [] : [{ type: r.type, severity: r.severity, source: r.source, siteId }];
    }
    return dive.participants
      .filter((p) => r.roles.includes(p.role) && !p.ids[r.source])
      .map((p) => ({
        type: r.type, severity: r.severity, source: r.source, diverId: p.diverId, diverName: p.name, role: p.role,
        fixes: ['diver_external_id'],
      }));
  });
}

/**
 * The Dive as this Provider gets it: without the Participants an advisory requirement leaves out, so its fingerprint
 * changes once one of them can be sent.
 */
export function forProvider(dive: OutgoingDive, unmet: Unmet[]): OutgoingDive {
  const out = new Set(leftOutBy(unmet).map((l) => l.diverId));
  return out.size === 0 ? dive : { ...dive, participants: dive.participants.filter((p) => !out.has(p.diverId)) };
}

/** Participants an advisory requirement leaves out: nothing tells the Provider who they are. */
export function leftOutBy(unmet: Unmet[]): PushLeftOut[] {
  return unmet.flatMap((u) => (u.type === 'diver_mapping' && u.severity === 'advisory'
    ? [{ diverId: u.diverId, name: u.diverName, reason: 'no_reference' as const }] : []));
}

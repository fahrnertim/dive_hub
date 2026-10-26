// Push requirements (ADR 0029): what a Provider's export needs, checked against Dive Hub's own data only. Never calls
// the Provider: the status is read on every dive page. Whether the Provider still has what we point at is the
// adapter's check when it sends.
import type { ParticipantRole, PushLeftOut } from '../db/schema.js';
import type { SiteSource } from '../sites/sources.js';
import type { Capabilities, DiverSource, OutgoingDive, Requirement } from './provider.js';

/** A requirement not met by one Dive, with what a client needs to offer the fix. */
export type Unmet = { severity: Requirement['severity'] } & (
  /**
   * `siteId` null: the Dive has no site yet, which is the first step. `bySend`: sending finds the site at the Provider
   * or creates it there (the Provider can, and the site has a position), so it doesn't stop a send.
   */
  | { type: 'site_external_id'; source: SiteSource; siteId: string | null; bySend: boolean }
  /** One per Participant nothing identifies at the Provider; `fixes` lists the ways Dive Hub has to fix it. */
  | { type: 'diver_mapping'; source: DiverSource; diverId: string; diverName: string; role: ParticipantRole; fixes: ('diver_external_id' | 'list_entry')[] }
);

/** Whether the Provider can make an entry in the account's own list (`buddies.export` `add`): a `list_entry` fix is then offered. */
export const offersListEntries = (capabilities: Capabilities) => !!capabilities.data.buddies?.export?.operations.includes('add');

/**
 * What of `requirements` the Dive doesn't meet, in the order the Provider declares them. `site`: the Dive's site, if any.
 * `listEntries`: the Provider can make list entries, so an unmet Participant may also be fixed by one.
 */
export function unmetRequirements(
  requirements: Requirement[], site: { id: string; positioned: boolean } | null, dive: OutgoingDive, options: { listEntries?: boolean } = {},
): Unmet[] {
  return requirements.flatMap((r): Unmet[] => {
    if (r.type === 'site_external_id') {
      return site && dive.siteIds[r.source] ? [] : [{
        type: r.type, severity: r.severity, source: r.source, siteId: site?.id ?? null, bySend: !!r.createdBySend && !!site?.positioned,
      }];
    }
    return dive.participants
      .filter((p) => r.roles.includes(p.role) && !p.ids[r.source] && !p.entries?.[r.source])
      .map((p) => ({
        type: r.type, severity: r.severity, source: r.source, diverId: p.diverId, diverName: p.name, role: p.role,
        fixes: options.listEntries ? ['diver_external_id', 'list_entry'] : ['diver_external_id'],
      }));
  });
}

/**
 * The unmet requirements that stop a send. `beforeSite`: before the send has found or created the site at the Provider,
 * so a site requirement the send fixes itself (`bySend`) doesn't stop it yet.
 */
export function blocking<T extends { severity: Unmet['severity']; bySend?: boolean }>(unmet: T[], options: { beforeSite?: boolean } = {}): T[] {
  return unmet.filter((u) => u.severity === 'blocking' && !(options.beforeSite && u.bySend));
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

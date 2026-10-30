import type { Tx } from '../db/client.js';
import { revision } from '../db/schema.js';

/** Who or what changed logbook data: a User, an Import, a Site import (ADR 0021), or the hub itself. */
export type Actor = { type: 'user' | 'import' | 'system' | 'site_import'; id: string };

/** Why logbook data changed; clients translate these (ADR 0015). */
export const REVISION_CAUSES = [
  'import-create', 'auto-attach', 'reimport', 'edit', 'primary-change',
  // A User's decisions about Recordings and Divers (ADR 0016):
  'attach', 'detach', 'create', 'move', 'assign-device',
  // Dive sites (ADR 0020): deleting a site, and an Import linking a new Dive to the only site nearby.
  'delete', 'auto-site',
  // A Site import (ADR 0021) updating a site from its Source, or linking a hand-made site to one.
  'update', 'link',
  // Merging Dive sites (ADR 0022): on both sites, and on each Dive that moved (by the system, so no User is named).
  'merge', 'site-merge',
  // A User taking up the data a Source offers for a hand-made site (ADR 0025).
  'adopt',
  // A User bringing back a Dive they deleted (cause 'delete', ADR 0026).
  'restore',
  // An import from a Provider filling what a Dive lacked: site, Participants, notes (ADR 0030).
  'fill',
] as const;
export type RevisionCause = (typeof REVISION_CAUSES)[number];

export type Changes = Record<string, { from: unknown; to: unknown }>;

/**
 * Who hears, inside the change's transaction, that a Dive or a dive site changed: the Waiting push queue (ADR 0056).
 * dives/ owns this interface and providers/ implements it, so writing a Revision doesn't call the providers' queue
 * (ADR 0053's seam for dives and providers). createProviderLayer sets it; every process that writes Revisions builds one.
 */
export interface ChangeListener {
  /** A Dive changed, at its Revision's time and for its cause (a merge tells it `delete` for the merged Dive). */
  diveChanged(tx: Tx, diveId: string, cause: RevisionCause, at: Date, actor?: Actor): Promise<void>;
  /** A dive site's name or position changed: it reaches the Dives there. */
  siteChanged(tx: Tx, siteId: string, at: Date): Promise<void>;
}

let listener: ChangeListener | null = null;

/** Sets the process's one listener (the same stateless one each time a provider layer is built). */
export function listenToChanges(given: ChangeListener): void {
  listener = given;
}

/** The listener; without one a change would silently not reach the Providers, so it fails instead. */
export function changeListener(): ChangeListener {
  if (!listener) throw new Error('No change listener: build the provider layer (createProviderLayer) before writing Revisions');
  return listener;
}

export async function writeRevision(
  tx: Tx, entityType: 'dive' | 'recording' | 'device' | 'dive_site' | 'diver' | 'dive_centre', entityId: string, actor: Actor, cause: RevisionCause, changes: Changes,
): Promise<{ at: Date }> {
  const [written] = await tx.insert(revision).values({ entityType, entityId, actorType: actor.type, actorId: actor.id, cause, changes }).returning({ at: revision.at });
  // Every change to a Dive may need to go to a Provider by itself (ADR 0056): the listener hears it, at the Revision's time.
  if (entityType === 'dive') await changeListener().diveChanged(tx, entityId, cause, written!.at, actor);
  return { at: written!.at };
}

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
] as const;
export type RevisionCause = (typeof REVISION_CAUSES)[number];

export type Changes = Record<string, { from: unknown; to: unknown }>;

export async function writeRevision(
  tx: Tx, entityType: 'dive' | 'recording' | 'device' | 'dive_site' | 'diver', entityId: string, actor: Actor, cause: RevisionCause, changes: Changes,
) {
  await tx.insert(revision).values({ entityType, entityId, actorType: actor.type, actorId: actor.id, cause, changes });
}

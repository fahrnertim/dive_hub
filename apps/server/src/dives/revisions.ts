import type { Tx } from '../db/client.js';
import { revision } from '../db/schema.js';

/** Who or what changed logbook data: a User, an Import, or the hub itself. */
export type Actor = { type: 'user' | 'import' | 'system'; id: string };

/** Why logbook data changed; clients translate these (ADR 0015). */
export const REVISION_CAUSES = [
  'import-create', 'auto-attach', 'reimport', 'edit', 'primary-change',
  // A User's decisions about Recordings and Divers (ADR 0016):
  'attach', 'detach', 'create', 'move', 'assign-device',
] as const;
export type RevisionCause = (typeof REVISION_CAUSES)[number];

export type Changes = Record<string, { from: unknown; to: unknown }>;

export async function writeRevision(
  tx: Tx, entityType: 'dive' | 'recording' | 'device', entityId: string, actor: Actor, cause: RevisionCause, changes: Changes,
) {
  await tx.insert(revision).values({ entityType, entityId, actorType: actor.type, actorId: actor.id, cause, changes });
}

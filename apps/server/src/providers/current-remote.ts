// The remote dive a Dive has at a Provider now (ADR 0024). A file of its own that imports only the database layer, so the
// Waiting push queue (which `dives/revisions.ts` calls) and `remote-state.ts` (which reaches `dives/`) share one rule.
import type { push } from '../db/schema.js';

export type PushRow = typeof push.$inferSelect;

/**
 * The remote dive a Dive has at one Provider now, from its Pushes there (newest first): the last confirmed one with an
 * ID, unless a later delete or a "found gone" came after it.
 */
export function currentRemote(pushes: PushRow[]): PushRow | null {
  for (const p of pushes) {
    if (p.remoteGone) return null;
    if (p.state !== 'confirmed') continue;
    if (p.action === 'delete') return null;
    if (p.remoteId) return p;
  }
  return null;
}

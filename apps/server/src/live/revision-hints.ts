// Dive and site Revisions become hints (ADR 0066). The change listener runs inside the writing transaction, so these
// hints are any-origin by construction: a web edit, a worker import, MCP, or another tab all arrive here.
import type { ChangeListener } from '../dives/revisions.js';
import type { Tx } from '../db/client.js';
import { audienceOfDive, audienceOfEveryone, emitHint } from './emit.js';

/** Wraps the process's existing listener (the Waiting push queue) so every Revision also notifies open pages. */
export function withRevisionHints(inner: ChangeListener): ChangeListener {
  return {
    async diveChanged(tx: Tx, diveId, cause, at, actor) {
      await inner.diveChanged(tx, diveId, cause, at, actor);
      await emitHint(tx, { kind: 'dive', id: diveId, audience: await audienceOfDive(tx, diveId) });
    },
    async siteChanged(tx: Tx, siteId, at) {
      await inner.siteChanged(tx, siteId, at);
      await emitHint(tx, { kind: 'site', id: siteId, audience: await audienceOfEveryone(tx) });
    },
  };
}

// What the API says about a Dive's Waiting pushes (ADR 0056): the entries of the queue as a client shows them.
// Like the queue, it imports only the database layer.
import { and, asc, inArray } from 'drizzle-orm';
import { Type, type Static } from 'typebox';
import type { Db, Tx } from '../db/client.js';
import { waitingPush } from '../db/schema.js';

export const WaitingPushViewSchema = Type.Object({
  provider: Type.String(),
  action: Type.Enum(['send', 'delete']),
  state: Type.Enum(['waiting', 'held', 'stopped'], { description: 'waiting: goes out at `dueAt`; held: needs the User; stopped: failed for good (Retry)' }),
  reason: Type.Union([Type.Null(), Type.String({
    description: 'Why it is held (sign_in, requirements, exists, removes_verification) or the problem code of why it stopped',
  })]),
  dueAt: Type.String({ format: 'date-time', description: 'When it goes out, for a waiting entry' }),
});
export type WaitingPushView = Static<typeof WaitingPushViewSchema>;

/**
 * The entries of these Dives at these Providers (the ones the instance has: an entry of a removed Provider is left out,
 * as its Connections are), by Dive (Dives without any are left out), in the order of their Providers.
 */
export async function waitingOf(q: Db | Tx, diveIds: string[], providers: string[]): Promise<Map<string, WaitingPushView[]>> {
  const found = new Map<string, WaitingPushView[]>();
  if (diveIds.length === 0 || providers.length === 0) return found;
  const entries = await q.select().from(waitingPush).where(and(inArray(waitingPush.diveId, diveIds), inArray(waitingPush.provider, providers)))
    .orderBy(asc(waitingPush.provider));
  for (const e of entries) {
    found.set(e.diveId, [...(found.get(e.diveId) ?? []), {
      provider: e.provider, action: e.action, state: e.state, reason: e.reason, dueAt: e.dueAt.toISOString(),
    }]);
  }
  return found;
}

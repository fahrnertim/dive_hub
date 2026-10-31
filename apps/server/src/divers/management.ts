// Which Divers a User manages (ADR 0016): the one place for "does this User manage this Diver". A deleted Diver keeps
// its management rows, so each reader says whether it leaves deleted Divers out.
import { and, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { dive, diver, diverManagement } from '../db/schema.js';

/** The Divers the User manages; `live` leaves out deleted ones. */
export async function managedDiverIds(q: Queryable, userId: string, options: { live?: boolean } = {}): Promise<Set<string>> {
  const rows = options.live
    ? await q.select({ id: diverManagement.diverId }).from(diverManagement)
      .innerJoin(diver, eq(diver.id, diverManagement.diverId)).where(and(eq(diverManagement.userId, userId), isNull(diver.deletedAt)))
    : await q.select({ id: diverManagement.diverId }).from(diverManagement).where(eq(diverManagement.userId, userId));
  return new Set(rows.map((r) => r.id));
}

/** How the User manages this Diver (`isOwn`: their own Diver), or undefined when they don't or it is deleted. */
export async function managementOf(q: Queryable, userId: string, diverId: string): Promise<{ isOwn: boolean } | undefined> {
  const [row] = await q.select({ isOwn: diverManagement.isOwn }).from(diverManagement)
    .innerJoin(diver, eq(diver.id, diverManagement.diverId))
    .where(and(eq(diverManagement.userId, userId), eq(diverManagement.diverId, diverId), isNull(diver.deletedAt)));
  return row;
}

/** Join condition for `.innerJoin(diverManagement, …)`: the User manages the Dive's Diver. */
export const managesDiveDiver = (userId: string) =>
  and(eq(diverManagement.diverId, dive.diverId), eq(diverManagement.userId, userId));

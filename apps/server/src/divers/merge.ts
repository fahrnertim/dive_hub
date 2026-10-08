// Merging an external Diver into another (ADR 0028, amended): the same person twice, e.g. a buddy imported from a
// Provider's list who later becomes a User. Claimed by that User through their account at the Provider, or done by an
// admin. Only an external Diver (no User keeps it) is merged away; it has no Dives or Devices of its own.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { device, dive, diver, diverExternalId, diverManagement, participant } from '../db/schema.js';
import { writeRevision, type Actor } from '../dives/revisions.js';
import { DiverError } from './diver-service.js';

/** An external Diver: live, and no User keeps it. Null otherwise. */
export async function externalDiver(tx: Tx, id: string) {
  const [row] = await tx.select({
    id: diver.id, name: diver.name, firstName: diver.firstName, lastName: diver.lastName, email: diver.email, leaderNumber: diver.leaderNumber,
  }).from(diver)
    .where(and(eq(diver.id, id), isNull(diver.deletedAt),
      sql`not exists (select 1 from ${diverManagement} m where m.diver_id = ${diver.id})`));
  return row ?? null;
}

/** On how many Dives an external Diver is a Participant: what a claim says it brings. */
export async function participations(tx: Tx, diverId: string): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(participant)
    .innerJoin(dive, eq(dive.id, participant.diveId))
    .where(and(eq(participant.diverId, diverId), isNull(dive.deletedAt)));
  return row?.n ?? 0;
}

/**
 * Merges the external Diver `fromId` into `intoId`, in the caller's transaction: its places as a Participant (not on the
 * Dives of `intoId` itself, nor twice on one Dive), its accounts at services (refused when `intoId` has another account
 * at the same service: `diver_external_id_taken`), what its code says where `intoId` lacks it (ADR 0043), then it is
 * deleted with `merged_into` set and without those details. A Revision on both.
 */
export async function mergeExternalDiver(tx: Tx, fromId: string, intoId: string, actor: Actor): Promise<{ dives: number }> {
  if (fromId === intoId) throw new DiverError('invalid_input');
  const from = await externalDiver(tx, fromId);
  if (!from) throw new DiverError('diver_not_external');
  const [into] = await tx.select().from(diver).where(and(eq(diver.id, intoId), isNull(diver.deletedAt)));
  if (!into) throw new DiverError('diver_not_found');
  // An external Diver keeps no logbook; one that has Dives or Devices isn't what this merges.
  const [owns] = await tx.select({ n: sql<number>`(select count(*)::int from ${dive} where ${dive.diverId} = ${fromId}) + (select count(*)::int from ${device} where ${device.diverId} = ${fromId})` }).from(diver).where(eq(diver.id, fromId));
  if ((owns?.n ?? 0) > 0) throw new DiverError('diver_not_external');

  const accounts = await tx.select().from(diverExternalId).where(eq(diverExternalId.diverId, fromId));
  for (const a of accounts) {
    const [other] = await tx.select().from(diverExternalId).where(and(eq(diverExternalId.diverId, intoId), eq(diverExternalId.source, a.source)));
    if (other && other.externalId !== a.externalId) throw new DiverError('diver_external_id_taken', { id: into.id, name: into.name });
    if (other) await tx.delete(diverExternalId).where(eq(diverExternalId.id, a.id));
    else await tx.update(diverExternalId).set({ diverId: intoId }).where(eq(diverExternalId.id, a.id));
  }

  const dives = await participations(tx, fromId);
  // Not a Participant on a Dive of their own, and not twice on one Dive (the role already there stays).
  await tx.execute(sql`delete from ${participant} p using ${dive} d
    where p.dive_id = d.id and p.diver_id = ${fromId}
      and (d.diver_id = ${intoId} or exists (select 1 from ${participant} q where q.dive_id = p.dive_id and q.diver_id = ${intoId}))`);
  await tx.update(participant).set({ diverId: intoId }).where(eq(participant.diverId, fromId));

  const at = new Date();
  // What the merged Diver's code said fills the gaps of the kept one; the deleted row keeps no personal data.
  await tx.update(diver).set({
    firstName: into.firstName ?? from.firstName, lastName: into.lastName ?? from.lastName,
    email: into.email ?? from.email, leaderNumber: into.leaderNumber ?? from.leaderNumber, updatedAt: at,
  }).where(eq(diver.id, intoId));
  await tx.update(diver).set({ deletedAt: at, mergedInto: intoId, updatedAt: at, firstName: null, lastName: null, email: null, leaderNumber: null }).where(eq(diver.id, fromId));
  await writeRevision(tx, 'diver', fromId, actor, 'merge', { mergedInto: { from: null, to: { id: into.id, name: into.name } } });
  await writeRevision(tx, 'diver', intoId, actor, 'merge', { merged: { from: { id: from.id, name: from.name }, to: null }, dives: { from: null, to: dives } });
  return { dives };
}

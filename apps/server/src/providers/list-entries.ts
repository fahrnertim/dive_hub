// Which entry of an account's own list (SSI's buddy list) stands for which Diver (ADR 0057, piece 5). This is the only
// module that reads and writes `account_list_entry`. Writing it writes no Revision.
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { accountListEntry, diverExternalId } from '../db/schema.js';
import type { DiverSource } from './provider.js';

type Q = Db | Tx;

/** The Diver's account at a source (its `diver_external_id` row id), the list owner. The buddies lock key is `buddies:<this id>`. */
export async function listAccountOf(q: Q, diverId: string, source: DiverSource): Promise<string | null> {
  const [r] = await q.select({ id: diverExternalId.id }).from(diverExternalId)
    .where(and(eq(diverExternalId.diverId, diverId), eq(diverExternalId.source, source)));
  return r?.id ?? null;
}

/** Diver ID to entry ID, for those of `diverIds` the account's list has an entry remembered for. */
export async function rememberedFor(q: Q, accountId: string, diverIds: string[]): Promise<Map<string, string>> {
  if (diverIds.length === 0) return new Map();
  const rows = await q.select({ diverId: accountListEntry.diverId, entryId: accountListEntry.entryId }).from(accountListEntry)
    .where(and(eq(accountListEntry.accountId, accountId), inArray(accountListEntry.diverId, diverIds)));
  return new Map(rows.map((r) => [r.diverId, r.entryId]));
}

/** Entry ID to Diver ID, every entry remembered for the account's list. */
export async function rememberedEntries(q: Q, accountId: string): Promise<Map<string, string>> {
  const rows = await q.select({ diverId: accountListEntry.diverId, entryId: accountListEntry.entryId }).from(accountListEntry)
    .where(eq(accountListEntry.accountId, accountId));
  return new Map(rows.map((r) => [r.entryId, r.diverId]));
}

/** Sets the Diver's entry. Another Diver's row for that entry goes first, so the last link wins. */
export async function remember(q: Q, accountId: string, diverId: string, entryId: string): Promise<void> {
  await q.transaction(async (tx) => {
    await tx.delete(accountListEntry).where(and(
      eq(accountListEntry.accountId, accountId), eq(accountListEntry.entryId, entryId), ne(accountListEntry.diverId, diverId),
    ));
    await tx.insert(accountListEntry).values({ accountId, diverId, entryId })
      .onConflictDoUpdate({ target: [accountListEntry.accountId, accountListEntry.diverId], set: { entryId, updatedAt: new Date() } });
  });
}

export async function forget(q: Q, accountId: string, diverId: string): Promise<void> {
  await q.delete(accountListEntry).where(and(eq(accountListEntry.accountId, accountId), eq(accountListEntry.diverId, diverId)));
}

// Which entry of an account's own list (SSI's buddy list) stands for which Diver (ADR 0057, piece 5). This is the only
// module that reads and writes `account_list_entry`. Writing it writes no Revision.
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { accountListEntry, diver, diverExternalId } from '../db/schema.js';
import type { DiverSource, ImportContext } from './provider.js';


/** The Diver's account at a source (its `diver_external_id` row id), the list owner. The buddies lock key is `buddies:<this id>`. */
export async function listAccountOf(q: Queryable, diverId: string, source: DiverSource): Promise<string | null> {
  const [r] = await q.select({ id: diverExternalId.id }).from(diverExternalId)
    .where(and(eq(diverExternalId.diverId, diverId), eq(diverExternalId.source, source)));
  return r?.id ?? null;
}

/** The context with the entries remembered for the Diver's account at the source (none without an account), for parsing. */
export async function withRemembered(q: Queryable, diverId: string, source: DiverSource | undefined, context: ImportContext): Promise<ImportContext> {
  const accountId = source ? await listAccountOf(q, diverId, source) : null;
  return { ...context, remembered: accountId ? Object.fromEntries(await rememberedEntries(q, accountId)) : {} };
}

/**
 * The account's remembered rows, each with the Diver it stands for now: a Diver merged away (deleted with
 * `merged_into`, divers/merge.ts keeps its rows) stands for the live Diver at the end of its chain. `own`: the row is
 * the Diver's own, not one it got by a merge.
 */
async function resolvedRows(q: Queryable, accountId: string): Promise<{ diverId: string; entryId: string; own: boolean }[]> {
  const rows = await q.select({ diverId: accountListEntry.diverId, entryId: accountListEntry.entryId }).from(accountListEntry)
    .where(eq(accountListEntry.accountId, accountId));
  const into = new Map<string, string>();
  let unknown = [...new Set(rows.map((r) => r.diverId))];
  while (unknown.length > 0) {
    const found = await q.select({ id: diver.id, mergedInto: diver.mergedInto }).from(diver)
      .where(and(inArray(diver.id, unknown), isNotNull(diver.deletedAt), isNotNull(diver.mergedInto)));
    for (const f of found) into.set(f.id, f.mergedInto!);
    unknown = [...new Set(found.map((f) => f.mergedInto!))].filter((id) => !into.has(id));
  }
  const survivor = (id: string) => {
    const seen = new Set<string>();
    while (into.has(id) && !seen.has(id)) { seen.add(id); id = into.get(id)!; }
    return id;
  };
  return rows.map((r) => {
    const diverId = survivor(r.diverId);
    return { diverId, entryId: r.entryId, own: diverId === r.diverId };
  });
}

/** Diver ID to entry ID, for those of `diverIds` the account's list has an entry remembered for (their own before a merged one's). */
export async function rememberedFor(q: Queryable, accountId: string, diverIds: string[]): Promise<Map<string, string>> {
  if (diverIds.length === 0) return new Map();
  const wanted = new Set(diverIds);
  const result = new Map<string, string>();
  const rows = (await resolvedRows(q, accountId)).filter((r) => wanted.has(r.diverId));
  for (const r of rows.sort((a, b) => Number(a.own) - Number(b.own))) result.set(r.diverId, r.entryId);
  return result;
}

/** Entry ID to Diver ID, every entry remembered for the account's list; a merged-away Diver's entries stand for its survivor. */
export async function rememberedEntries(q: Queryable, accountId: string): Promise<Map<string, string>> {
  return new Map((await resolvedRows(q, accountId)).map((r) => [r.entryId, r.diverId]));
}

/** Sets the Diver's entry. Another Diver's row for that entry goes first, so the last link wins. */
export async function remember(q: Queryable, accountId: string, diverId: string, entryId: string): Promise<void> {
  await q.transaction(async (tx) => {
    await tx.delete(accountListEntry).where(and(
      eq(accountListEntry.accountId, accountId), eq(accountListEntry.entryId, entryId), ne(accountListEntry.diverId, diverId),
    ));
    await tx.insert(accountListEntry).values({ accountId, diverId, entryId })
      .onConflictDoUpdate({ target: [accountListEntry.accountId, accountListEntry.diverId], set: { entryId, updatedAt: new Date() } });
  });
}

export async function forget(q: Queryable, accountId: string, diverId: string): Promise<void> {
  await q.delete(accountListEntry).where(and(eq(accountListEntry.accountId, accountId), eq(accountListEntry.diverId, diverId)));
}

/** Forgets the entry, whichever Diver's row holds it (it may be a merged-away Diver's). */
export async function forgetEntry(q: Queryable, accountId: string, entryId: string): Promise<void> {
  await q.delete(accountListEntry).where(and(eq(accountListEntry.accountId, accountId), eq(accountListEntry.entryId, entryId)));
}

// The send's own fix for buddies (ADR 0057, piece 5): before a Dive goes out, the entries of the User's SSI buddy list
// for its Participants are settled by SSI account only. An entry with the Diver's account is remembered; a remembered
// entry without one gets the account; a Diver with an account and no entry gets one added. Never an entry from scratch:
// a Participant with neither is left out, and asked on the Dive's page. Generic: the adapter's `buddies` say what the
// Provider can do.
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { diver, diverExternalId } from '../db/schema.js';
import { participantsOf } from '../dives/dive-service.js';
import { locked } from './advisory-lock.js';
import { nameDiffers } from './buddy-names.js';
import { forgetEntry, listAccountOf, remember, rememberedFor } from './list-entries.js';
import { realClock, type Clock } from './lease-service.js';
import { ProviderError, type ActionContext, type DiverSource, type ProviderAdapter, type RemoteBuddy } from './provider.js';

export interface BuddiesForSend {
  /** Entries the send made, by Diver. `name` is the entry's name as the Provider answered it. */
  added: { diverId: string; name: string }[];
  /** Entries whose name at the Provider differs from the Diver's: whom the Provider knows the account as. */
  knownAs: { diverId: string; diverName: string; name: string }[];
}

/** Adds what a send settled to what the sends before it (a retry after a sign-in) settled: each Diver once. */
export function keepBuddies(into: BuddiesForSend, more: BuddiesForSend): void {
  into.added.push(...more.added.filter((a) => !into.added.some((o) => o.diverId === a.diverId)));
  into.knownAs.push(...more.knownAs.filter((a) => !into.knownAs.some((o) => o.diverId === a.diverId)));
}

/**
 * Settles the list entries of the Dive's Participants under the list's lock (the list is read once). Does nothing
 * when the Provider can't add or link entries, or the Dive's Diver has no account there.
 */
export async function buddiesForSend(db: Db, s: {
  adapter: ProviderAdapter; context: ActionContext; ownerDiverId: string; diveId: string; source: DiverSource;
  /** Where the wait for the list lock takes its time from. */
  clock?: Clock;
}): Promise<BuddiesForSend> {
  const result: BuddiesForSend = { added: [], knownAs: [] };
  const buddies = s.adapter.buddies;
  if (!buddies || !s.adapter.capabilities.data.buddies?.export) return result;
  const accountId = await listAccountOf(db, s.ownerDiverId, s.source);
  if (!accountId) return result;
  const diverIds = [...new Set((await participantsOf(db, s.diveId)).map((p) => p.diverId))];
  if (diverIds.length === 0) return result;
  const people = await db.select({ id: diver.id, name: diver.name, firstName: diver.firstName, lastName: diver.lastName }).from(diver)
    .where(inArray(diver.id, diverIds));
  const accounts = new Map((await db.select({ diverId: diverExternalId.diverId, externalId: diverExternalId.externalId }).from(diverExternalId)
    .where(and(inArray(diverExternalId.diverId, diverIds), eq(diverExternalId.source, s.source)))).map((r) => [r.diverId, r.externalId]));

  return locked(db, `buddies:${accountId}`, s.source, s.clock ?? realClock, async () => {
    let list = await buddies.find(s.context);
    const rememberedBy = await rememberedFor(db, accountId, diverIds);
    // The list may be a read from moments ago: an entry is forgotten only when a fresh read misses it too.
    if ([...rememberedBy.values()].some((entryId) => !list.some((b) => b.remoteId === entryId))) {
      list = await buddies.find(s.context, { fresh: true });
    }
    for (const p of people) {
      const entryId = rememberedBy.get(p.id);
      await settle(db, { ...s, buddies, accountId, list, result }, p, accounts.get(p.id) ?? null, entryId);
    }
    return result;
  });
}

export type Person = { id: string; name: string; firstName: string | null; lastName: string | null };

/** A save the Provider refused or failed: that Participant is left out. A sign-in error goes on, so the action signs in anew. */
function leftOutBy(error: unknown): boolean {
  return error instanceof ProviderError && error.reason !== 'signed_out' && error.reason !== 'wrong_credentials';
}

type SettleContext = {
  context: ActionContext; buddies: NonNullable<ProviderAdapter['buddies']>; accountId: string; list: RemoteBuddy[]; result: BuddiesForSend;
};

/**
 * One Participant's entry, by the order in the module's header. `entryId`: the entry remembered for the Diver, if any.
 * A save that fails leaves the Participant out of the Dive (as one without an entry), not the whole send.
 */
async function settle(db: Db, c: SettleContext, p: Person, account: string | null, entryId: string | undefined): Promise<void> {
  try {
    await settleEntry(db, c, p, account, entryId);
  } catch (error) {
    if (!leftOutBy(error)) throw error;
  }
}

async function settleEntry(db: Db, c: SettleContext, p: Person, account: string | null, entryId: string | undefined): Promise<void> {
  const withAccount = account ? c.list.find((b) => b.account === account) : undefined;
  const listed = entryId === undefined ? undefined : c.list.find((b) => b.remoteId === entryId);
  // Gone from the list, or made for another account than the Diver's now (the account was corrected): forgotten, and the
  // Diver is added by the account below. The old entry stays in the Provider's list.
  const corrected = listed?.account != null && account !== null && listed.account !== account;
  if (entryId !== undefined && (!listed || corrected)) await forgetEntry(db, c.accountId, entryId);
  const kept = corrected ? undefined : listed;
  if (withAccount) {
    await remember(db, c.accountId, p.id, withAccount.remoteId);
  } else if (kept && kept.account === null && account) {
    await giveAccount(db, c, p, kept.remoteId, account);
  } else if (!kept && account) {
    await addByAccount(db, c, p, account);
  }
}

/** Gives the remembered entry the Diver's account; an entry gone at the Provider since the list was read is forgotten, and the Diver added by the account. */
async function giveAccount(db: Db, c: SettleContext, p: Person, entryId: string, account: string): Promise<void> {
  if (!c.buddies.setAccount) return;
  try {
    checkName(c.result, p, await c.buddies.setAccount(c.context, entryId, account));
    return;
  } catch (error) {
    if (!(error instanceof ProviderError && error.reason === 'not_found')) throw error;
  }
  await forgetEntry(db, c.accountId, entryId);
  await addByAccount(db, c, p, account);
}

/** Adds an entry for the Diver by its account, when the Provider can, and remembers it. */
async function addByAccount(db: Db, c: SettleContext, p: Person, account: string): Promise<void> {
  if (!c.buddies.add) return;
  // A throw after this: the entry is found by its account on the next send, so none is added twice.
  const made = await c.buddies.add(c.context, { account, firstName: null, lastName: null, email: null });
  await remember(db, c.accountId, p.id, made.remoteId);
  // SSI may answer an add by account before it has the profile, without a name: the notice names the Diver.
  c.result.added.push({ diverId: p.id, name: made.name.trim() || p.name });
  checkName(c.result, p, made);
}

/** The answered entry's name against the Diver's: a difference is `knownAs`. */
function checkName(result: BuddiesForSend, p: Person, answered: RemoteBuddy): void {
  if (nameDiffers(answered.name, p)) result.knownAs.push({ diverId: p.id, diverName: p.name, name: answered.name });
}

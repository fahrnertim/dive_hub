// The account's own list of people at a Provider (ADR 0029; SSI: the buddy list), read live through a Connection, and
// imported as external Divers. Kept are a name, the person's account at the Provider and what their code there says
// (first and last name, e-mail, leader number: ADR 0043); whatever else the Provider has about them (birth date,
// phone, address) stays there. The list as it is answered holds only names and accounts; its e-mails only decide
// which entries match a Diver. An entry is linked to a Diver here, or added for one (piece 5, ADR 0057): the entry
// is remembered for the Diver (`list-entries.ts`), and an entry with an account gives the Diver that account.
import { and, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { diver as diverTable } from '../db/schema.js';
import { DiverError } from '../divers/diver-error.js';
import { tidyName } from '../divers/diver-name.js';
import type { DiverActor, DiverDetails, DiverService } from '../divers/diver-service.js';
import { locked } from './advisory-lock.js';
import { foldName, nameDiffers } from './buddies-for-send.js';
import type { ConnectionService } from './connection-service.js';
import { realClock } from './leases.js';
import { listAccountOf, remember, rememberedEntries } from './list-entries.js';
import type { ActionContext, DiverSource, RemoteBuddy } from './provider.js';
import { named, ProviderServiceError, type ProviderRegistry } from './registry.js';

export interface Buddy {
  /** The entry's ID at the Provider, to link it with. */
  entryId: string;
  name: string;
  /** The person's account at the Provider; null when they have none (such an entry can't be imported by account). */
  account: string | null;
  /** The Diver here with that account, or the Diver an entry without one is remembered for. */
  diver: { id: string; name: string } | null;
  /** The entry's name or e-mail is the `for` Diver's (folded, trimmed): only a sort, never a link. */
  matches: boolean;
}

/** Linking and adding refuse as the Diver routes do; the Provider routes answer these codes as well. */
async function asProblem<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DiverError) throw new ProviderServiceError(error.code, undefined, error.diver && { diver: error.diver });
    throw error;
  }
}

export function createBuddyService(deps: { db: Db; registry: ProviderRegistry; connections: ConnectionService; divers: DiverService }) {
  const { db, registry, connections, divers } = deps;

  /** The Connection and the adapter's `buddies`; `provider_unsupported` at a Provider without. */
  async function open(userId: string, connectionId: string) {
    const row = await connections.own(userId, connectionId);
    const adapter = registry.get(row.provider);
    const source = adapter.accountSource;
    if (!adapter.buddies || !source) throw new ProviderServiceError('provider_unsupported', named(adapter));
    return { row, adapter, buddies: adapter.buddies, source };
  }

  /** The list as the Provider has it now, each entry with its Diver, and `matches` against the Diver `forDiverId`. */
  async function read(userId: string, connectionId: string, forDiverId?: string) {
    const { row, buddies: remote, source } = await open(userId, connectionId);
    const entries = await connections.withAccess(row, (ctx) => remote.find(ctx));
    const known = await divers.byAccounts(source, entries.flatMap((e) => (e.account ? [e.account] : [])));
    const accountId = await listAccountOf(db, row.diverId, source);
    const remembered = accountId ? await rememberedEntries(db, accountId) : new Map<string, string>();
    const names = await namesOf([...new Set(entries.flatMap((e) => (e.account || !remembered.has(e.remoteId) ? [] : [remembered.get(e.remoteId)!])))]);
    const wanted = forDiverId ? await wantedBy(userId, forDiverId) : null;
    const buddies: (Buddy & { details: Partial<DiverDetails> })[] = entries
      .map((e) => {
        const rememberedFor = e.account ? undefined : remembered.get(e.remoteId);
        return {
          entryId: e.remoteId, name: e.name, account: e.account,
          diver: (e.account && known.get(e.account)) || (rememberedFor && names.get(rememberedFor)) || null,
          matches: !!wanted && matchesDiver(e, wanted),
          details: { firstName: e.firstName ?? null, lastName: e.lastName ?? null, email: e.email ?? null, leaderNumber: e.leaderNumber ?? null },
        };
      })
      .sort((a, b) => Number(b.matches) - Number(a.matches) || a.name.localeCompare(b.name));
    return { source, accountId, buddies };
  }

  async function namesOf(ids: string[]) {
    if (ids.length === 0) return new Map<string, { id: string; name: string }>();
    const rows = await db.select({ id: diverTable.id, name: diverTable.name }).from(diverTable)
      .where(and(inArray(diverTable.id, ids), isNull(diverTable.deletedAt)));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** The Diver's names and e-mail, which every User sees (ADR 0043). */
  async function wantedBy(userId: string, diverId: string) {
    const d = await asProblem(() => divers.details({ userId, isAdmin: false }, diverId));
    return {
      names: new Set([d.name, [d.firstName, d.lastName].filter(Boolean).join(' ')].filter(Boolean).map(foldName)),
      email: d.email ? foldName(d.email) : null,
    };
  }

  function matchesDiver(e: RemoteBuddy, wanted: { names: Set<string>; email: string | null }) {
    return wanted.names.has(foldName(e.name)) || (!!wanted.email && !!e.email && foldName(e.email) === wanted.email);
  }

  /** The list's account of the Connection's Diver, whose entries these are: the lock key and the owner of the remembered. */
  async function listAccount(row: { diverId: string }, source: DiverSource, adapter: { id: string; name: string }) {
    const accountId = await listAccountOf(db, row.diverId, source);
    if (!accountId) throw new ProviderServiceError('provider_unsupported', adapter);
    return accountId;
  }

  /** Runs `fn` with the Connection's access, holding the lock the send holds for the list (the send takes access first). */
  function underLock<T>(row: Parameters<ConnectionService['withAccess']>[0], source: DiverSource, accountId: string, fn: (ctx: ActionContext) => Promise<T>) {
    return connections.withAccess(row, (ctx) => locked(db, `buddies:${accountId}`, source, realClock, () => fn(ctx)));
  }

  /** Links the entry to the Diver: an entry with an account gives the Diver that account (the rules of the PUT), and is remembered. */
  async function linkEntry(actor: DiverActor, accountId: string, source: DiverSource, diverId: string, found: RemoteBuddy) {
    if (found.account) await asProblem(() => divers.setExternalId(actor, diverId, source, found.account));
    await remember(db, accountId, diverId, found.remoteId);
  }

  /** An external Diver from an entry without a Diver; an entry without an account is remembered for it. Null: nameless. */
  async function createFrom(
    actor: DiverActor, source: DiverSource, accountId: string | null, buddy: Buddy & { details: Partial<DiverDetails> },
  ) {
    // A Diver's name has at most 100 characters (divers/routes.ts).
    const name = tidyName(buddy.name).slice(0, 100);
    // An entry SSI has not filled from the profile yet has an account and no name: nothing to create a Diver from.
    if (!name) return null;
    if (buddy.account) {
      return { id: await divers.createExternal(actor, name, { source, externalId: buddy.account }, buddy.details), name };
    }
    if (!accountId) throw new ProviderServiceError('provider_unsupported');
    // Under the list's lock, so a send settling the list does not see a Diver half made.
    return locked(db, `buddies:${accountId}`, source, realClock, async () => {
      const id = await divers.createExternal(actor, name, undefined, buddy.details);
      await remember(db, accountId, id, buddy.entryId);
      return { id, name };
    });
  }

  return {
    async list(userId: string, connectionId: string, options: { forDiverId?: string } = {}): Promise<Buddy[]> {
      return (await read(userId, connectionId, options.forDiverId)).buddies.map(({ details: _details, ...buddy }) => buddy);
    },

    /**
     * Links an entry of the User's list to a Diver. With an account, the Diver gets it (`diver_external_id_taken` when
     * another Diver has it); the entry is remembered either way. An entry not in the list is `provider_buddy_not_found`.
     */
    async link(actor: DiverActor, connectionId: string, entryId: string, diverId: string): Promise<{ diverId: string }> {
      const { row, adapter, buddies, source } = await open(actor.userId, connectionId);
      const accountId = await listAccount(row, source, named(adapter));
      await asProblem(() => divers.details(actor, diverId));
      return underLock(row, source, accountId, async (ctx) => {
        const found = (await buddies.find(ctx)).find((b) => b.remoteId === entryId);
        if (!found) throw new ProviderServiceError('provider_buddy_not_found', named(adapter));
        await linkEntry(actor, accountId, source, diverId, found);
        return { diverId };
      });
    },

    /**
     * Adds a person to the User's list for a Diver, and remembers the entry. With an account already in the list that
     * entry is linked instead. What the Diver lacks of the typed first and last name and e-mail is filled in, and a
     * scanned account is set on it. `knownAs`: the name the Provider answered, when it differs from the Diver's.
     */
    async add(
      actor: DiverActor, connectionId: string, diverId: string,
      person: { firstName: string; lastName: string; email: string | null; account: string | null },
    ): Promise<{ added: { diverId: string; name: string }; knownAs: string | null }> {
      const { row, adapter, buddies, source } = await open(actor.userId, connectionId);
      if (!buddies.add) throw new ProviderServiceError('provider_unsupported', named(adapter));
      // As typed: only spaces tidied, no change of case (the person's own spelling).
      const firstName = person.firstName.trim().replace(/\s+/g, ' ');
      const lastName = person.lastName.trim().replace(/\s+/g, ' ');
      if (!firstName || !lastName) throw new ProviderServiceError('invalid_input');
      const accountId = await listAccount(row, source, named(adapter));
      const before = await asProblem(() => divers.details(actor, diverId));
      // The account first: another Diver having it ends the add before anything is made at the Provider.
      if (person.account) await asProblem(() => divers.setExternalId(actor, diverId, source, person.account));
      const answered = await underLock(row, source, accountId, async (ctx) => {
        const existing = person.account ? (await buddies.find(ctx)).find((b) => b.account === person.account) : undefined;
        const entry = existing ?? await buddies.add!(ctx, { firstName, lastName, email: person.email, account: person.account });
        await remember(db, accountId, diverId, entry.remoteId);
        return entry;
      });
      await divers.fillDetails(actor, diverId, { firstName, lastName, email: person.email });
      return {
        added: { diverId, name: answered.name },
        knownAs: nameDiffers(answered.name, before) ? answered.name : null,
      };
    },

    /**
     * Creates an external Diver for each chosen entry whose account no Diver has, with the entry's name, the account and
     * what the person's code says (ADR 0028, 0029, 0043). A chosen entry whose account a Diver has fills what that Diver
     * lacks of the latter, where the User may change the Diver; nothing there is overwritten. `entries`: entries without
     * an account; each makes an external Diver from its name and is remembered for it, unless it is remembered already.
     * Entries not in the list, or nameless, are skipped.
     */
    async import(actor: DiverActor, connectionId: string, accounts: string[], entries: string[] = []) {
      const { source, accountId, buddies } = await read(actor.userId, connectionId);
      let created = 0;
      let updated = 0;
      for (const buddy of buddies) {
        if (buddy.account ? !accounts.includes(buddy.account) : !entries.includes(buddy.entryId)) continue;
        if (buddy.diver) {
          if (buddy.account && await divers.fillDetails(actor, buddy.diver.id, buddy.details) > 0) updated += 1;
          continue;
        }
        const made = await createFrom(actor, source, accountId, buddy);
        if (!made) continue;
        buddy.diver = made;
        created += 1;
      }
      return { created, updated, buddies: buddies.map(({ details: _details, ...buddy }) => buddy) };
    },
  };
}

export type BuddyService = ReturnType<typeof createBuddyService>;

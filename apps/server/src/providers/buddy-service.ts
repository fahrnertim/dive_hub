// The account's own list of people at a Provider (ADR 0029; SSI: the buddy list), read live through a Connection, and
// imported as external Divers. Only a name and the person's account at the Provider are kept; whatever else the
// Provider has about them (birth date, contacts, address) stays there.
import type { DiverActor, DiverService } from '../divers/diver-service.js';
import type { ConnectionService } from './connection-service.js';
import { named, ProviderServiceError, type ProviderRegistry } from './registry.js';

export interface Buddy {
  name: string;
  /** The person's account at the Provider; null when they have none (such an entry can't be imported yet). */
  account: string | null;
  /** The Diver here with that account. */
  diver: { id: string; name: string } | null;
}

/**
 * A name as a Diver's name: one a Provider keeps all in lower case (or all in capitals) gets a capital at the start of
 * each part ("samuel dreier" → "Samuel Dreier", "anna-lena" → "Anna-Lena"). A name with mixed case ("McEowen",
 * "van der Berg") was typed with care and stays as it is.
 */
export function tidyName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed !== trimmed.toLocaleLowerCase() && trimmed !== trimmed.toLocaleUpperCase()) return trimmed;
  return trimmed.toLocaleLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_m, before: string, letter: string) => before + letter.toLocaleUpperCase());
}

export function createBuddyService(deps: { registry: ProviderRegistry; connections: ConnectionService; divers: DiverService }) {
  const { registry, connections, divers } = deps;

  /** The list as the Provider has it now, each entry with the Diver who has its account here. */
  async function read(userId: string, connectionId: string) {
    const row = await connections.own(userId, connectionId);
    const adapter = registry.get(row.provider);
    const source = adapter.accountSource;
    if (!adapter.buddies || !source) throw new ProviderServiceError('provider_unsupported', named(adapter));
    const entries = await connections.withAccess(row, (ctx) => adapter.buddies!.find(ctx));
    const known = await divers.byAccounts(source, entries.flatMap((e) => (e.account ? [e.account] : [])));
    const buddies: Buddy[] = entries
      .map((e) => ({ name: e.name, account: e.account, diver: (e.account && known.get(e.account)) || null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { source, buddies };
  }

  return {
    async list(userId: string, connectionId: string): Promise<Buddy[]> {
      return (await read(userId, connectionId)).buddies;
    },

    /**
     * Creates an external Diver for each chosen entry whose account no Diver has, with the entry's name and the account
     * (ADR 0028, 0029). Entries already known, without an account, or not in the list are skipped.
     */
    async import(actor: DiverActor, connectionId: string, accounts: string[]) {
      const { source, buddies } = await read(actor.userId, connectionId);
      let created = 0;
      for (const buddy of buddies) {
        if (!buddy.account || buddy.diver || !accounts.includes(buddy.account)) continue;
        // A Diver's name has at most 100 characters (divers/routes.ts).
        const name = tidyName(buddy.name).slice(0, 100);
        const id = await divers.createExternal(actor, name, { source, externalId: buddy.account });
        buddy.diver = { id, name };
        created += 1;
      }
      return { created, buddies };
    },
  };
}

export type BuddyService = ReturnType<typeof createBuddyService>;

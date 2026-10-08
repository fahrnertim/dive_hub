// The account's own list of people at a Provider (ADR 0029; SSI: the buddy list), read live through a Connection, and
// imported as external Divers. Kept are a name, the person's account at the Provider and what their code there says
// (first and last name, e-mail, leader number: ADR 0043); whatever else the Provider has about them (birth date,
// phone, address) stays there. The list as it is answered holds only names and accounts.
import type { DiverActor, DiverDetails, DiverService } from '../divers/diver-service.js';
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
    const buddies: (Buddy & { details: Partial<DiverDetails> })[] = entries
      .map((e) => ({
        name: e.name, account: e.account, diver: (e.account && known.get(e.account)) || null,
        details: { firstName: e.firstName ?? null, lastName: e.lastName ?? null, email: e.email ?? null, leaderNumber: e.leaderNumber ?? null },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { source, buddies };
  }

  return {
    async list(userId: string, connectionId: string): Promise<Buddy[]> {
      return (await read(userId, connectionId)).buddies.map(({ details: _details, ...buddy }) => buddy);
    },

    /**
     * Creates an external Diver for each chosen entry whose account no Diver has, with the entry's name, the account and
     * what the person's code says (ADR 0028, 0029, 0043). A chosen entry whose account a Diver has fills what that Diver
     * lacks of the latter, where the User may change the Diver; nothing there is overwritten. Entries without an account
     * or not in the list are skipped.
     */
    async import(actor: DiverActor, connectionId: string, accounts: string[]) {
      const { source, buddies } = await read(actor.userId, connectionId);
      let created = 0;
      let updated = 0;
      for (const buddy of buddies) {
        if (!buddy.account || !accounts.includes(buddy.account)) continue;
        if (buddy.diver) {
          if (await divers.fillDetails(actor, buddy.diver.id, buddy.details) > 0) updated += 1;
          continue;
        }
        // A Diver's name has at most 100 characters (divers/routes.ts).
        const name = tidyName(buddy.name).slice(0, 100);
        const id = await divers.createExternal(actor, name, { source, externalId: buddy.account }, buddy.details);
        buddy.diver = { id, name };
        created += 1;
      }
      return { created, updated, buddies: buddies.map(({ details: _details, ...buddy }) => buddy) };
    },
  };
}

export type BuddyService = ReturnType<typeof createBuddyService>;

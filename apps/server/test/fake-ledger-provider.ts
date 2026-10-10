// A second test-only Provider (ADR 0027), never registered in production: it signs in with a token the User pastes and
// confirms each dive with an ID back, so it can update and delete, but it can't find a dive or link to one. With SSI
// it is the second Provider a Dive can be deleted at; with the hand-over adapter it varies what the layer relies on.
// Its requirements are SSI's with the severities swapped (ADR 0029): a Wikidata ID for the site is only advisory, and
// every Participant needs a PADI account, or nothing is sent.
import { createHash } from 'node:crypto';
import { ProviderError, type Delivered, type OutgoingDive, type ProviderAdapter, type RemoteDive } from '../src/providers/provider.js';

export interface FakeLedger {
  adapter: ProviderAdapter;
  /** Tokens the "service" accepts, by account. */
  tokens: Map<string, { accountId: string; label: string }>;
  /** The dives it keeps, by ID. */
  dives: Map<string, { accountId: string; number: number; startsAt: string; notes: string | null; participants: string[] }>;
  /** While set, every call fails as if the service were down. */
  down: boolean;
  /** While set, deleting fails as if the service refused it (everything else still works). */
  refuseDelete: boolean;
  /** Makes every token invalid, as when they expire. */
  expireTokens(): void;
  /** Puts a dive there that Dive Hub doesn't know (one only at the Provider), under the account of the sign-in token. */
  seedRemote(entry: { number: number; startsAt: string }): string;
  /** Changes the number of a dive there, as the Provider's own app would. */
  renumber(remoteId: string, number: number): void;
}

/** The Participants' PADI accounts: all the Ledger keeps of them. */
const padiOf = (dive: OutgoingDive) => dive.participants.flatMap((p) => (p.ids.padi ? [p.ids.padi] : []));

export function createFakeLedger(): FakeLedger {
  let nextId = 900;
  const account = (access: string) => {
    if (fake.down) throw new ProviderError('unavailable', 'down');
    const found = fake.tokens.get(access);
    if (!found) throw new ProviderError('signed_out', 'token no longer valid');
    return found;
  };
  const ownerOf = (): string => [...fake.tokens.values()][0]!.accountId;
  const remoteDive = (remoteId: string, d: { number: number; startsAt: string }): RemoteDive => ({
    remoteId, number: d.number, startsAt: d.startsAt.slice(0, 16).replace('T', ' '), maxDepthM: null, durationMinutes: null,
  });
  /** The ledger's own way: the highest number of the account plus one. */
  const nextNumber = (accountId: string) => Math.max(0, ...[...fake.dives.values()].filter((d) => d.accountId === accountId).map((d) => d.number)) + 1;
  const holderOf = (accountId: string, number: number, except?: string) =>
    [...fake.dives.entries()].find(([id, d]) => d.accountId === accountId && d.number === number && id !== except);
  const delivered = (remoteId: string, dive: OutgoingDive): Delivered => ({
    remoteId, remoteNumber: fake.dives.get(remoteId)!.number, payload: { startsAt: dive.startsAt.toISOString(), notes: dive.notes }, differences: null,
  });
  const fake: FakeLedger = {
    tokens: new Map([['ledger-token-1', { accountId: 'l-5', label: 'Ledger of Erika' }]]),
    dives: new Map(),
    down: false,
    refuseDelete: false,
    expireTokens: () => fake.tokens.clear(),
    seedRemote: ({ number, startsAt }) => {
      const remoteId = `L${nextId++}`;
      fake.dives.set(remoteId, { accountId: ownerOf(), number, startsAt, notes: null, participants: [] });
      return remoteId;
    },
    renumber: (remoteId, number) => { fake.dives.get(remoteId)!.number = number; },
    adapter: {
      id: 'ledger',
      capabilities: {
        name: 'Ledger',
        signIn: { kind: 'token' },
        data: {
          dives: {
            export: {
              operations: ['create', 'update', 'delete'], delivery: 'confirmed',
              numbers: { set: ['create', 'update'], changeRemovesVerification: true },
              requirements: [
                { type: 'site_external_id', severity: 'advisory', source: 'wikidata', description: 'The Ledger files dives by Wikidata item.' },
                {
                  type: 'diver_mapping', severity: 'blocking', source: 'padi', roles: ['buddy', 'guide', 'instructor'],
                  description: 'The Ledger knows people only by their PADI account.',
                },
              ],
            },
          },
        },
        notices: [],
        limits: { pauseMs: 300, run: { pauseMs: 1000, maxDives: 3 } },
      },
      async signIn(input) {
        if (fake.down) throw new ProviderError('unavailable', 'down');
        const found = input.kind === 'token' ? fake.tokens.get(input.token) : undefined;
        if (!found || input.kind !== 'token') throw new ProviderError('wrong_credentials', 'token refused');
        return { account: { id: found.accountId, label: found.label }, access: input.token };
      },
      dives: {
        mode: 'api',
        fingerprint: (dive) => createHash('sha256')
          .update(`${dive.startsAt.toISOString()} ${dive.maxDepthM} ${dive.notes} ${padiOf(dive).join(',')}`).digest('base64url'),
        open(ctx) {
          const mine = (remoteId: string) => {
            const { accountId } = account(ctx.access);
            const dive = fake.dives.get(remoteId);
            return dive && dive.accountId === accountId ? dive : null;
          };
          return {
            async create(dive, _reference, wanted) {
              const { accountId } = account(ctx.access);
              const remoteId = `L${nextId++}`;
              // A number another dive has is not given twice: the ledger numbers its own way then.
              const number = wanted != null && !holderOf(accountId, wanted) ? wanted : nextNumber(accountId);
              fake.dives.set(remoteId, { accountId, number, startsAt: dive.startsAt.toISOString(), notes: dive.notes, participants: padiOf(dive) });
              return delivered(remoteId, dive);
            },
            async update(remoteId, dive, _previous, wanted) {
              const kept = mine(remoteId);
              if (!kept) return null;
              Object.assign(kept, { startsAt: dive.startsAt.toISOString(), notes: dive.notes, participants: padiOf(dive) });
              if (wanted != null && !holderOf(kept.accountId, wanted, remoteId)) kept.number = wanted;
              return delivered(remoteId, dive);
            },
            async setNumber(remoteId, number) {
              const kept = mine(remoteId);
              if (!kept) return null;
              const holder = holderOf(kept.accountId, number, remoteId);
              if (holder) return { result: 'taken', by: remoteDive(holder[0], holder[1]) };
              kept.number = number;
              return { result: 'set', remoteNumber: number };
            },
            async remove(remoteId) {
              if (!mine(remoteId)) return 'gone';
              if (fake.refuseDelete) throw new ProviderError('refused', 'delete refused');
              fake.dives.delete(remoteId);
              return 'deleted';
            },
            exists: async (remoteId) => !!mine(remoteId),
          };
        },
      },
    },
  };
  return fake;
}

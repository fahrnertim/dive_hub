// A second test-only Provider (ADR 0027), never registered in production: it signs in with a token the User pastes and
// confirms each dive with an ID back, so it can update and delete, but it can't find a dive or link to one. With SSI
// it is the second Provider a Dive can be deleted at; with the hand-over adapter it varies what the layer relies on.
// Its requirements are SSI's with the severities swapped (ADR 0029): a Wikidata ID for the site is only advisory, and
// every Participant needs a PADI account, or nothing is sent.
import { createHash } from 'node:crypto';
import {
  ProviderError, type Delivered, type ImportContext, type ImportedDive, type OutgoingDive, type ExportingProvider, type RemoteDive,
} from '../src/providers/provider.js';

export interface FakeLedger {
  adapter: ExportingProvider;
  /** Tokens the "service" accepts, by account. */
  tokens: Map<string, { accountId: string; label: string }>;
  /** The dives it keeps, by ID; a dive from a computer carries the computer (`imports` only). */
  dives: Map<string, LedgerDive>;
  /** While set, every call fails as if the service were down. */
  down: boolean;
  /** While set, deleting fails as if the service refused it (everything else still works). */
  refuseDelete: boolean;
  /** Runs before each create or update is saved, after Dive Hub read the Dive it sends (a test's change "during a send"). */
  beforeSave: (() => Promise<void>) | null;
  /** Makes every token invalid, as when they expire. */
  expireTokens(): void;
  /** Every number the ledger saved by "set number", in order; `shared` when another dive had it at that moment (ADR 0052). */
  numberSaves: { remoteId: string; number: number; shared: boolean }[];
  /** How many times the logbook's numbers were read (the preview's and a start's read). */
  heldReads: number;
  /** How many times the account's dives were listed (`imports` only). */
  listReads: number;
  /** Runs inside each listing, after Dive Hub asked for it (a test's second fetch "during a read"; `imports` only). */
  beforeList: (() => Promise<void>) | null;
  /** Puts a dive there that Dive Hub doesn't know (one only at the Provider), under the account of the sign-in token. */
  seedRemote(entry: { number: number; startsAt: string } & Partial<Pick<LedgerDive, 'notes' | 'durationSeconds' | 'maxDepthM' | 'device'>>): string;
  /** Changes the number of a dive there, as the Provider's own app would. */
  renumber(remoteId: string, number: number): void;
}

export interface LedgerDive {
  accountId: string; number: number; startsAt: string; notes: string | null; participants: string[];
  durationSeconds?: number; maxDepthM?: number | null; device?: { manufacturer: string; serialNumber: string };
}

/** A kept dive as the ledger lists it: no account, no people. */
function recordOf(id: string, { accountId: _account, participants: _people, ...d }: LedgerDive): Record<string, unknown> {
  return { id, ...d };
}

/**
 * A record as the ledger lists it, or the payload a send recorded (`startsAt` and `notes` only), in typed values. The
 * ledger keeps no site, people or tank; its start is the local time.
 */
function parseLedger(record: Record<string, unknown>, remoteId?: string): ImportedDive | null {
  const startsAt = typeof record.startsAt === 'string' ? record.startsAt : null;
  const id = typeof record.id === 'string' ? record.id : remoteId;
  if (!startsAt || !id) return null;
  const device = record.device as LedgerDive['device'] | undefined;
  return {
    remoteId: id, remoteNumber: typeof record.number === 'number' ? record.number : null, evidence: device ? 'computer' : 'logbook',
    reference: null, localStart: startsAt.slice(0, 16).replace('T', ' '), sitePosition: null, people: [],
    durationSeconds: typeof record.durationSeconds === 'number' ? record.durationSeconds : 0,
    maxDepthM: typeof record.maxDepthM === 'number' ? record.maxDepthM : null, avgDepthM: null, waterTemperatureC: null, maxTemperatureC: null,
    notes: typeof record.notes === 'string' ? record.notes : null, siteIds: {}, entry: null, exit: null, gases: [],
    gfLow: null, gfHigh: null, cnsStart: null, cnsEnd: null,
    device: device ? { manufacturer: device.manufacturer, product: null, serialNumber: device.serialNumber, firmware: null } : null,
    samples: {}, cylinder: null, leadKg: null, diveMode: null, surfaceIntervalSeconds: null, avgHeartRate: null,
  };
}

/** The Participants' PADI accounts: all the Ledger keeps of them. */
const padiOf = (dive: OutgoingDive) => dive.participants.flatMap((p) => (p.ids.padi ? [p.ids.padi] : []));

/** `imports`: the ledger also lists the account's dives, so they can be imported and fetched on a schedule (ADR 0030, 0056). */
export function createFakeLedger(options: { imports?: boolean } = {}): FakeLedger {
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
    // What it keeps now: notes an update left alone are its own.
    remoteId, remoteNumber: fake.dives.get(remoteId)!.number, payload: { startsAt: dive.startsAt.toISOString(), notes: fake.dives.get(remoteId)!.notes }, differences: null,
  });
  const fake: FakeLedger = {
    tokens: new Map([['ledger-token-1', { accountId: 'l-5', label: 'Ledger of Erika' }]]),
    dives: new Map(),
    down: false,
    refuseDelete: false,
    beforeSave: null,
    numberSaves: [],
    heldReads: 0,
    listReads: 0,
    beforeList: null,
    expireTokens: () => fake.tokens.clear(),
    seedRemote: ({ number, startsAt, notes = null, ...more }) => {
      const remoteId = `L${nextId++}`;
      fake.dives.set(remoteId, { accountId: ownerOf(), number, startsAt, notes, participants: [], ...more });
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
            ...(options.imports && { import: { operations: ['list'] } }),
          },
        },
        notices: [],
        limits: { pauseMs: 300, run: { pauseMs: 1000, maxDives: 3 }, fetchEveryMinutes: options.imports ? 60 : null },
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
              await fake.beforeSave?.();
              const remoteId = `L${nextId++}`;
              // A number another dive has is not given twice: the ledger numbers its own way then.
              const number = wanted != null && !holderOf(accountId, wanted) ? wanted : nextNumber(accountId);
              fake.dives.set(remoteId, { accountId, number, startsAt: dive.startsAt.toISOString(), notes: dive.notes, participants: padiOf(dive) });
              return delivered(remoteId, dive);
            },
            async update(remoteId, dive, _previous, wanted, leave) {
              const kept = mine(remoteId);
              if (!kept) return null;
              await fake.beforeSave?.();
              // Notes the send leaves as the ledger has them (a field of an open Conflict) stay.
              const notes = leave?.keep.includes('notes') ? kept.notes : dive.notes;
              Object.assign(kept, { startsAt: dive.startsAt.toISOString(), notes, participants: padiOf(dive) });
              if (wanted != null && !holderOf(kept.accountId, wanted, remoteId)) kept.number = wanted;
              return delivered(remoteId, dive);
            },
            async setNumber(remoteId, number, sharedWith) {
              const kept = mine(remoteId);
              if (!kept) return null;
              const holders = [...fake.dives.entries()].filter(([id, d]) => d.accountId === kept.accountId && d.number === number && id !== remoteId);
              const other = holders.find(([id]) => id !== sharedWith);
              if (other) return { result: 'taken', by: remoteDive(other[0], other[1]) };
              kept.number = number;
              fake.numberSaves.push({ remoteId, number, shared: holders.length > 0 });
              return { result: 'set', remoteNumber: number };
            },
            async heldNumbers() {
              const { accountId } = account(ctx.access);
              fake.heldReads += 1;
              return [...fake.dives.entries()].filter(([, d]) => d.accountId === accountId).map(([id, d]) => remoteDive(id, d));
            },
            async remove(remoteId) {
              if (!mine(remoteId)) return 'gone';
              if (fake.refuseDelete) throw new ProviderError('refused', 'delete refused');
              fake.dives.delete(remoteId);
              return 'deleted';
            },
            exists: async (remoteId) => !!mine(remoteId),
            // With imports, an update reads the record first and compares it (ADR 0056).
            ...(options.imports && {
              async current(remoteId: string) {
                const kept = mine(remoteId);
                if (!kept) return null;
                const record = recordOf(remoteId, kept);
                return { dive: parseLedger(record)!, context: { people: {}, sites: {} }, record };
              },
            }),
          };
        },
        ...(options.imports && {
          async list(ctx) {
            const { accountId } = account(ctx.access);
            fake.listReads += 1;
            await fake.beforeList?.();
            const records = [...fake.dives.entries()].filter(([, d]) => d.accountId === accountId)
              .map(([id, d]) => ({ remoteId: id, record: recordOf(id, d) }));
            return { records, context: { people: {}, sites: {} } };
          },
          parse: (record: Record<string, unknown>, _context: ImportContext, remoteId?: string) => parseLedger(record, remoteId),
        }),
      },
    },
  };
  return fake;
}

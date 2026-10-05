// A test-only Provider (ADR 0027), never registered in production: it signs in with a token the User pastes and hands
// dives over without an ID back, like a QR code would. It proves the provider layer generic: another sign-in kind,
// another delivery, no update, delete, link or find.
import { createHash } from 'node:crypto';
import { ProviderError, type ProviderAdapter } from '../src/providers/provider.js';

export interface FakeHandover {
  adapter: ProviderAdapter;
  /** Tokens the "service" accepts, by account. */
  tokens: Map<string, { accountId: string; label: string }>;
  /** Every dive handed over: what it received, in order. */
  received: { accountId: string; startsAt: string }[];
  /** While set, every call fails as if the service were down. */
  down: boolean;
  /** Makes every token invalid, as when they expire. */
  expireTokens(): void;
  /** Runs while a dive is handed over, before it counts as received: to look at the database, or hold the action open. */
  during: (() => Promise<void>) | null;
}

export function createFakeHandover(): FakeHandover {
  const fake: FakeHandover = {
    tokens: new Map([['handover-token-1', { accountId: 'h-77', label: 'Logbook of Erika' }]]),
    received: [],
    down: false,
    expireTokens: () => fake.tokens.clear(),
    during: null,
    adapter: {
      id: 'handover',
      capabilities: {
        name: 'Hand-over',
        signIn: { kind: 'token' },
        data: { dives: { export: { operations: ['create'], delivery: 'handed_over' } } },
        notices: [],
        limits: { pauseMs: 500 },
      },
      async signIn(input) {
        if (fake.down) throw new ProviderError('unavailable', 'down');
        const account = input.kind === 'token' ? fake.tokens.get(input.token) : undefined;
        if (!account || input.kind !== 'token') throw new ProviderError('wrong_credentials', 'token refused');
        return { account: { id: account.accountId, label: account.label }, access: input.token };
      },
      dives: {
        mode: 'qr',
        fingerprint: (dive) => createHash('sha256').update(`${dive.startsAt.toISOString()} ${dive.maxDepthM} ${dive.notes}`).digest('base64url'),
        open(ctx) {
          return {
            async create(dive) {
              if (fake.down) throw new ProviderError('unavailable', 'down');
              const account = fake.tokens.get(ctx.access);
              if (!account) throw new ProviderError('signed_out', 'token no longer valid');
              await fake.during?.();
              fake.received.push({ accountId: account.accountId, startsAt: dive.startsAt.toISOString() });
              return { remoteId: null, remoteNumber: null, payload: { startsAt: dive.startsAt.toISOString() }, differences: null };
            },
          };
        },
      },
    },
  };
  return fake;
}

// The contract every Provider adapter must pass (ADR 0027), run against each adapter with its fake service. It checks
// what the generic layer relies on: capabilities that match the methods, sign-in, typed errors with a reason (never a
// secret in the message), delivery with or without an ID, "outdated" by fingerprint, and each declared operation.
import { describe, expect, it } from 'vitest';
import {
  FIND_BY, OPERATIONS, ProviderError, type ActionContext, type OutgoingDive, type ProviderAdapter, type SignInInput,
} from '../src/providers/provider.js';
import { SITE_SOURCES } from '../src/sites/sources.js';

export interface ContractHarness {
  adapter: ProviderAdapter;
  /** A sign-in the fake accepts, and one it refuses. */
  signIn: SignInInput;
  wrongSignIn: SignInInput;
  /** Secrets that must never appear in an error message. */
  secrets: string[];
  /** A Dive the Provider can take (with the site ID it needs). */
  dive: OutgoingDive;
  /** The fake stops accepting every access given so far. */
  expire(): void;
  /** The fake answers like a service that is down, until called with false. */
  outage(on: boolean): void;
  /** Deletes a remote dive at the fake, as a User would in the Provider's own app. */
  deleteThere?(remoteId: string): void;
}

const later = (dive: OutgoingDive, minutes: number): OutgoingDive => ({ ...dive, startsAt: new Date(dive.startsAt.getTime() + minutes * 60_000) });

export function providerContract(name: string, make: () => ContractHarness) {
  describe(`${name}: the Provider contract`, () => {
    const connect = async (h: ContractHarness, id = 'connection-1'): Promise<ActionContext> => {
      const signedIn = await h.adapter.signIn(h.signIn);
      return { connectionId: id, accountId: signedIn.account.id, access: signedIn.access };
    };
    const reasonOf = async (h: ContractHarness, run: Promise<unknown>) => {
      const error = await run.then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      for (const secret of h.secrets) expect((error as Error).message).not.toContain(secret);
      return (error as ProviderError).reason;
    };

    it('declares capabilities that match what it does', () => {
      const { adapter } = make();
      const c = adapter.capabilities;
      expect(adapter.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(c.name.length).toBeGreaterThan(0);
      expect(['none', 'password', 'token']).toContain(c.signIn.kind);
      expect(c.limits.pauseMs).toBeGreaterThanOrEqual(0);
      const exports = c.data.dives?.export;
      expect(!!exports).toBe(!!adapter.dives);
      if (exports) {
        for (const op of exports.operations) expect(OPERATIONS).toContain(op);
        for (const by of exports.findBy ?? []) expect(FIND_BY).toContain(by);
        expect(exports.operations).toContain('create');
        if (exports.needsSiteIdFrom) expect(SITE_SOURCES).toContain(exports.needsSiteIdFrom);
        expect(exports.operations.includes('readBack')).toBe((exports.readBackFields ?? []).length > 0);
        if (exports.delivery === 'handed_over') {
          // Without an ID back there is nothing to update, delete, link or find again.
          for (const op of ['update', 'delete', 'link', 'find'] as const) expect(exports.operations).not.toContain(op);
        }
        const action = adapter.dives!.open({ connectionId: 'x', accountId: 'x', access: 'x' });
        expect(!!action.update).toBe(exports.operations.includes('update'));
        expect(!!action.remove).toBe(exports.operations.includes('delete'));
        expect(!!action.find).toBe(exports.operations.includes('find'));
        if (exports.operations.includes('link')) expect(exports.operations).toContain('find');
      }
      expect(!!c.data.diveSites?.import?.operations.includes('find')).toBe(!!adapter.diveSites);
    });

    it('signs in, and refuses a wrong sign-in with a reason', async () => {
      const h = make();
      const signedIn = await h.adapter.signIn(h.signIn);
      expect(signedIn.account.id).toEqual(expect.any(String));
      expect(signedIn.account.label).toEqual(expect.any(String));
      expect(signedIn.access).toEqual(expect.any(String));
      expect(await reasonOf(h, h.adapter.signIn(h.wrongSignIn))).toBe('wrong_credentials');
    });

    it('fingerprints what it receives: the same Dive the same, a changed Dive differently', () => {
      const { adapter, dive } = make();
      if (!adapter.dives) return;
      expect(adapter.dives.fingerprint(dive)).toBe(adapter.dives.fingerprint({ ...dive }));
      expect(adapter.dives.fingerprint({ ...dive, notes: `${dive.notes ?? ''} changed` })).not.toBe(adapter.dives.fingerprint(dive));
    });

    it('creates: with an ID back when delivery is confirmed, without one when handed over', async () => {
      const h = make();
      if (!h.adapter.dives) return;
      const delivered = await h.adapter.dives.open(await connect(h)).create(h.dive, 'divehub-contract-1');
      if (h.adapter.capabilities.data.dives!.export!.delivery === 'confirmed') expect(delivered.remoteId).toEqual(expect.any(String));
      else expect(delivered.remoteId).toBeNull();
      if (h.adapter.capabilities.data.dives!.export!.operations.includes('readBack')) expect(delivered.differences).toEqual([]);
    });

    it('finds a dive it got before by our reference, and one at about the same time', async () => {
      const h = make();
      const action = h.adapter.dives?.open(await connect(h));
      if (!action?.find) return;
      expect(await action.find(h.dive, 'divehub-contract-2')).toEqual({ ours: null, sameTime: null });
      const { remoteId } = await action.create(h.dive, 'divehub-contract-2');
      const found = await h.adapter.dives!.open(await connect(h)).find!(later(h.dive, 1), 'divehub-contract-2');
      expect(found.ours?.remoteId).toBe(remoteId);
      expect(found.sameTime?.remoteId).toBe(remoteId);
      expect((await h.adapter.dives!.open(await connect(h)).find!(later(h.dive, 60), 'divehub-other')).sameTime).toBeNull();
    });

    it('updates the same remote dive, and answers null once it is gone', async () => {
      const h = make();
      const ctx = await connect(h);
      if (!h.adapter.dives?.open(ctx).update) return;
      const { remoteId } = await h.adapter.dives.open(ctx).create(h.dive, 'divehub-contract-3');
      const updated = await h.adapter.dives.open(ctx).update!(remoteId!, { ...h.dive, notes: 'Turtle' });
      expect(updated?.remoteId).toBe(remoteId);
      h.deleteThere!(remoteId!);
      expect(await h.adapter.dives.open(ctx).update!(remoteId!, h.dive)).toBeNull();
    });

    it('deletes, and says when the remote dive was already gone', async () => {
      const h = make();
      const ctx = await connect(h);
      if (!h.adapter.dives?.open(ctx).remove) return;
      const { remoteId } = await h.adapter.dives.open(ctx).create(h.dive, 'divehub-contract-4');
      expect(await h.adapter.dives.open(ctx).remove!(remoteId!)).toBe('deleted');
      expect(await h.adapter.dives.open(ctx).remove!(remoteId!)).toBe('gone');
    });

    it('says unavailable when the service is down, and signed_out when the access expired', async () => {
      const h = make();
      if (!h.adapter.dives) return;
      const ctx = await connect(h);
      h.outage(true);
      expect(await reasonOf(h, h.adapter.dives.open(ctx).create(h.dive, 'divehub-contract-5'))).toBe('unavailable');
      expect(await reasonOf(h, h.adapter.signIn(h.signIn))).toBe('unavailable');
      h.outage(false);
      h.expire();
      expect(await reasonOf(h, h.adapter.dives.open(ctx).create(h.dive, 'divehub-contract-5'))).toBe('signed_out');
    });

    it('offers its dive sites with their IDs, if it has any', async () => {
      const h = make();
      if (!h.adapter.diveSites) return;
      const sites = await h.adapter.diveSites.find(await connect(h));
      const numberOrNull = (v: unknown) => v === null || typeof v === 'number';
      for (const s of sites) {
        expect(Object.keys(s).sort()).toEqual(['country', 'id', 'latitude', 'longitude', 'name']);
        expect([typeof s.id, typeof s.name]).toEqual(['string', 'string']);
        expect(numberOrNull(s.latitude) && numberOrNull(s.longitude) && (s.country === null || typeof s.country === 'string')).toBe(true);
      }
    });
  });
}

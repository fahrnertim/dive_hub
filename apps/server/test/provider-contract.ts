// The contract every Provider adapter must pass (ADR 0027), run against each adapter with its fake service. It checks
// what the generic layer relies on: capabilities that match the methods, sign-in, typed errors with a reason (never a
// secret in the message), delivery with or without an ID, "outdated" by fingerprint, requirements of known types
// (ADR 0029), Participants taken by the reference they need, and a case for every operation the adapter declares (an
// operation without a case fails the suite).
import { describe, expect, it } from 'vitest';
import { PARTICIPANT_ROLES } from '../src/db/schema.js';
import {
  FIND_BY, OPERATIONS, ProviderError, type ActionContext, type OutgoingDive, type OutgoingParticipant, type ProviderAdapter,
  type SignInInput,
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
  /** With a `diver_mapping` requirement: a Participant the fake knows by the reference it needs. */
  participant?: OutgoingParticipant;
  /** With `dives.import.list`: puts a dive typed by hand and one from a dive computer into the account at the fake. */
  seedDives?(): void;
}

const later = (dive: OutgoingDive, minutes: number): OutgoingDive => ({ ...dive, startsAt: new Date(dive.startsAt.getTime() + minutes * 60_000) });

/** Every operation an adapter declares, as `kind.direction.operation`. */
function declared(adapter: ProviderAdapter): string[] {
  return Object.entries(adapter.capabilities.data).flatMap(([kind, directions]) =>
    Object.entries(directions ?? {}).flatMap(([direction, d]) => (d as { operations: string[] }).operations.map((op) => `${kind}.${direction}.${op}`)));
}

/** Operations with a case below. */
const CASES = [
  'dives.export.create', 'dives.export.readBack', 'dives.export.find', 'dives.export.link', 'dives.export.update',
  'dives.export.delete', 'diveSites.import.find', 'buddies.import.find', 'dives.import.list',
];
/** Operations the adapter interface doesn't carry, and where they are tested instead. */
const ELSEWHERE: Record<string, string> = {
  'diveSites.import.list': "a SiteSourceAdapter for the admin's Site import (site-source-adapters.test.ts)",
};

export function providerContract(name: string, make: () => ContractHarness) {
  describe(`${name}: the Provider contract`, () => {
    const ops = declared(make().adapter);
    const declares = (op: string) => ops.includes(op);
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
        for (const r of exports.requirements) {
          expect(['blocking', 'advisory']).toContain(r.severity);
          expect(r.description.length).toBeGreaterThan(0);
          if (r.type === 'site_external_id') expect(SITE_SOURCES).toContain(r.source);
          else if (r.type === 'diver_mapping') {
            expect(['ssi', 'padi']).toContain(r.source);
            for (const role of r.roles) expect(PARTICIPANT_ROLES).toContain(role);
          } else expect.unreachable(`unknown requirement type ${(r as { type: string }).type}`);
        }
        expect(exports.operations.includes('readBack')).toBe((exports.readBackFields ?? []).length > 0);
        if (exports.delivery === 'handed_over') {
          // Without an ID back there is nothing to update, delete, link or find again.
          for (const op of ['update', 'delete', 'link', 'find'] as const) expect(exports.operations).not.toContain(op);
        }
        const action = adapter.dives!.open({ connectionId: 'x', accountId: 'x', access: 'x' });
        expect(!!action.update).toBe(exports.operations.includes('update'));
        expect(!!action.remove).toBe(exports.operations.includes('delete'));
        // Deleting at several Providers asks each first whether the dive is still there.
        expect(!!action.exists).toBe(exports.operations.includes('delete'));
        expect(!!action.find).toBe(exports.operations.includes('find'));
        if (exports.operations.includes('link')) expect(exports.operations).toContain('find');
      }
      expect(!!c.data.diveSites?.import?.operations.includes('find')).toBe(!!adapter.diveSites);
      expect(!!c.data.buddies?.import?.operations.includes('find')).toBe(!!adapter.buddies);
      // The list's people are matched to Divers by their account at the Provider.
      if (adapter.buddies) expect(adapter.accountSource).toBeDefined();
    });

    it('has a case for every operation it declares', () => {
      for (const op of ops) expect(CASES.includes(op) || op in ELSEWHERE, `no contract case for ${op}`).toBe(true);
    });

    it('signs in, and refuses a wrong sign-in with a reason', async () => {
      const h = make();
      const signedIn = await h.adapter.signIn(h.signIn);
      expect(signedIn.account.id).toEqual(expect.any(String));
      expect(signedIn.account.label).toEqual(expect.any(String));
      expect(signedIn.access).toEqual(expect.any(String));
      expect(await reasonOf(h, h.adapter.signIn(h.wrongSignIn))).toBe('wrong_credentials');
    });

    it.runIf(!!make().adapter.dives)('fingerprints what it receives: the same Dive the same, a changed Dive differently', () => {
      const { adapter, dive } = make();
      expect(adapter.dives!.fingerprint(dive)).toBe(adapter.dives!.fingerprint({ ...dive }));
      expect(adapter.dives!.fingerprint({ ...dive, notes: `${dive.notes ?? ''} changed` })).not.toBe(adapter.dives!.fingerprint(dive));
    });

    it.runIf(declares('dives.export.create'))('creates: with an ID back when delivery is confirmed, without one when handed over', async () => {
      const h = make();
      const delivered = await h.adapter.dives!.open(await connect(h)).create(h.dive, 'divehub-contract-1');
      if (h.adapter.capabilities.data.dives!.export!.delivery === 'confirmed') expect(delivered.remoteId).toEqual(expect.any(String));
      else expect(delivered.remoteId).toBeNull();
    });

    it.runIf(declares('dives.export.readBack'))('reads back what it stored: no differences in what it takes as sent', async () => {
      const h = make();
      expect((await h.adapter.dives!.open(await connect(h)).create(h.dive, 'divehub-contract-1')).differences).toEqual([]);
    });

    it.runIf(declares('dives.export.find'))('finds a dive it got before by our reference, and one at about the same time', async () => {
      const h = make();
      const action = h.adapter.dives!.open(await connect(h));
      expect(await action.find!(h.dive, 'divehub-contract-2')).toEqual({ ours: null, sameTime: null });
      const { remoteId } = await action.create(h.dive, 'divehub-contract-2');
      const found = await h.adapter.dives!.open(await connect(h)).find!(later(h.dive, 1), 'divehub-contract-2');
      expect(found.ours?.remoteId).toBe(remoteId);
      expect(found.sameTime?.remoteId).toBe(remoteId);
      expect((await h.adapter.dives!.open(await connect(h)).find!(later(h.dive, 60), 'divehub-other')).sameTime).toBeNull();
    });

    it.runIf(declares('dives.export.link'))('links: the dive found at the same time can be updated as ours', async () => {
      const h = make();
      const ctx = await connect(h);
      const { remoteId } = await h.adapter.dives!.open(ctx).create(h.dive, 'divehub-contract-6');
      const { sameTime } = await h.adapter.dives!.open(ctx).find!(later(h.dive, 1), 'divehub-other');
      expect(sameTime?.remoteId).toBe(remoteId);
      expect((await h.adapter.dives!.open(ctx).update!(sameTime!.remoteId, { ...h.dive, notes: 'Linked' }, null))?.remoteId).toBe(remoteId);
    });

    it.runIf(declares('dives.export.update'))('updates the same remote dive, and answers null once it is gone', async () => {
      const h = make();
      const ctx = await connect(h);
      const { remoteId } = await h.adapter.dives!.open(ctx).create(h.dive, 'divehub-contract-3');
      const updated = await h.adapter.dives!.open(ctx).update!(remoteId!, { ...h.dive, notes: 'Turtle' }, null);
      expect(updated?.remoteId).toBe(remoteId);
      h.deleteThere!(remoteId!);
      expect(await h.adapter.dives!.open(ctx).update!(remoteId!, h.dive, null)).toBeNull();
    });

    it.runIf(declares('dives.export.delete'))('deletes, says when the remote dive was already gone, and tells whether it is there', async () => {
      const h = make();
      const ctx = await connect(h);
      const action = () => h.adapter.dives!.open(ctx);
      const { remoteId } = await action().create(h.dive, 'divehub-contract-4');
      expect(await action().exists!(remoteId!)).toBe(true);
      expect(await action().remove!(remoteId!)).toBe('deleted');
      expect(await action().exists!(remoteId!)).toBe(false);
      expect(await action().remove!(remoteId!)).toBe('gone');
      // Gone because the User deleted it in the Provider's own app.
      const other = await action().create(later(h.dive, 120), 'divehub-contract-7');
      h.deleteThere!(other.remoteId!);
      expect(await action().exists!(other.remoteId!)).toBe(false);
    });

    it.runIf(!!make().adapter.dives)('says unavailable when the service is down, and signed_out when the access expired', async () => {
      const h = make();
      const ctx = await connect(h);
      h.outage(true);
      expect(await reasonOf(h, h.adapter.dives!.open(ctx).create(h.dive, 'divehub-contract-5'))).toBe('unavailable');
      expect(await reasonOf(h, h.adapter.signIn(h.signIn))).toBe('unavailable');
      h.outage(false);
      h.expire();
      expect(await reasonOf(h, h.adapter.dives!.open(ctx).create(h.dive, 'divehub-contract-5'))).toBe('signed_out');
    });

    const mapsDivers = !!make().adapter.capabilities.data.dives?.export?.requirements.some((r) => r.type === 'diver_mapping');
    it.runIf(mapsDivers)('takes a Participant by the reference its requirement names, and counts Participants in its fingerprint', async () => {
      const h = make();
      expect(h.participant, 'a harness for an adapter with diver_mapping names a participant').toBeDefined();
      const withBuddy = { ...h.dive, participants: [h.participant!] };
      expect(h.adapter.dives!.fingerprint(withBuddy)).not.toBe(h.adapter.dives!.fingerprint(h.dive));
      const delivered = await h.adapter.dives!.open(await connect(h)).create(withBuddy, 'divehub-contract-8');
      expect(delivered.leftOut ?? []).toEqual([]);
      // Someone it doesn't have is left out, not refused.
      const stranger: OutgoingParticipant = { ...h.participant!, diverId: 'stranger', ids: { ssi: '1', padi: 'x-1' } };
      const other = await h.adapter.dives!.open(await connect(h)).create({ ...later(h.dive, 240), participants: [stranger] }, 'divehub-contract-9');
      expect(other.remoteId === null || typeof other.remoteId === 'string').toBe(true);
    });

    it.runIf(declares('dives.import.list'))('lists the account\'s dives with their context, and parses each without calls', async () => {
      const h = make();
      expect(h.seedDives, 'a harness for an adapter with dives.import.list seeds dives').toBeDefined();
      expect(h.adapter.dives?.list && h.adapter.dives.parse && h.adapter.dives.parser).toBeTruthy();
      h.seedDives!();
      const ctx = await connect(h);
      // One sent by Dive Hub carries our reference, and is told apart from the others.
      await h.adapter.dives!.open(ctx).create(h.dive, 'divehub-0190a3f2-0000-7000-8000-000000000001');
      const { records, context } = await h.adapter.dives!.list!(ctx);
      expect(records.length).toBeGreaterThanOrEqual(3);
      // The context: accounts and sites only, nothing else the Provider knows about people.
      for (const account of Object.values(context.people)) expect(typeof account).toBe('string');
      for (const site of Object.values(context.sites)) expect(Object.keys(site).sort()).toEqual(['country', 'latitude', 'longitude', 'name', 'waterType']);
      const parsed = records.map((r) => h.adapter.dives!.parse!(r.record, context));
      for (const [i, d] of parsed.entries()) {
        expect(d?.remoteId).toBe(records[i]!.remoteId);
        expect(d!.localStart).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
        expect(d!.durationSeconds).toBeGreaterThan(0);
      }
      expect(new Set(parsed.map((d) => d!.evidence))).toEqual(new Set(['ours', 'computer', 'logbook']));
      const fromComputer = parsed.find((d) => d!.evidence === 'computer')!;
      expect(fromComputer.device?.serialNumber).toEqual(expect.any(String));
      expect(fromComputer.samples.depth?.values.length).toBeGreaterThan(1);
      expect(parsed.find((d) => d!.evidence === 'ours')!.reference).toBe('divehub-0190a3f2-0000-7000-8000-000000000001');
    });

    it.runIf(declares('buddies.import.find'))('offers the account\'s own list of people: an ID, a name and their account, nothing else', async () => {
      const h = make();
      const buddies = await h.adapter.buddies!.find(await connect(h));
      expect(buddies.length).toBeGreaterThan(0);
      for (const b of buddies) {
        expect(Object.keys(b).sort()).toEqual(['account', 'name', 'remoteId']);
        expect([typeof b.remoteId, typeof b.name]).toEqual(['string', 'string']);
        expect(b.account === null || typeof b.account === 'string').toBe(true);
      }
    });

    it.runIf(declares('diveSites.import.find'))('offers its dive sites with their IDs', async () => {
      const h = make();
      const sites = await h.adapter.diveSites!.find(await connect(h));
      const numberOrNull = (v: unknown) => v === null || typeof v === 'number';
      for (const s of sites) {
        expect(Object.keys(s).sort()).toEqual(['country', 'id', 'latitude', 'longitude', 'name']);
        expect([typeof s.id, typeof s.name]).toEqual(['string', 'string']);
        expect(numberOrNull(s.latitude) && numberOrNull(s.longitude) && (s.country === null || typeof s.country === 'string')).toBe(true);
      }
    });
  });
}

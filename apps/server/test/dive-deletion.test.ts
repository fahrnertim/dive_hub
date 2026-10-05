// Deleting a Dive through the HTTP API (ADR 0026, data model A5 and scenario 4): a soft delete with a Revision,
// gone from lists, counts and search; re-imports skip it ("deleted earlier"); restoring brings it back; and the
// SSI copy is deleted there too on request (through the provider layer, ADR 0027), or stays with a reminder. At several
// Providers (SSI and the test-only ledger), each is checked first; one that still fails keeps the Dive and says which
// copies are gone.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dive, recording } from '../src/db/schema.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Outcome = { result: string; diveId?: string; recordingId?: string; reason?: string };
type DeletedDive = {
  id: string; version: number; number: number | null; site: { id: string; name: string } | null; deletedAt: string;
  stillAt: { provider: string; remoteNumber: number | null }[];
};

describe.skipIf(!(await databaseReachable()))('deleting a Dive', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let other: string;
  let siteId: string;
  const ledger = createFakeLedger();

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie = tim, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie = tim, payload?: object) =>
    (await call(method, url, cookie, payload)).json() as T;
  const version = async (id: string) => (await json<{ version: number }>('GET', `/api/dives/${id}`)).version;
  const remove = async (id: string, body: object = {}, cookie = tim) => call('DELETE', `/api/dives/${id}`, cookie, { version: await version(id), ...body });
  const deleted = () => json<{ dives: DeletedDive[] }>('GET', '/api/dives/deleted');

  async function upload(fileName: string, data: Uint8Array, cookie = tim): Promise<Outcome> {
    const { payload, headers } = multipartFile(fileName, data);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(response.json().id);
    return (await call('GET', `/api/imports/${response.json().id}`, cookie)).json().outcome[0];
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t, { extraProviders: [ledger.adapter] });
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'other@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    other = await signIn(ctx.app, 'other@example.com');
    siteId = (await json<{ id: string }>('POST', '/api/dive-sites', tim, { name: 'Hausreef', position: { latitude: 27.29, longitude: 33.82 } })).id;
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('in the hub', () => {
    let gone: string;
    let kept: string;
    const file = makeSyntheticDive({ serialNumber: 111 });

    beforeAll(async () => {
      gone = (await upload('gone.fit', file)).diveId!;
      kept = (await upload('kept.fit', makeSyntheticDive({ serialNumber: 111, start: new Date('2026-01-16T09:00:00Z') }))).diveId!;
      for (const id of [gone, kept]) {
        await call('PATCH', `/api/dives/${id}`, tim, { version: await version(id), siteId, notes: 'Turtle' });
      }
    });

    it('is refused to Users who don\'t manage the Diver, and for an outdated version', async () => {
      expect((await remove(gone, {}, other)).statusCode).toBe(404);
      const outdated = await call('DELETE', `/api/dives/${gone}`, tim, { version: (await version(gone)) - 1 });
      expect(outdated.statusCode).toBe(409);
      expect(outdated.json()).toMatchObject({ code: 'dive_changed' });
      expect((await call('GET', `/api/dives/${gone}`)).statusCode).toBe(200);
    });

    it('takes the Dive out of the logbook, its counts, search, the site\'s counts, and the Diver\'s count', async () => {
      const response = await remove(gone);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ providers: [] });

      expect((await call('GET', `/api/dives/${gone}`)).statusCode).toBe(404);
      expect((await call('GET', `/api/dives/${gone}/revisions`)).statusCode).toBe(404);
      expect(await json('GET', '/api/dives')).toMatchObject({ total: 1, dives: [{ id: kept }] });
      expect(await json('GET', '/api/dives?q=Turtle')).toMatchObject({ total: 1 });
      expect(await json('GET', `/api/dives?siteId=${siteId}`)).toMatchObject({ total: 1 });
      expect(await json('GET', `/api/dive-sites/${siteId}`)).toMatchObject({ diveCount: 1, inUse: true });
      expect((await json<{ isOwn: boolean; diveCount: number }[]>('GET', '/api/divers')).find((d) => d.isOwn)).toMatchObject({ diveCount: 1 });
      // A second delete finds nothing.
      expect((await call('DELETE', `/api/dives/${gone}`, tim, { version: 1 })).statusCode).toBe(404);
    });

    it('is soft: the Dive and its Recordings get a tombstone, and a Revision records it', async () => {
      const [row] = await t.db.select().from(dive).where(eq(dive.id, gone));
      expect(row!.deletedAt).not.toBeNull();
      const recs = await t.db.select().from(recording).where(eq(recording.diveId, gone));
      expect(recs).toHaveLength(1);
      expect(recs[0]!.deletedAt?.getTime()).toBe(row!.deletedAt!.getTime());
    });

    it('lists deleted Dives to their Users only', async () => {
      expect((await deleted()).dives).toEqual([expect.objectContaining({ id: gone, site: { id: siteId, name: 'Hausreef' }, stillAt: [] })]);
      expect((await json<{ dives: unknown[] }>('GET', '/api/dives/deleted', other)).dives).toEqual([]);
    });

    it('skips the same file, a re-export of it, and doesn\'t create the Dive again', async () => {
      expect(await upload('gone-again.fit', file)).toMatchObject({ result: 'skipped', reason: 'deleted_earlier' });
      // Same Recording key (device and start), different bytes.
      expect(await upload('gone-reexport.fit', makeSyntheticDive({ serialNumber: 111, maxDepthM: 18.7 })))
        .toMatchObject({ result: 'skipped', reason: 'deleted_earlier' });
      expect(await json('GET', '/api/dives')).toMatchObject({ total: 1 });
      // Another User's file with that Recording is still not theirs.
      expect(await upload('mine.fit', file, other)).toMatchObject({ result: 'skipped', reason: 'not_your_diver' });
    });

    it('can be restored, with its Recordings, and the history shows both', async () => {
      const [entry] = (await deleted()).dives;
      expect((await call('POST', `/api/dives/${gone}/restore`, other, { version: entry!.version })).statusCode).toBe(404);
      expect((await call('POST', `/api/dives/${gone}/restore`, tim, { version: entry!.version - 1 })).json()).toMatchObject({ code: 'dive_changed' });
      const restored = await call('POST', `/api/dives/${gone}/restore`, tim, { version: entry!.version });
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toMatchObject({ id: gone, site: { id: siteId }, recordings: [expect.anything()] });
      expect(await json('GET', '/api/dives')).toMatchObject({ total: 2 });
      expect((await deleted()).dives).toEqual([]);
      const history = await json<{ cause: string }[]>('GET', `/api/dives/${gone}/revisions`);
      expect(history.slice(0, 2).map((r) => r.cause)).toEqual(['restore', 'delete']);
      // Live again: a re-import updates it in place.
      expect(await upload('gone-third.fit', makeSyntheticDive({ serialNumber: 111, maxDepthM: 18.8 }))).toMatchObject({ result: 'updated', diveId: gone });
      expect((await call('POST', `/api/dives/${gone}/restore`, tim, { version: await version(gone) })).statusCode).toBe(404);
    });

    it('restores to the site a deleted site was merged into, and without a site once its site is gone', async () => {
      const merged = (await json<{ id: string; version: number }>('POST', '/api/dive-sites', tim, { name: 'Hausriff', position: { latitude: 27.2901, longitude: 33.8201 } }));
      await call('PATCH', `/api/dives/${kept}`, tim, { version: await version(kept), siteId: merged.id });
      await remove(kept);
      const into = await json<{ version: number }>('GET', `/api/dive-sites/${siteId}`);
      expect((await call('POST', `/api/dive-sites/${merged.id}/merge`, tim, { intoId: siteId, version: merged.version, intoVersion: into.version })).statusCode).toBe(200);
      const v1 = (await deleted()).dives.find((d) => d.id === kept)!.version;
      expect((await json('POST', `/api/dives/${kept}/restore`, tim, { version: v1 }))).toMatchObject({ site: { id: siteId } });

      const lonely = (await json<{ id: string }>('POST', '/api/dive-sites', tim, { name: 'Lonely', position: { latitude: 10, longitude: 10 } })).id;
      await call('PATCH', `/api/dives/${kept}`, tim, { version: await version(kept), siteId: lonely });
      await remove(kept);
      expect((await call('DELETE', `/api/dive-sites/${lonely}`)).statusCode).toBe(204);
      const v2 = (await deleted()).dives.find((d) => d.id === kept)!.version;
      expect((await json('POST', `/api/dives/${kept}/restore`, tim, { version: v2 }))).toMatchObject({ site: null });
    });
  });

  describe('Duplicate candidates', () => {
    it('no longer offer a deleted Dive', async () => {
      const morning = (await upload('morning.fit', makeSyntheticDive({ serialNumber: 222, start: new Date('2026-02-01T09:00:00Z') }))).diveId!;
      const backup = await upload('backup.fit', makeSyntheticDive({
        serialNumber: 999, start: new Date('2026-02-01T09:01:00Z'), durationSeconds: 29 * 60, maxDepthM: 30,
      }));
      expect(backup).toMatchObject({ result: 'duplicate-candidate' });
      await remove(morning);
      const [open] = await json<{ dives: unknown[] }[]>('GET', '/api/duplicate-candidates');
      expect(open!.dives).toEqual([]);
    });
  });

  describe('a Dive in SSI', () => {
    let diveId: string;
    const SSI = { login: 'erika@example.com', password: 'ssi-password' };
    const ssiDive = (id: string) => ctx.fakeSsi.dives.get(Number(id))!;
    const sendToSsi = async (start: string) => {
      const id = (await upload(`${start}.fit`, makeSyntheticDive({ serialNumber: 333, start: new Date(start) }))).diveId!;
      await call('PATCH', `/api/dives/${id}`, tim, { version: await version(id), siteId: ssiSite });
      expect((await json('POST', `/api/dives/${id}/providers/ssi`, tim, {}))).toMatchObject({ outcome: 'created' });
      return id;
    };
    const remoteOf = async (id: string) => (await json<{ current: { remoteId: string } }>('GET', `/api/dives/${id}/providers/ssi`)).current.remoteId;
    let ssiSite: string;

    beforeAll(async () => {
      const divers = await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers');
      await call('POST', '/api/connections/ssi', tim, { diverId: divers.find((d) => d.isOwn)!.id, ...SSI, keepSignedIn: false });
      ssiSite = (await json<{ id: string }>('POST', '/api/dive-sites', tim, { name: 'SSI reef', position: { latitude: 27.3, longitude: 33.8 }, ssiSiteId: '3314' })).id;
      diveId = await sendToSsi('2026-03-01T09:00:00Z');
    });

    it('deletes nothing when SSI fails, and says why', async () => {
      ctx.fakeSsi.failWith = 503;
      const response = await remove(diveId, { alsoAt: ['ssi'] });
      ctx.fakeSsi.failWith = null;
      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ code: 'provider_unavailable', provider: 'ssi' });
      expect((await call('GET', `/api/dives/${diveId}`)).statusCode).toBe(200);
    });

    it('deletes it in SSI too when asked', async () => {
      const remoteId = await remoteOf(diveId);
      const response = await remove(diveId, { alsoAt: ['ssi'] });
      expect(response.json()).toEqual({ providers: [{ provider: 'ssi', copy: 'deleted' }] });
      expect(ssiDive(remoteId).odin_user_log_deleted).toBe(1);
      expect((await deleted()).dives.find((d) => d.id === diveId)).toMatchObject({ stillAt: [] });
    });

    it('keeps the SSI dive when the User declines, reminds, and deletes it there later', async () => {
      const id = await sendToSsi('2026-03-02T09:00:00Z');
      const remoteId = await remoteOf(id);
      expect((await remove(id, { alsoAt: [] })).json()).toEqual({ providers: [{ provider: 'ssi', copy: 'kept' }] });
      expect(ssiDive(remoteId).odin_user_log_deleted).not.toBe(1);
      const entry = (await deleted()).dives.find((d) => d.id === id)!;
      expect(entry.stillAt).toEqual([{ provider: 'ssi', remoteNumber: expect.any(Number) }]);
      // Still not sendable while deleted, but deletable there.
      expect((await call('POST', `/api/dives/${id}/providers/ssi`, tim, {})).statusCode).toBe(404);
      expect((await call('DELETE', `/api/dives/${id}/providers/ssi`, other)).statusCode).toBe(404);
      expect((await call('DELETE', `/api/dives/${id}/providers/ssi`)).statusCode).toBe(200);
      expect(ssiDive(remoteId).odin_user_log_deleted).toBe(1);
      expect((await deleted()).dives.find((d) => d.id === id)!.stillAt).toEqual([]);
    });

    it('refuses to delete in SSI without a Connection, and deletes nothing', async () => {
      const id = await sendToSsi('2026-03-03T09:00:00Z');
      const conn = (await json<{ connection: { id: string } }>('GET', `/api/dives/${id}/providers/ssi`)).connection;
      await call('DELETE', `/api/connections/${conn.id}`);
      expect((await remove(id, { alsoAt: ['ssi'] })).json()).toMatchObject({ code: 'provider_not_connected' });
      expect((await call('GET', `/api/dives/${id}`)).statusCode).toBe(200);
      expect((await remove(id)).json()).toEqual({ providers: [{ provider: 'ssi', copy: 'kept' }] });
    });
  });

  describe('a Dive at two Providers', () => {
    const both = { alsoAt: ['ssi', 'ledger'] };
    type Status = { provider: string; current: { remoteId: string } | null; pushes: { action: string; state: string; failureCode: string | null; remoteGone: boolean }[] };
    const statuses = async (id: string) => json<Status[]>('GET', `/api/dives/${id}/providers`);
    const at = async (id: string, provider: string) => (await statuses(id)).find((s) => s.provider === provider)!;
    let ledgerConnection: string;
    let bothSite: string;

    /** A Dive sent to SSI and to the ledger. */
    const sentToBoth = async (start: string) => {
      const id = (await upload(`${start}.fit`, makeSyntheticDive({ serialNumber: 444, start: new Date(start) }))).diveId!;
      await call('PATCH', `/api/dives/${id}`, tim, { version: await version(id), siteId: bothSite });
      for (const provider of ['ssi', 'ledger']) expect(await json('POST', `/api/dives/${id}/providers/${provider}`, tim, {})).toMatchObject({ outcome: 'created' });
      return id;
    };

    beforeAll(async () => {
      const diverId = (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers')).find((d) => d.isOwn)!.id;
      // The SSI Connection of the section above was disconnected at its end.
      await call('POST', '/api/connections/ssi', tim, { diverId, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: false });
      ledgerConnection = (await json<{ id: string }>('POST', '/api/connections/ledger', tim, { diverId, token: 'ledger-token-1', keepSignedIn: false })).id;
      bothSite = (await json<{ id: string }>('POST', '/api/dive-sites', tim, { name: 'Both reef', position: { latitude: 27.4, longitude: 33.9 }, ssiSiteId: '4410' })).id;
    });

    it('checks every Provider first: when one would refuse, nothing is deleted anywhere', async () => {
      const id = await sentToBoth('2026-04-01T09:00:00Z');
      const ssiRemote = (await at(id, 'ssi')).current!.remoteId;
      ledger.expireTokens();
      const response = await remove(id, both);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'provider_sign_in_needed', provider: 'ledger', providerName: 'Ledger',
        providers: [{ provider: 'ssi', copy: 'kept' }, { provider: 'ledger', copy: 'kept' }],
      });
      expect(ctx.fakeSsi.dives.get(Number(ssiRemote))!.odin_user_log_deleted).not.toBe(1);
      expect((await call('GET', `/api/dives/${id}`)).statusCode).toBe(200);
      expect((await at(id, 'ssi')).pushes[0]).toMatchObject({ action: 'create' });

      ledger.tokens.set('ledger-token-2', { accountId: 'l-5', label: 'Ledger of Erika' });
      await call('POST', `/api/connections/${ledgerConnection}/sign-in`, tim, { token: 'ledger-token-2', keepSignedIn: false });
      expect((await remove(id, both)).json()).toEqual({ providers: [{ provider: 'ssi', copy: 'deleted' }, { provider: 'ledger', copy: 'deleted' }] });
      expect(ctx.fakeSsi.dives.get(Number(ssiRemote))!.odin_user_log_deleted).toBe(1);
    });

    it('keeps the Dive when one still fails, says which copies are gone, and records it', async () => {
      const id = await sentToBoth('2026-04-02T09:00:00Z');
      ledger.refuseDelete = true;
      const response = await remove(id, both);
      ledger.refuseDelete = false;
      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({
        code: 'provider_refused', provider: 'ledger', providers: [{ provider: 'ssi', copy: 'deleted' }, { provider: 'ledger', copy: 'kept' }],
      });
      expect((await call('GET', `/api/dives/${id}`)).statusCode).toBe(200);
      const [ssiNow, ledgerNow] = [await at(id, 'ssi'), await at(id, 'ledger')];
      expect([ssiNow.current, ssiNow.pushes[0]]).toMatchObject([null, { action: 'delete', state: 'confirmed' }]);
      expect([ledgerNow.current, ledgerNow.pushes[0]]).toMatchObject([{ remoteId: expect.any(String) }, { action: 'delete', state: 'failed', failureCode: 'provider_refused' }]);
      // Asked again, only the ledger's copy is left to delete.
      expect((await remove(id, both)).json()).toEqual({ providers: [{ provider: 'ledger', copy: 'deleted' }] });
    });

    it("counts a copy already deleted in the Provider's own app as gone", async () => {
      const id = await sentToBoth('2026-04-03T09:00:00Z');
      ledger.dives.delete((await at(id, 'ledger')).current!.remoteId);
      expect((await remove(id, both)).json()).toEqual({ providers: [{ provider: 'ssi', copy: 'deleted' }, { provider: 'ledger', copy: 'deleted' }] });
      expect((await at(id, 'ledger')).pushes[0]).toMatchObject({ action: 'delete', state: 'confirmed', remoteGone: true });
    });
  });
});

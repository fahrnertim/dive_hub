// SSI's app API client (ADR 0024) against the fake: what it sends, what it understands, and that no error
// ever carries the password, the token or a URL (SSI takes both in the query string).
import { describe, expect, it } from 'vitest';
import { createSsiClient, SsiError, type Fetch } from '../src/providers/ssi/ssi-client.js';
import { createFakeSsi } from './fake-ssi.js';

const URL_ = 'https://ssi.invalid/app/a21.php';
const PASSWORD = 'ssi-password';

describe('SSI client', () => {
  it('signs in, reads the logbook and saves a dive, introducing itself as the SSI app does (ADR 0049)', async () => {
    // Hausreef with SSI's body of water: salt is the site's water type (an artificial one would be none).
    const fake = createFakeSsi({ sites: [{ odin_dive_sites_id: 3314, odin_dive_sites_name: 'Hausreef', odin_dive_sites_lat: 27.29, odin_dive_sites_lon: 33.82, odin_countries_code_iso: 'EG', bow: 'salt' }] });
    const seen: Record<string, string>[] = [];
    const fetch: Fetch = (url, init) => { seen.push(init.headers); return fake.fetch(url, init); };
    const client = createSsiClient({ url: URL_, fetch });
    const account = await client.signIn('erika@example.com', PASSWORD);
    expect(account).toEqual({ token: 'token-1', accountId: '5012047', email: 'erika@example.com' });
    const { id } = await client.save(account.token, { odin_user_log_id: null, odin_user_log_nr: 1 });
    const logbook = await client.logbook(account.token);
    expect(logbook.dives.map((d) => String(d.odin_user_log_id))).toEqual([id]);
    expect(logbook.sites).toEqual([{ id: '3314', name: 'Hausreef', latitude: 27.29, longitude: 33.82, country: 'EG', waterType: 'salt' }]);
    expect(seen.every((h) => h['User-Agent'] === 'Dart/3.12 (dart:io)')).toBe(true);
  });

  it('leaves deleted dives out of the logbook', async () => {
    const fake = createFakeSsi();
    const client = createSsiClient({ url: URL_, fetch: fake.fetch });
    const { token } = await client.signIn('erika@example.com', PASSWORD);
    const { id } = await client.save(token, { odin_user_log_id: null });
    await client.save(token, { odin_user_log_id: Number(id), odin_user_log_deleted: 1 });
    expect((await client.logbook(token)).dives).toEqual([]);
  });

  it('reads an update\'s answer, which SSI wraps in success, and SSI\'s reason when it refuses one', async () => {
    const answering = (body: object): Fetch => async () => ({ status: 200, text: async () => JSON.stringify(body) });
    // The owner's update of dive #90, 2026-10-06 (from the server log): the usual answer, wrapped in `success`.
    const saved = createSsiClient({ url: URL_, fetch: answering({
      success: { ok: 'updated', error: '', temp_id: '', odin_user_log_id: 28_076_338 }, result: 'updated',
    }) });
    expect(await saved.save('t', { odin_user_log_id: 28_076_338 })).toMatchObject({ id: '28076338' });
    const refused = createSsiClient({ url: URL_, fetch: answering({ success: { ok: '', error: 'not your dive' }, result: '' }) });
    await expect(refused.save('t', { odin_user_log_id: 1 })).rejects.toMatchObject({ reason: 'refused', message: expect.stringContaining('not your dive') });
    const empty = createSsiClient({ url: URL_, fetch: answering({ success: { ok: '' }, result: '' }) });
    await expect(empty.save('t', { odin_user_log_id: 1 })).rejects.toMatchObject({ message: expect.stringContaining('fields: success, result / success: ok') });
  });

  it('refuses a save SSI answers with an invented dive ID: it says "added to Log" and stores nothing', async () => {
    const answering = (body: object): Fetch => async () => ({ status: 200, text: async () => JSON.stringify(body) });
    // What SSI answers a client that isn't its app (the owner's account, 2026-10-10): the same for an update and a create.
    const dropped = createSsiClient({ url: URL_, fetch: answering({ ok: 'added to Log', error: '', temp_id: '', odin_user_log_id: '966002090' }) });
    await expect(dropped.save('t', { odin_user_log_id: 28_831_347 })).rejects.toMatchObject({ reason: 'not_stored', message: expect.stringContaining('another dive ID') });
    // The fake does as SSI does: a save from another User-Agent is answered and not stored.
    const fake = createFakeSsi();
    const app = createSsiClient({ url: URL_, fetch: fake.fetch });
    const other: Fetch = (url, init) => fake.fetch(url, { ...init, headers: { ...init.headers, 'User-Agent': 'DiveHub (+https://example.org)' } });
    const { token } = await app.signIn('erika@example.com', PASSWORD);
    const { id } = await createSsiClient({ url: URL_, fetch: other }).save(token, { odin_user_log_id: null });
    expect(id).toMatch(/^9\d{8}$/);
    expect((await app.logbook(token)).dives).toEqual([]);
  });

  it('tells a refused sign-in from an expired token, an outage and nonsense', async () => {
    const fake = createFakeSsi();
    const client = createSsiClient({ url: URL_, fetch: fake.fetch });
    await expect(client.signIn('erika@example.com', 'wrong')).rejects.toMatchObject({ reason: 'wrong_credentials' });
    const { token } = await client.signIn('erika@example.com', PASSWORD);
    fake.expireTokens();
    await expect(client.logbook(token)).rejects.toMatchObject({ reason: 'signed_out' });
    await expect(client.save(token, {})).rejects.toMatchObject({ reason: 'signed_out' });
    fake.failWith = 503;
    await expect(client.logbook(token)).rejects.toMatchObject({ reason: 'unavailable' });
    const html: Fetch = async () => ({ status: 200, text: async () => '<html>maintenance</html>' });
    await expect(createSsiClient({ url: URL_, fetch: html }).logbook(token)).rejects.toMatchObject({ reason: 'bad_response' });
  });

  it('never puts the password, the token or the URL into an error', async () => {
    const failing: Fetch = async (url) => { throw new TypeError(`fetch failed: ${url}`); };
    const errors: unknown[] = [];
    const client = createSsiClient({ url: URL_, fetch: failing });
    await client.signIn('erika@example.com', PASSWORD).catch((e: unknown) => errors.push(e));
    await client.logbook('secret-token').catch((e: unknown) => errors.push(e));
    const refusing: Fetch = async () => ({ status: 500, text: async () => '' });
    await createSsiClient({ url: URL_, fetch: refusing }).signIn('erika@example.com', PASSWORD).catch((e: unknown) => errors.push(e));
    expect(errors).toHaveLength(3);
    for (const e of errors) {
      expect(e).toBeInstanceOf(SsiError);
      const text = `${(e as Error).message} ${(e as Error).stack}`;
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain('secret-token');
      expect(text).not.toContain('ssi.invalid');
    }
  });
});

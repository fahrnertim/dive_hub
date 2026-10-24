// SSI's app API client (ADR 0024) against the fake: what it sends, what it understands, and that no error
// ever carries the password, the token or a URL (SSI takes both in the query string).
import { describe, expect, it } from 'vitest';
import { createSsiClient, SsiError, type Fetch } from '../src/providers/ssi/ssi-client.js';
import { createFakeSsi, fakeCard, PNG_BYTES } from './fake-ssi.js';

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
    expect(logbook.sites).toEqual([{ id: '3314', name: 'Hausreef', latitude: 27.29, longitude: 33.82, country: 'EG', waterType: 'salt', privateOwner: null }]);
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
    await expect(client.logbook(token)).rejects.toMatchObject({ reason: 'maintenance' });
    fake.failWith = 500;
    await expect(client.logbook(token)).rejects.toMatchObject({ reason: 'unavailable' });
    const html: Fetch = async () => ({ status: 200, text: async () => '<html>maintenance</html>' });
    await expect(createSsiClient({ url: URL_, fetch: html }).logbook(token)).rejects.toMatchObject({ reason: 'bad_response' });
  });

  it('reads a body status 401 as signed out under any HTTP status, as the app does', async () => {
    const fake = createFakeSsi();
    const client = createSsiClient({ url: URL_, fetch: fake.fetch });
    const { token } = await client.signIn('erika@example.com', PASSWORD);
    fake.expireTokens();
    for (const status of [200, 404, 500]) {
      for (const body of [{ status: 401 }, { status: '401' }]) {
        fake.expiredAnswer = { status, body };
        await expect(client.logbook(token)).rejects.toMatchObject({ reason: 'signed_out' });
        await expect(client.save(token, {})).rejects.toMatchObject({ reason: 'signed_out' });
      }
    }
    fake.expiredAnswer = { status: 404, body: '<html>not found</html>' };
    await expect(client.logbook(token)).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('never puts the password, the token or the URL into an error', async () => {
    const failing: Fetch = async (url) => { throw new TypeError(`fetch failed: ${url}`); };
    const errors: unknown[] = [];
    const client = createSsiClient({ url: URL_, fetch: failing });
    await client.signIn('erika@example.com', PASSWORD).catch((e: unknown) => errors.push(e));
    await client.logbook('secret-token').catch((e: unknown) => errors.push(e));
    const refusing: Fetch = async () => ({ status: 500, text: async () => '' });
    await createSsiClient({ url: URL_, fetch: refusing }).signIn('erika@example.com', PASSWORD).catch((e: unknown) => errors.push(e));
    const fake = createFakeSsi();
    const real = createSsiClient({ url: URL_, fetch: fake.fetch });
    const { token } = await real.signIn('erika@example.com', PASSWORD);
    fake.expireTokens();
    fake.expiredAnswer = { status: 404, body: { status: 401 } };
    await real.logbook(token).catch((e: unknown) => errors.push(e));
    fake.failWith = 503;
    await real.logbook(token).catch((e: unknown) => errors.push(e));
    expect(errors).toHaveLength(5);
    for (const e of errors) {
      expect(e).toBeInstanceOf(SsiError);
      const text = `${(e as Error).message} ${(e as Error).stack}`;
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain('secret-token');
      expect(text).not.toContain('token-1');
      expect(text).not.toContain('ssi.invalid');
    }
  });

  describe('certification cards (ADR 0050)', () => {
    const owd = fakeCard(5_012_047, { uid: '123456N1000000000001-EG', course: 'Open Water Diver', short: 'OWD', courseId: 225, issued: '2023-04-23', dives: 5 });

    it('reads the cards as tidy values and leaves out an entry without a usable card ID', async () => {
      const fake = createFakeSsi({ cards: [owd, { ...owd, ccard_uid: 'bad id/../x' }, { ...owd, ccard_uid: '' }] });
      const client = createSsiClient({ url: URL_, fetch: fake.fetch });
      const { token } = await client.signIn('erika@example.com', PASSWORD);
      expect(await client.cards(token)).toEqual([{
        id: '123456N1000000000001-EG', courseName: 'Open Water Diver', courseShort: 'OWD', category: 'scubadiving', courseId: '225', dives: 5,
        issueDate: '2023-04-23', expireDate: null, instructorName: 'Ida Instructor', instructorNumber: '77001', centreName: 'Blue Hole Divers',
        centreNumber: '123456', centreCity: 'Dahab', centreCountry: 'Egypt',
      }]);
      expect(client.cardImageUrl('123456N1000000000001-EG')).toBe('https://my.divessi.com/cert/123456N1000000000001-EG');
    });

    it('fetches a picture without a token, and refuses what is no PNG or is too big', async () => {
      const fake = createFakeSsi({ cards: [owd] });
      const client = createSsiClient({ url: URL_, fetch: fake.fetch });
      const url = client.cardImageUrl(owd.ccard_uid);
      expect((await client.cardImage(url)).bytes).toEqual(PNG_BYTES);
      expect(fake.calls.at(-1)).toEqual({ what: 'card_image', method: 'GET' });
      fake.cardImages.set(owd.ccard_uid, { bytes: PNG_BYTES, contentType: 'text/html' });
      await expect(client.cardImage(url)).rejects.toMatchObject({ reason: 'bad_response' });
      fake.cardImages.set(owd.ccard_uid, { bytes: new Uint8Array(16).fill(7) });
      await expect(client.cardImage(url)).rejects.toMatchObject({ reason: 'bad_response' });
      fake.cardImages.set(owd.ccard_uid, { bytes: new Uint8Array(1_000_001) });
      await expect(client.cardImage(url)).rejects.toMatchObject({ reason: 'bad_response' });
      fake.cardImages.set(owd.ccard_uid, { status: 404, bytes: new Uint8Array() });
      await expect(client.cardImage(url)).rejects.toMatchObject({ reason: 'unavailable' });
    });
  });
});

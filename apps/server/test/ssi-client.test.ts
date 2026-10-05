// SSI's app API client (ADR 0024) against the fake: what it sends, what it understands, and that no error
// ever carries the password, the token or a URL (SSI takes both in the query string).
import { describe, expect, it } from 'vitest';
import { createSsiClient, SsiError, type Fetch } from '../src/providers/ssi/ssi-client.js';
import { createFakeSsi } from './fake-ssi.js';

const URL_ = 'https://ssi.invalid/app/a21.php';
const PASSWORD = 'ssi-password';

describe('SSI client', () => {
  it('signs in, reads the logbook and saves a dive, saying who it is', async () => {
    const fake = createFakeSsi();
    const seen: Record<string, string>[] = [];
    const fetch: Fetch = (url, init) => { seen.push(init.headers); return fake.fetch(url, init); };
    const client = createSsiClient({ url: URL_, fetch, userAgent: 'DiveHub (+https://example.org)' });
    const account = await client.signIn('erika@example.com', PASSWORD);
    expect(account).toEqual({ token: 'token-1', accountId: '5012047', email: 'erika@example.com' });
    const { id } = await client.save(account.token, { odin_user_log_id: null, odin_user_log_nr: 1 });
    const logbook = await client.logbook(account.token);
    expect(logbook.dives.map((d) => String(d.odin_user_log_id))).toEqual([id]);
    expect(logbook.sites).toEqual([{ id: '3314', name: 'Hausreef', latitude: 27.29, longitude: 33.82, country: 'EG' }]);
    expect(seen.every((h) => h['User-Agent'] === 'DiveHub (+https://example.org)')).toBe(true);
  });

  it('leaves deleted dives out of the logbook', async () => {
    const fake = createFakeSsi();
    const client = createSsiClient({ url: URL_, fetch: fake.fetch, userAgent: 'x' });
    const { token } = await client.signIn('erika@example.com', PASSWORD);
    const { id } = await client.save(token, { odin_user_log_id: null });
    await client.save(token, { odin_user_log_id: Number(id), odin_user_log_deleted: 1 });
    expect((await client.logbook(token)).dives).toEqual([]);
  });

  it('tells a refused sign-in from an expired token, an outage and nonsense', async () => {
    const fake = createFakeSsi();
    const client = createSsiClient({ url: URL_, fetch: fake.fetch, userAgent: 'x' });
    await expect(client.signIn('erika@example.com', 'wrong')).rejects.toMatchObject({ reason: 'wrong_credentials' });
    const { token } = await client.signIn('erika@example.com', PASSWORD);
    fake.expireTokens();
    await expect(client.logbook(token)).rejects.toMatchObject({ reason: 'signed_out' });
    await expect(client.save(token, {})).rejects.toMatchObject({ reason: 'signed_out' });
    fake.failWith = 503;
    await expect(client.logbook(token)).rejects.toMatchObject({ reason: 'unavailable' });
    const html: Fetch = async () => ({ status: 200, text: async () => '<html>maintenance</html>' });
    await expect(createSsiClient({ url: URL_, fetch: html, userAgent: 'x' }).logbook(token)).rejects.toMatchObject({ reason: 'bad_response' });
  });

  it('never puts the password, the token or the URL into an error', async () => {
    const failing: Fetch = async (url) => { throw new TypeError(`fetch failed: ${url}`); };
    const errors: unknown[] = [];
    const client = createSsiClient({ url: URL_, fetch: failing, userAgent: 'x' });
    await client.signIn('erika@example.com', PASSWORD).catch((e: unknown) => errors.push(e));
    await client.logbook('secret-token').catch((e: unknown) => errors.push(e));
    const refusing: Fetch = async () => ({ status: 500, text: async () => '' });
    await createSsiClient({ url: URL_, fetch: refusing, userAgent: 'x' }).signIn('erika@example.com', PASSWORD).catch((e: unknown) => errors.push(e));
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

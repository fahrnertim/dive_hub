// Display preferences and machine-readable error codes through the HTTP API (ADR 0014).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { PROBLEMS } from '../src/http/problems.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

const zipOf = (entries: Record<string, Uint8Array>): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, data] of Object.entries(entries)) zip.addBuffer(Buffer.from(data), name);
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });

describe.skipIf(!(await databaseReachable()))('preferences and error codes', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let cookie: string;
  const inject = (method: 'GET' | 'PATCH' | 'POST', url: string, payload?: object, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL, ...headers }, ...(payload && { payload }) });

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'diver@example.com');
    cookie = await signIn(ctx.app, 'diver@example.com');
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  describe('preferences', () => {
    it('follow the browser until the User chooses', async () => {
      expect((await inject('GET', '/api/me')).json().preferences).toEqual({ language: null, units: null });
    });

    it('are saved per User; fields left out stay as they are', async () => {
      expect((await inject('PATCH', '/api/me/preferences', { language: 'de' })).json()).toEqual({ language: 'de', units: null });
      expect((await inject('PATCH', '/api/me/preferences', { units: 'imperial' })).json()).toEqual({ language: 'de', units: 'imperial' });
      expect((await inject('GET', '/api/me')).json().preferences).toEqual({ language: 'de', units: 'imperial' });
      // Back to "follow the browser".
      expect((await inject('PATCH', '/api/me/preferences', { language: null })).json()).toEqual({ language: null, units: 'imperial' });
    });

    it('reject values that are not a language tag or a unit system', async () => {
      for (const body of [{ language: 'Deutsch' }, { units: 'nautical' }]) {
        const response = await inject('PATCH', '/api/me/preferences', body);
        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe('invalid_input');
      }
    });
  });

  describe('error codes', () => {
    it('come with every refusal, next to an English text', async () => {
      const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/dives' });
      expect(anonymous.json()).toEqual({ code: 'sign_in_required', error: PROBLEMS.sign_in_required });
      expect((await inject('GET', '/api/users')).json().code).toBe('admins_only');
      expect((await inject('GET', '/api/dives/00000000-0000-7000-8000-000000000000')).json().code).toBe('dive_not_found');
      expect((await inject('GET', '/api/no-such-route')).json().code).toBe('not_found');
      expect((await inject('POST', '/api/invitations/lookup', { token: 'x'.repeat(43) })).json().code).toBe('invitation_invalid');
    });

    it('keep the explanation of invalid input', async () => {
      const response = await inject('PATCH', '/api/me/preferences', { units: 'nautical' });
      expect(response.json().error).toMatch(/units/);
    });

    it('answer missing files with a 404, and page paths with the web client', async () => {
      const webDir = join(t.dataDir, 'web');
      await mkdir(join(webDir, 'assets'), { recursive: true });
      await writeFile(join(webDir, 'index.html'), '<!doctype html><title>Dive Hub</title>');
      const withWeb = await createTestApp(t, { webDir });
      const page = await withWeb.app.inject({ method: 'GET', url: '/account' });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
      const oldAsset = await withWeb.app.inject({ method: 'GET', url: '/assets/index-old.js' });
      expect(oldAsset.statusCode).toBe(404);
      expect(oldAsset.json().code).toBe('not_found');
      await withWeb.app.close();
    });

    it('tell why a file was not imported', async () => {
      const { payload, headers } = multipartFile('notes.txt', new TextEncoder().encode('just text, no dive'));
      const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
      await ctx.imports.processImport(created.json().id).catch(() => {});
      const view = (await inject('GET', `/api/imports/${created.json().id}`)).json();
      expect(view).toMatchObject({ status: 'failed', errorCode: 'unsupported_file' });
      expect(view).not.toHaveProperty('error');
    });

    it('tell why one file of an archive failed by its code only, never the parser’s own words (client contract §6)', async () => {
      const broken = makeSyntheticDive({ serialNumber: 7001 }).slice(0, 60);
      const zip = await zipOf({ 'good.fit': makeSyntheticDive({ serialNumber: 7002 }), 'broken.fit': broken });
      const { payload, headers } = multipartFile('export.zip', zip);
      const created = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
      await ctx.imports.processImport(created.json().id);
      const view = (await inject('GET', `/api/imports/${created.json().id}`)).json() as { outcome: Record<string, unknown>[] };
      const failed = view.outcome.find((o) => o.fileName === 'broken.fit');
      expect(failed).toEqual({ fileName: 'broken.fit', result: 'failed', reason: 'file_failed' });
      expect(view.outcome.find((o) => o.fileName === 'good.fit')).toMatchObject({ result: 'created' });
    });
  });
});

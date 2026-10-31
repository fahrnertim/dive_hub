// Every route under /api needs a session, except the short public list below: each plugin adds requireUser itself,
// so this test lists every registered route and fails when one is neither guarded nor public.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, createTestDatabase, databaseReachable, type TestDatabase } from './support.js';

const routes = vi.hoisted(() => [] as { method: string; url: string }[]);

// buildApp creates its own Fastify instance; wrap the factory to see every route it registers.
vi.mock('fastify', async (importOriginal) => {
  const real = await importOriginal<typeof import('fastify')>();
  const create = ((options?: Parameters<typeof real.default>[0]) => {
    const app = real.default(options);
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) routes.push({ method, url: route.url });
    });
    return app;
  }) as typeof real.default;
  return { ...real, default: create };
});

/** The routes anyone may call: health, the API description, sign-in, first-admin setup, invitations, password resets. */
const PUBLIC = new Set([
  'GET /api/health/live', 'GET /api/health/ready', 'GET /api/openapi.json',
  'GET /api/auth/*', 'POST /api/auth/*',
  'GET /api/setup', 'POST /api/setup',
  'POST /api/invitations/lookup', 'POST /api/invitations/accept',
  'POST /api/password-resets/lookup', 'POST /api/password-resets/complete',
]);
/** Not under /api and not behind a session: the MCP endpoint authenticates by an AI access's key (ADR 0035). */
const OWN_AUTH = new Set(['GET /mcp', 'POST /mcp', 'DELETE /mcp']);

const online = await databaseReachable();

describe.skipIf(!online)('route guards', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  // HEAD routes are Fastify's copies of the GET routes, with the same hooks.
  const listed = () => routes.filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS').map((r) => `${r.method} ${r.url}`);
  const inject = (key: string) => {
    const [method, url] = key.split(' ') as [string, string];
    const path = url.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000').replace('*', 'x');
    return ctx.app.inject({ method: method as 'GET', url: path });
  };

  it('registers every route under /api, or one with its own authentication', () => {
    expect(listed().length).toBeGreaterThan(PUBLIC.size);
    expect(listed().filter((key) => !key.split(' ')[1]!.startsWith('/api/') && !OWN_AUTH.has(key))).toEqual([]);
  });

  it('answers 401 without a session on every route not on the public list', async () => {
    const open: string[] = [];
    for (const key of listed().filter((k) => k.split(' ')[1]!.startsWith('/api/') && !PUBLIC.has(k))) {
      if ((await inject(key)).statusCode !== 401) open.push(key);
    }
    expect(open).toEqual([]);
  });

  it('keeps the public list to routes that exist and need no session', async () => {
    const guarded: string[] = [];
    for (const key of PUBLIC) {
      expect(listed()).toContain(key);
      if ((await inject(key)).statusCode === 401) guarded.push(key);
    }
    expect(guarded).toEqual([]);
  });
});

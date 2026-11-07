// Live hints (ADR 0066): a transaction emits a NOTIFY that reaches exactly the users in its audience, a rolled-back
// transaction emits nothing, the stream carries hints only, and losing LISTEN closes the streams so clients resync.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitHint } from '../src/live/emit.js';
import { createHub } from '../src/live/hub.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type Stream = { events: Record<string, unknown>[]; close: () => void; closed: Promise<void> };

async function openStream(base: string, cookie: string): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/live`, { headers: { cookie, origin: BASE_URL }, signal: controller.signal });
  if (response.status !== 200) throw new Error(`stream refused: ${response.status} ${await response.text()}`);
  const events: Record<string, unknown>[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const closed = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end = buffer.indexOf('\n\n');
        while (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame.split('\n').find((line) => line.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)) as Record<string, unknown>);
          end = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // aborted by the test
    } finally {
      // aborted or ended
    }
  })();
  return {
    events,
    close: () => controller.abort(),
    closed: closed.then(() => undefined),
  };
}

async function until(stream: Stream, predicate: (event: Record<string, unknown>) => boolean, timeoutMs = 2_000): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    const found = stream.events.find(predicate);
    if (found) return found;
    if (Date.now() - started > timeoutMs) throw new Error(`no matching hint within ${timeoutMs} ms; got ${JSON.stringify(stream.events)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settle = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!(await databaseReachable()))('live hints', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let base: string;
  let tim: string;
  let other: string;
  let timId: string;
  let diveId: string;
  const streams: Stream[] = [];

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    const timUser = await createUser(ctx.auth, 'tim@example.com');
    timId = timUser.id;
    await createUser(ctx.auth, 'other@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    other = await signIn(ctx.app, 'other@example.com');
    const { payload, headers } = multipartFile('main.fit', makeSyntheticDive({ serialNumber: 111 }));
    const uploaded = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie: tim } });
    await ctx.imports.processImport(uploaded.json().id);
    const imported = await ctx.app.inject({ method: 'GET', url: `/api/imports/${uploaded.json().id}`, headers: { cookie: tim } });
    diveId = (imported.json() as { outcome: { diveId: string }[] }).outcome[0]!.diveId;
    ctx.live.start();
    await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const stream of streams) stream.close();
    await ctx.live.stop();
    await ctx.app.close();
    await t.drop();
  });

  it('delivers a hint only to its audience, and only once the transaction commits', async () => {
    const timStream = await openStream(base, tim);
    const otherStream = await openStream(base, other);
    streams.push(timStream, otherStream);
    // The stream's opening frame has arrived; the LISTEN connection was up before both (started in beforeAll).
    await settle(300);

    const id = randomUUID();
    await t.db.transaction(async (tx) => {
      await emitHint(tx, { kind: 'import', id, audience: [timId] });
      // Not visible to anyone while the transaction is open.
      await settle(150);
    });
    const hint = await until(timStream, (event) => event.id === id);
    expect(hint).toEqual({ v: 1, kind: 'import', id });
    await settle();
    expect(otherStream.events.some((event) => event.id === id)).toBe(false);
  });

  it('emits nothing when the writing transaction rolls back', async () => {
    const stream = await openStream(base, tim);
    streams.push(stream);
    await settle(300);
    const id = randomUUID();
    await expect(t.db.transaction(async (tx) => {
      await emitHint(tx, { kind: 'import', id, audience: [timId] });
      throw new Error('rolled back on purpose');
    })).rejects.toThrow('rolled back on purpose');
    await settle();
    expect(stream.events.some((event) => event.id === id)).toBe(false);
  });

  it('turns a Dive written through the API into a dive hint (any origin)', async () => {
    const stream = await openStream(base, tim);
    streams.push(stream);
    await settle(300);
    const view = await ctx.app.inject({ method: 'GET', url: `/api/dives/${diveId}`, headers: { cookie: tim } });
    const response = await ctx.app.inject({
      method: 'PATCH', url: `/api/dives/${diveId}`, headers: { cookie: tim, origin: BASE_URL },
      payload: { version: (view.json() as { version: number }).version, notes: 'edited elsewhere' },
    });
    expect(response.statusCode).toBe(200);
    const hint = await until(stream, (event) => event.kind === 'dive');
    expect(hint).toEqual({ v: 1, kind: 'dive', id: diveId });
  });

  it('closes every stream when the LISTEN connection goes away, forcing a resync', async () => {
    const stream = await openStream(base, tim);
    streams.push(stream);
    await settle(300);
    await ctx.live.stop();
    await expect(stream.closed).resolves.toBeUndefined();
  });

  it('caps a user\'s streams and heartbeats the open ones', async () => {
    const hub = createHub({ perUser: 2, heartbeatMs: 20 });
    const writes: string[] = [];
    const socket = () => ({ write: (text: string) => { writes.push(text); return true; }, end: () => undefined } as never);
    expect(hub.add('user-1', socket())).toBe(true);
    expect(hub.add('user-1', socket())).toBe(true);
    expect(hub.add('user-1', socket())).toBe(false);
    hub.startHeartbeat();
    await settle(60);
    hub.stop();
    expect(writes).toContain(':hb\n\n');
    hub.closeAll();
  });
});

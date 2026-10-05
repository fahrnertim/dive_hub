// How often the SSI adapter reads the whole logbook (ADR 0027): at most once per action, and a read-back of the last
// two minutes serves the next action's duplicate check and dive number. Updates and deletes always read afresh.
import { describe, expect, it } from 'vitest';
import type { OutgoingDive } from '../src/providers/provider.js';
import en from '../../web/src/i18n/locales/en.json' with { type: 'json' };
import { createSsiAdapter, SSI_CAPABILITIES, type SsiCallLog } from '../src/providers/ssi/ssi-adapter.js';
import { createSsiClient } from '../src/providers/ssi/ssi-client.js';
import { createFakeSsi } from './fake-ssi.js';

const dive = (start: string): OutgoingDive => ({
  startsAt: new Date(start), utcOffsetSeconds: 0, durationSeconds: 1800, maxDepthM: 12, avgDepthM: 8, waterTemperatureC: 20,
  maxTemperatureC: 22, waterType: 'salt', notes: null, siteIds: { ssi: '3314' }, participants: [], entry: null, exit: null, gases: [],
  gfLow: null, gfHigh: null, cnsStart: null, cnsEnd: null, device: null, samples: {},
});

async function setUp() {
  const fake = createFakeSsi();
  let now = 0;
  const adapter = createSsiAdapter({
    client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fake.fetch, userAgent: 'DiveHub (test)' }),
    now: () => now,
  });
  const { account, access } = await adapter.signIn({ kind: 'password', login: 'erika@example.com', password: 'ssi-password' });
  const ctx = { connectionId: 'c1', accountId: account.id, access };
  const reads = () => fake.calls.filter((c) => c.what === 'get_divelog').length;
  return { fake, adapter, ctx, reads, wait: (ms: number) => { now += ms; } };
}

describe('the SSI adapter\'s logbook reads', () => {
  it('reads once before and once after a create, and the read-back serves the next create', async () => {
    const { adapter, ctx, reads } = await setUp();
    const first = adapter.dives!.open(ctx);
    expect(await first.find!(dive('2026-01-15T09:00:00Z'), 'divehub-1')).toEqual({ ours: null, sameTime: null });
    await first.create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    expect(reads()).toBe(2);
    const second = adapter.dives!.open(ctx);
    await second.find!(dive('2026-01-16T09:00:00Z'), 'divehub-2');
    expect((await second.create(dive('2026-01-16T09:00:00Z'), 'divehub-2')).remoteNumber).toBe(2);
    // Two dives sent in a row: three reads instead of four.
    expect(reads()).toBe(3);
  });

  it('reads again once the kept read-back is two minutes old', async () => {
    const { adapter, ctx, reads, wait } = await setUp();
    await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    wait(2 * 60_000);
    await adapter.dives!.open(ctx).find!(dive('2026-01-16T09:00:00Z'), 'divehub-2');
    expect(reads()).toBe(3);
  });

  it('always reads afresh to update or delete, since it writes SSI\'s record back', async () => {
    const { fake, adapter, ctx, reads } = await setUp();
    const { remoteId } = await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    fake.dives.get(Number(remoteId))!.odin_user_log_rating = 5;
    const before = reads();
    const updated = await adapter.dives!.open(ctx).update!(remoteId!, { ...dive('2026-01-15T09:00:00Z'), notes: 'Turtle' }, null);
    expect(updated?.remoteId).toBe(remoteId);
    expect(fake.dives.get(Number(remoteId))).toMatchObject({ odin_user_log_rating: 5, odin_user_log_comment: 'Turtle' });
    expect(reads()).toBe(before + 2);
    expect(await adapter.dives!.open(ctx).remove!(remoteId!)).toBe('deleted');
    expect(reads()).toBe(before + 3);
    // The deleted dive is gone from what is kept, too.
    expect((await adapter.dives!.open(ctx).find!(dive('2026-01-15T09:00:00Z'), 'divehub-1')).ours).toBeNull();
    expect(reads()).toBe(before + 3);
  });
});

describe('the SSI adapter\'s call log', () => {
  it('reports every call to SSI with its Connection and outcome, never the token or password', async () => {
    const fake = createFakeSsi();
    const calls: SsiCallLog[] = [];
    const adapter = createSsiAdapter({
      client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fake.fetch, userAgent: 'DiveHub (test)' }),
      onCall: (c) => calls.push(c),
    });
    const { account, access } = await adapter.signIn({ kind: 'password', login: 'erika@example.com', password: 'ssi-password' });
    const ctx = { connectionId: 'c1', accountId: account.id, access };
    await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    await expect(adapter.signIn({ kind: 'password', login: 'erika@example.com', password: 'wrong' })).rejects.toThrow();

    expect(calls.map(({ call, connectionId, outcome }) => ({ call, connectionId, outcome }))).toEqual([
      { call: 'authenticate', connectionId: null, outcome: 'ok' },
      { call: 'get_divelog', connectionId: 'c1', outcome: 'ok' },
      { call: 'save_divelog', connectionId: 'c1', outcome: 'ok' },
      { call: 'get_divelog', connectionId: 'c1', outcome: 'ok' },
      { call: 'authenticate', connectionId: null, outcome: 'wrong_credentials' },
    ]);
    for (const c of calls) expect(c.ms).toBeGreaterThanOrEqual(0);
    const logged = JSON.stringify(calls);
    expect(logged).not.toContain(access);
    expect(logged).not.toContain('ssi-password');
  });
});

describe('the SSI adapter\'s read-back fields', () => {
  it('each have a text in the web client (they are no enum the translation test could read)', () => {
    for (const field of SSI_CAPABILITIES.data.dives!.export!.readBackFields!) expect(Object.keys(en.provider.field)).toContain(field);
  });
});

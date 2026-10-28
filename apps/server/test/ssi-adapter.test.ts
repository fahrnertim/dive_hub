// How often the SSI adapter reads the whole logbook (ADR 0027): at most once per action, and a read of the last two
// minutes serves the next action's duplicate check and dive number. Updates and deletes always read afresh. SSI's save
// answer is the read-back; only an answer without a usable record is decided by one more read (ADR 0057, piece 7).
import { describe, expect, it } from 'vitest';
import { DIVE_FIELDS, type OutgoingDive } from '../src/providers/provider.js';
import en from '../../web/src/i18n/locales/en.json' with { type: 'json' };
import { createSsiAdapter, SSI_CAPABILITIES, type SsiCallLog } from '../src/providers/ssi/ssi-adapter.js';
import { createSsiClient, type Fetch } from '../src/providers/ssi/ssi-client.js';
import { createFakeSsi } from './fake-ssi.js';

const dive = (start: string): OutgoingDive => ({
  startsAt: new Date(start), utcOffsetSeconds: 0, durationSeconds: 1800, maxDepthM: 12, avgDepthM: 8, waterTemperatureC: 20,
  maxTemperatureC: 22, waterType: 'salt', notes: null, siteIds: { ssi: '3314' }, participants: [], entry: null, exit: null, gases: [],
  gfLow: null, gfHigh: null, cnsStart: null, cnsEnd: null, device: null, samples: {},
  cylinder: null, leadKg: null, diveMode: null, surfaceIntervalSeconds: null, avgHeartRate: null,
});

async function setUp() {
  const fake = createFakeSsi();
  let now = 0;
  const logged: SsiCallLog[] = [];
  const adapter = createSsiAdapter({
    client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fake.fetch }),
    now: () => now,
    onCall: (c) => logged.push(c),
  });
  const { account, access } = await adapter.signIn({ kind: 'password', login: 'erika@example.com', password: 'ssi-password' });
  const ctx = { connectionId: 'c1', accountId: account.id, access };
  const reads = () => fake.calls.filter((c) => c.what === 'get_divelog').length;
  return { fake, adapter, ctx, reads, logged, wait: (ms: number) => { now += ms; } };
}

describe('the SSI adapter\'s logbook reads', () => {
  it('reads once to create, and the answer serves the next create', async () => {
    const { adapter, ctx, reads } = await setUp();
    const first = adapter.dives!.open(ctx);
    expect(await first.find!(dive('2026-01-15T09:00:00Z'), 'divehub-1')).toEqual({ ours: null, sameTime: null });
    expect((await first.create(dive('2026-01-15T09:00:00Z'), 'divehub-1')).differences).toEqual([]);
    expect(reads()).toBe(1);
    const second = adapter.dives!.open(ctx);
    // The first dive is in what is kept: the second one finds it and takes the next number.
    expect((await second.find!(dive('2026-01-15T09:00:00Z'), 'divehub-1')).ours).not.toBeNull();
    expect((await second.create(dive('2026-01-16T09:00:00Z'), 'divehub-2')).remoteNumber).toBe(2);
    // Two dives sent in a row: one read instead of four.
    expect(reads()).toBe(1);
  });

  it('falls back to one read when the answer has no record, and the dive counts as sent', async () => {
    const { fake, adapter, ctx, reads, logged } = await setUp();
    fake.answerRecord = () => null;
    const sent = await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    expect(fake.dives.has(Number(sent.remoteId))).toBe(true);
    expect(sent.differences).toEqual([]);
    expect(reads()).toBe(2);
    expect(logged.filter((c) => c.call === 'get_divelog')[1]?.detail).toContain('no record');
  });

  it('a record with fewer samples than sent is decided by a read', async () => {
    const { fake, adapter, ctx, reads } = await setUp();
    fake.answerRecord = (r) => ({ ...r, odin_user_log_diveSamples: '[]' });
    const profiled = { ...dive('2026-01-15T09:00:00Z'), samples: { depth: { offsetsMs: [0, 60_000, 120_000], values: [0, 10, 0] } } };
    const sent = await adapter.dives!.open(ctx).create(profiled, 'divehub-1');
    expect(reads()).toBe(2);
    // Compared against the logbook's record, not the cut one.
    expect(sent.differences).toEqual([]);
  });

  it('a record with another reference is decided by a read', async () => {
    const { fake, adapter, ctx, reads } = await setUp();
    fake.answerRecord = (r) => ({ ...r, odin_user_log_divecomputer_dive_ref: 'other' });
    await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    expect(reads()).toBe(2);
  });

  it('reads again once the kept read-back is two minutes old', async () => {
    const { adapter, ctx, reads, wait } = await setUp();
    await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    wait(2 * 60_000);
    await adapter.dives!.open(ctx).find!(dive('2026-01-16T09:00:00Z'), 'divehub-2');
    expect(reads()).toBe(2);
  });

  it('always reads afresh to update or delete, since it writes SSI\'s record back', async () => {
    const { fake, adapter, ctx, reads } = await setUp();
    const { remoteId } = await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    fake.dives.get(Number(remoteId))!.odin_user_log_rating = 5;
    const before = reads();
    const updated = await adapter.dives!.open(ctx).update!(remoteId!, { ...dive('2026-01-15T09:00:00Z'), notes: 'Turtle' }, null);
    expect(updated?.remoteId).toBe(remoteId);
    expect(fake.dives.get(Number(remoteId))).toMatchObject({ odin_user_log_rating: 5, odin_user_log_comment: 'Turtle' });
    expect(reads()).toBe(before + 1);
    expect(await adapter.dives!.open(ctx).remove!(remoteId!)).toBe('deleted');
    expect(reads()).toBe(before + 2);
    // The deleted dive is gone from what is kept, too.
    expect((await adapter.dives!.open(ctx).find!(dive('2026-01-15T09:00:00Z'), 'divehub-1')).ours).toBeNull();
    expect(reads()).toBe(before + 2);
  });
});

describe('the SSI adapter reading the current record', () => {
  it("current answers SSI's record as an ImportedDive from the same read the update uses", async () => {
    const { fake, adapter, ctx, reads } = await setUp();
    const { remoteId } = await adapter.dives!.open(ctx).create({ ...dive('2026-01-15T09:00:00Z'), notes: 'Ours' }, 'divehub-1');
    fake.dives.get(Number(remoteId))!.odin_user_log_comment = 'From the app';
    const before = reads();
    const action = adapter.dives!.open(ctx);
    const current = await action.current!(remoteId!);
    expect(current?.dive).toMatchObject({ remoteId, maxDepthM: 12 });
    expect(current?.dive.localStart).toContain('2026-01-15 09:00');
    expect(current?.record.odin_user_log_comment).toBe('From the app');
    expect(current?.context).toHaveProperty('sites');
    await action.update!(remoteId!, dive('2026-01-15T09:00:00Z'), null, null, { keep: ['notes'], clear: [] });
    // One read for current and update together, none after the save.
    expect(reads()).toBe(before + 1);
    expect(fake.dives.get(Number(remoteId))!.odin_user_log_comment).toBe('From the app');
    expect(await adapter.dives!.open(ctx).current!('999999')).toBeNull();
  });

  it("an update that keeps the buddies sends the Provider's buddy IDs unchanged", async () => {
    const { fake, adapter, ctx } = await setUp();
    const { remoteId } = await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    fake.dives.get(Number(remoteId))!.odin_user_log_buddy_ids = [41, 42];
    await adapter.dives!.open(ctx).update!(remoteId!, dive('2026-01-15T09:00:00Z'), { odin_user_log_buddy_ids: [41] }, null, { keep: ['buddies'], clear: [] });
    expect(fake.dives.get(Number(remoteId))!.odin_user_log_buddy_ids).toEqual([41, 42]);
  });

  it('an update that clears the buddies removes every buddy at SSI, also those Dive Hub never sent', async () => {
    const { fake, adapter, ctx } = await setUp();
    const { remoteId } = await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    fake.dives.get(Number(remoteId))!.odin_user_log_buddy_ids = [41, 42];
    await adapter.dives!.open(ctx).update!(remoteId!, dive('2026-01-15T09:00:00Z'), null, null, { keep: [], clear: ['buddies'] });
    expect(fake.dives.get(Number(remoteId))!.odin_user_log_buddy_ids).toEqual([]);
  });
});

describe('the SSI adapter\'s call log', () => {
  it('reports every call to SSI with its Connection and outcome, never the token or password', async () => {
    const fake = createFakeSsi();
    const calls: SsiCallLog[] = [];
    const adapter = createSsiAdapter({
      client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fake.fetch }),
      onCall: (c) => calls.push(c),
    });
    const { account, access } = await adapter.signIn({ kind: 'password', login: 'erika@example.com', password: 'ssi-password' });
    const ctx = { connectionId: 'c1', accountId: account.id, access };
    await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    await expect(adapter.signIn({ kind: 'password', login: 'erika@example.com', password: 'wrong' })).rejects.toThrow();

    expect(calls.map(({ call, connectionId, outcome }) => ({ call, connectionId, outcome }))).toEqual([
      { call: 'authenticate', connectionId: null, outcome: 'ok' },
      { call: 'get_divelog', connectionId: 'c1', outcome: 'ok' },
      { call: 'get_buddies', connectionId: 'c1', outcome: 'ok' },
      { call: 'save_divelog', connectionId: 'c1', outcome: 'ok' },
      { call: 'authenticate', connectionId: null, outcome: 'wrong_credentials' },
    ]);
    for (const c of calls) expect(c.ms).toBeGreaterThanOrEqual(0);
    const logged = JSON.stringify(calls);
    expect(logged).not.toContain(access);
    expect(logged).not.toContain('ssi-password');
  });
});

describe('the SSI adapter and SSI\'s maintenance', () => {
  it('maps a 503 to unavailable for the generic layer and logs it as maintenance', async () => {
    const fake = createFakeSsi();
    const logged: SsiCallLog[] = [];
    const adapter = createSsiAdapter({
      client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fake.fetch }),
      onCall: (c) => logged.push(c),
    });
    const { account, access } = await adapter.signIn({ kind: 'password', login: 'erika@example.com', password: 'ssi-password' });
    fake.failWith = 503;
    await expect(adapter.certifications!.find({ connectionId: 'c1', accountId: account.id, access })).rejects.toMatchObject({ reason: 'unavailable' });
    expect(logged.at(-1)).toMatchObject({ call: 'get_ccards', outcome: 'maintenance' });
  });
});

describe('the SSI adapter and a save SSI drops', () => {
  it('refuses a create that is not in the logbook afterwards, and an update SSI answers with another dive: neither is a sent dive', async () => {
    const fake = createFakeSsi();
    let agent: string | null = null;
    // As another client than SSI's app, for which SSI answers a save and stores nothing.
    const fetch: Fetch = (url, init) => fake.fetch(url, agent ? { ...init, headers: { ...init.headers, 'User-Agent': agent } } : init);
    const adapter = createSsiAdapter({ client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch }) });
    const { account, access } = await adapter.signIn({ kind: 'password', login: 'erika@example.com', password: 'ssi-password' });
    const ctx = { connectionId: 'c1', accountId: account.id, access };
    const { remoteId } = await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    agent = 'DiveHub (+https://example.org)';
    await expect(adapter.dives!.open(ctx).create(dive('2026-01-16T09:00:00Z'), 'divehub-2')).rejects.toMatchObject({ reason: 'not_stored' });
    await expect(adapter.dives!.open(ctx).update!(remoteId!, { ...dive('2026-01-15T09:00:00Z'), notes: 'changed' }, null)).rejects.toMatchObject({ reason: 'not_stored' });
    expect(fake.dives.size).toBe(1);
  });
});

describe('the SSI adapter and dive numbers (ADR 0048)', () => {
  const numberAt = (fake: ReturnType<typeof createFakeSsi>, remoteId: string | null) => fake.dives.get(Number(remoteId))!.odin_user_log_nr;

  it('declares that a client sets the number on a create and on an update', () => {
    expect(SSI_CAPABILITIES.data.dives!.export!.numbers).toEqual({ set: ['create', 'update'], changeRemovesVerification: true });
  });

  it('sets the number with an update, and leaves it alone without one or when another dive has it', async () => {
    const { fake, adapter, ctx } = await setUp();
    const a = await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    const b = await adapter.dives!.open(ctx).create(dive('2026-01-16T09:00:00Z'), 'divehub-2');
    const changed = { ...dive('2026-01-16T09:00:00Z'), notes: 'Turtle' };

    expect((await adapter.dives!.open(ctx).update!(b.remoteId!, changed, null))!.remoteNumber).toBe(2);
    expect((await adapter.dives!.open(ctx).update!(b.remoteId!, changed, null, 7))!.remoteNumber).toBe(7);
    expect(numberAt(fake, b.remoteId)).toBe(7);
    // SSI itself would take a number twice (the owner's check, 2026-10-10): Dive Hub doesn't send it.
    expect((await adapter.dives!.open(ctx).update!(b.remoteId!, changed, null, 1))!.remoteNumber).toBe(7);
    expect(numberAt(fake, b.remoteId)).toBe(7);
    expect(numberAt(fake, a.remoteId)).toBe(1);
    // Its own number is not "taken".
    expect((await adapter.dives!.open(ctx).update!(b.remoteId!, changed, null, 7))!.remoteNumber).toBe(7);
  });

  it('"Set number" changes only the number, names the dive that holds a taken one, and answers null for a dive that is gone', async () => {
    const { fake, adapter, ctx } = await setUp();
    const a = await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    const b = await adapter.dives!.open(ctx).create(dive('2026-01-16T09:00:00Z'), 'divehub-2');
    fake.dives.get(Number(b.remoteId))!.odin_user_log_comment = 'Written in the app';

    expect(await adapter.dives!.open(ctx).setNumber!(b.remoteId!, 12)).toEqual({ result: 'set', remoteNumber: 12 });
    expect(fake.dives.get(Number(b.remoteId))).toMatchObject({ odin_user_log_nr: 12, odin_user_log_comment: 'Written in the app' });

    const saves = fake.calls.filter((c) => c.what === 'save_divelog').length;
    expect(await adapter.dives!.open(ctx).setNumber!(b.remoteId!, 1)).toMatchObject({ result: 'taken', by: { remoteId: a.remoteId, number: 1 } });
    expect(fake.calls.filter((c) => c.what === 'save_divelog').length).toBe(saves);
    expect(numberAt(fake, b.remoteId)).toBe(12);

    expect(await adapter.dives!.open(ctx).setNumber!('999', 3)).toBeNull();
  });

  it('"Set number" takes the answer\'s record and reads only when it shows another number', async () => {
    const { fake, adapter, ctx, reads } = await setUp();
    await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    const b = await adapter.dives!.open(ctx).create(dive('2026-01-16T09:00:00Z'), 'divehub-2');
    let before = reads();
    expect(await adapter.dives!.open(ctx).setNumber!(b.remoteId!, 12)).toEqual({ result: 'set', remoteNumber: 12 });
    expect(reads()).toBe(before + 1);
    fake.answerRecord = (r) => ({ ...r, odin_user_log_nr: 3 });
    before = reads();
    expect(await adapter.dives!.open(ctx).setNumber!(b.remoteId!, 13)).toEqual({ result: 'set', remoteNumber: 13 });
    expect(reads()).toBe(before + 2);
  });

  it('refuses a "Set number" SSI answers and does not store', async () => {
    const { fake, adapter, ctx } = await setUp();
    const a = await adapter.dives!.open(ctx).create(dive('2026-01-15T09:00:00Z'), 'divehub-1');
    fake.dropSaves = true;
    await expect(adapter.dives!.open(ctx).setNumber!(a.remoteId!, 5)).rejects.toMatchObject({ reason: 'not_stored' });
    expect(numberAt(fake, a.remoteId)).toBe(1);
  });
});

describe('the SSI adapter\'s dive fields', () => {
  it('declares every dive value both ways', () => {
    const fields = SSI_CAPABILITIES.data.dives!.fields!;
    expect(Object.keys(fields).sort()).toEqual([...DIVE_FIELDS].sort());
    for (const field of DIVE_FIELDS) expect(fields[field]).toEqual(['import', 'export']);
  });
});

describe('the SSI adapter\'s read-back fields', () => {
  it('each have a text in the web client (they are no enum the translation test could read)', () => {
    for (const field of SSI_CAPABILITIES.data.dives!.export!.readBackFields!) expect(Object.keys(en.provider.field)).toContain(field);
  });
});

// SSI's buddy list (piece 5): `get_buddies` and `save_buddy` through the adapter, against the fake SSI. The bodies sent
// are those of docs/research/2026-10-27-ssi-buddy-checks.md (the app's whole row from scratch; only the account for a
// person with an SSI account).
import { describe, expect, it } from 'vitest';
import { createSsiAdapter, SSI_CAPABILITIES } from '../src/providers/ssi/ssi-adapter.js';
import { BUDDY_KEYS } from '../src/providers/ssi/ssi-buddy-row.js';
import { createSsiClient } from '../src/providers/ssi/ssi-client.js';
import { createFakeSsi, type FakeSsiBuddy } from './fake-ssi.js';

const ERIKA = 5_012_047;
const URL_ = 'https://ssi.invalid/app/a21.php';

const entry = (id: number, account: number, extra: Partial<FakeSsiBuddy> = {}): FakeSsiBuddy => ({
  owner: ERIKA, id, buddy_master_id: account, firstname: `First${id}`, lastname: `Last${id}`,
  email: '', dob: '1980-01-02', phone: '', city: '', ...extra,
});

async function setUp(buddies: FakeSsiBuddy[]) {
  const fake = createFakeSsi({ buddies });
  const adapter = createSsiAdapter({ client: createSsiClient({ url: URL_, fetch: fake.fetch }) });
  const { account, access } = await adapter.signIn({ kind: 'password', login: 'erika@example.com', password: 'ssi-password' });
  return { fake, adapter, ctx: { connectionId: 'c1', accountId: account.id, access } };
}
const saved = (fake: ReturnType<typeof createFakeSsi>) => fake.calls.filter((c) => c.what === 'save_buddy').map((c) => c.body as Record<string, unknown>);

describe('SSI\'s buddy list through the adapter', () => {
  it('find reads get_buddies and skips deleted entries', async () => {
    const { adapter, ctx, fake } = await setUp([entry(1, 4_989_164), entry(2, 0), entry(3, 4_512_484, { deleted: 1 })]);
    const found = await adapter.buddies!.find(ctx);
    expect(found.map((b) => b.remoteId)).toEqual(['1', '2']);
    expect(found[1]!.account).toBeNull();
    expect(found[0]!.account).toBe('4989164');
    expect(found[0]).not.toHaveProperty('row');
    const calls = fake.calls.map((c) => c.what);
    expect(calls).toContain('get_buddies');
    expect(calls).not.toContain('get_divelog');
  });

  it('add with an account sends only id, master_id and the flags', async () => {
    const { adapter, ctx, fake } = await setUp([]);
    fake.profiles.set(4_989_164, { firstname: 'Kai', lastname: 'Lund' });
    const added = await adapter.buddies!.add!(ctx, { firstName: null, lastName: null, email: null, account: '4989164' });
    const [body] = saved(fake);
    expect(Object.keys(body!)).toEqual(['id', 'master_id', 'leader_active', 'deleted', 'needsUpload', 'confirmed', 'favorite']);
    expect(body).toMatchObject({ id: null, master_id: 4_989_164, needsUpload: 1, deleted: 0 });
    expect(added).toMatchObject({ name: 'Kai Lund', account: '4989164' });
  });

  it('add with an account of a person already in the list answers that entry', async () => {
    const { adapter, ctx, fake } = await setUp([entry(7, 4_989_164)]);
    const added = await adapter.buddies!.add!(ctx, { firstName: null, lastName: null, email: null, account: '4989164' });
    expect(added.remoteId).toBe('7');
    expect(fake.buddies).toHaveLength(1);
  });

  it('add from scratch sends the app\'s row with name and e-mail', async () => {
    const { adapter, ctx, fake } = await setUp([]);
    const added = await adapter.buddies!.add!(ctx, { firstName: 'Dive Hub', lastName: 'test', email: 'x@example.com', account: null });
    const [body] = saved(fake);
    expect(Object.keys(body!)).toEqual([...BUDDY_KEYS]);
    expect(body).toMatchObject({ id: null, firstname: 'Dive Hub', lastname: 'test', email: 'x@example.com', master_id: null, needsUpload: 1, deleted: 0 });
    expect(added).toMatchObject({ remoteId: String(fake.buddies[0]!.id), name: 'Dive Hub test', account: null });
  });

  it('setAccount saves the entry back with the account, and SSI\'s spelling of the name comes back', async () => {
    const { adapter, ctx, fake } = await setUp([entry(1, 4_989_164), entry(2, 0, { firstname: 'samuel', lastname: 'dreier', email: 's@example.com' })]);
    fake.profiles.set(4_512_484, { firstname: 'Samuel', lastname: 'Dreier' });
    const answer = await adapter.buddies!.setAccount!(ctx, '2', '4512484');
    expect(answer).toMatchObject({ remoteId: '2', account: '4512484', name: 'Samuel Dreier' });
    const [body] = saved(fake);
    expect(body).toMatchObject({ id: 2, master_id: 4_512_484, needsUpload: 1, email: 's@example.com' });
    expect(Object.keys(body!)).toEqual([...BUDDY_KEYS]);
    expect(fake.buddies).toHaveLength(2);
  });

  it('setAccount on an entry that is gone is not_found', async () => {
    const { adapter, ctx } = await setUp([entry(3, 0, { deleted: 1 })]);
    await expect(adapter.buddies!.setAccount!(ctx, '3', '4512484')).rejects.toMatchObject({ reason: 'not_found' });
    await expect(adapter.buddies!.setAccount!(ctx, '99', '4512484')).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('reads the list again after a save', async () => {
    const { adapter, ctx, fake } = await setUp([entry(1, 4_989_164)]);
    expect(await adapter.buddies!.find(ctx)).toHaveLength(1);
    await adapter.buddies!.add!(ctx, { firstName: 'A', lastName: 'B', email: null, account: null });
    expect(await adapter.buddies!.find(ctx)).toHaveLength(2);
    expect(fake.calls.filter((c) => c.what === 'get_buddies')).toHaveLength(2);
  });

  it('capabilities offer buddies export add and setAccount', () => {
    expect(SSI_CAPABILITIES.data.buddies).toEqual({ import: { operations: ['find'] }, export: { operations: ['add', 'setAccount'] } });
  });
});

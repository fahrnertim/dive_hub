// The lead service answers for a User who keeps the Diver's logbook and for nobody else (ADR 0053): the route passes ids only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { user } from '../src/db/schema.js';
import { createLeadService } from '../src/lead/service.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('lead service', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let lead: ReturnType<typeof createLeadService>;
  let annId: string;
  let otherId: string;
  let annDiver: string;

  const userIdOf = async (email: string) => (await t.db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;
  const plan = { water: 'salt' as const, suit: { type: 'none' as const, thicknessMm: null, hood: null, undergarment: null }, cylinders: [{ volumeL: 12, material: null }] };

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    lead = createLeadService(t.db);
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'other@example.com');
    annId = await userIdOf('ann@example.com');
    otherId = await userIdOf('other@example.com');
    const cookie = await signIn(ctx.app, 'ann@example.com');
    annDiver = ((await ctx.app.inject({ method: 'GET', url: '/api/divers', headers: { cookie, origin: BASE_URL } })).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
  });

  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('estimates for a Diver the User manages and says nothing for anyone else', async () => {
    const own = await lead.estimate(annId, annDiver, plan, 'kg');
    expect(own).toMatchObject({ estimate: { unit: 'kg' }, noWaterType: 0 });
    expect(await lead.estimate(otherId, annDiver, plan, 'kg')).toBeNull();
  });
});

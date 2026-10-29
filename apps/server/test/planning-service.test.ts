// The planning service looks up the Divers a User manages itself (ADR 0053): the route passes only the User's id.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { user } from '../src/db/schema.js';
import { createPlanningService } from '../src/planning/planning-service.js';
import { PlanningError } from '../src/planning/service.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('planning service', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let planning: ReturnType<typeof createPlanningService>;
  let annId: string;
  let otherId: string;
  let annDiver: string;

  const userIdOf = async (email: string) => (await t.db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;
  const levels = [{ depth: 20, minutes: 30 }];

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    planning = createPlanningService(t.db);
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

  it('plans a bottom time for a Diver the User manages and says diver_not_found for anyone else', async () => {
    const own = await planning.bottomTime(annId, { depth: 20, o2: 32, diverId: annDiver });
    expect(own).toMatchObject({ status: 'ok' });
    await expect(planning.bottomTime(otherId, { depth: 20, o2: 32, diverId: annDiver })).rejects.toThrow(new PlanningError('diver_not_found'));
  });

  it('plans a gas plan, reading a Diver only where the User manages them', async () => {
    const divers = [{ name: 'Ann', diverId: annDiver, volume: 12, pressure: 200 }];
    const own = await planning.gasPlan(annId, { o2: 32, levels, divers });
    const other = await planning.gasPlan(otherId, { o2: 32, levels, divers });
    expect(own).toMatchObject({ status: 'ok' });
    expect(other).toMatchObject({ status: 'ok' });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(own));
  });
});

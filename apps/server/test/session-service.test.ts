// The session service lists and ends a User's own signed-in sessions (ADR 0053).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { session, user } from '../src/db/schema.js';
import { createSessionService } from '../src/users/session-service.js';
import { createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('session service', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let sessions: ReturnType<typeof createSessionService>;
  let annId: string;
  let bobId: string;

  const idOf = async (email: string) =>
    (await t.db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    sessions = createSessionService(t.db);
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'bob@example.com');
    annId = await idOf('ann@example.com');
    bobId = await idOf('bob@example.com');
    await signIn(ctx.app, 'ann@example.com');
    await signIn(ctx.app, 'ann@example.com');
    await signIn(ctx.app, 'bob@example.com');
  });

  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('lists only the own sessions, marking the current one and never showing the token', async () => {
    const mine = await sessions.list(annId, undefined);
    expect(mine).toHaveLength(2);
    expect(mine.every((s) => !('token' in s))).toBe(true);
    expect(mine.map((s) => s.current)).toEqual([false, false]);
    const current = await sessions.list(annId, mine[0]!.id);
    expect(current.filter((s) => s.current).map((s) => s.id)).toEqual([mine[0]!.id]);
  });

  it("does not end another User's session", async () => {
    const [bobs] = await sessions.list(bobId, undefined);
    expect(await sessions.end(annId, bobs!.id)).toBe(false);
    expect(await sessions.list(bobId, undefined)).toHaveLength(1);
  });

  it('ends every other session but keeps the current one', async () => {
    const [keep] = await sessions.list(annId, undefined);
    await sessions.endOthers(annId, keep!.id);
    expect((await sessions.list(annId, undefined)).map((s) => s.id)).toEqual([keep!.id]);
    expect(await sessions.list(bobId, undefined)).toHaveLength(1);
  });

  it('ends one own session', async () => {
    const [own] = await sessions.list(annId, undefined);
    expect(await sessions.end(annId, own!.id)).toBe(true);
    expect(await sessions.end(annId, own!.id)).toBe(false);
    expect(await t.db.select().from(session).where(eq(session.userId, annId))).toHaveLength(0);
  });
});

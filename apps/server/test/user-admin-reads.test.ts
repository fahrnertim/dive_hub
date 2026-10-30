// The user-admin service lists Users and checks a User can be handed a reset link (ADR 0053).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { user } from '../src/db/schema.js';
import { UserAdminError, createUserAdminService } from '../src/users/user-admin-service.js';
import { createTestApp, createTestDatabase, createUser, databaseReachable, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('user admin reads', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let admin: ReturnType<typeof createUserAdminService>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    admin = createUserAdminService(t.db, ctx.blobs);
    for (const name of ['first', 'second', 'blocked']) ids[name] = (await createUser(ctx.auth, `${name}@example.com`)).id;
    await t.db.update(user).set({ banned: true }).where(eq(user.id, ids.blocked!));
  });

  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('lists every User, oldest first', async () => {
    const all = await admin.list();
    expect(all.map((u) => u.email)).toEqual(['first@example.com', 'second@example.com', 'blocked@example.com']);
  });

  it('hands out a reset target only for an existing, enabled User', async () => {
    await expect(admin.assertCanReset(ids.first!)).resolves.toBeUndefined();
    await expect(admin.assertCanReset(randomUUID())).rejects.toMatchObject({ code: 'user_not_found' });
    await expect(admin.assertCanReset(ids.blocked!)).rejects.toBeInstanceOf(UserAdminError);
    await expect(admin.assertCanReset(ids.blocked!)).rejects.toMatchObject({ code: 'user_disabled' });
  });
});

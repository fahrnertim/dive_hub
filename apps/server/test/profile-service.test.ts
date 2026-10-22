// The profile service reads a User's own Diver and display preferences, and saves the preferences (ADR 0053).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { user } from '../src/db/schema.js';
import { createProfileService } from '../src/users/profile-service.js';
import { createTestApp, createTestDatabase, createUser, databaseReachable, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('profile service', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let profiles: ReturnType<typeof createProfileService>;
  let annId: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    profiles = createProfileService(t.db);
    await createUser(ctx.auth, 'ann@example.com');
    annId = (await t.db.select({ id: user.id }).from(user).where(eq(user.email, 'ann@example.com')))[0]!.id;
  });

  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('reads the own Diver and empty preferences of a new User', async () => {
    const me = await profiles.read(annId);
    expect(me.ownDiver).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    expect(me.preferences).toEqual({ language: null, units: null });
  });

  it('saves preferences, leaving fields not given as they are', async () => {
    expect(await profiles.savePreferences(annId, { language: 'de' })).toEqual({ language: 'de', units: null });
    expect(await profiles.savePreferences(annId, { units: 'imperial' })).toEqual({ language: 'de', units: 'imperial' });
    expect((await profiles.read(annId)).preferences).toEqual({ language: 'de', units: 'imperial' });
  });
});

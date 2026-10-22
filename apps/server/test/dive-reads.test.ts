// The reads behind a Dive's own routes (ADR 0053): who may see the Dive, the Dive before it, the deleted Dives and the history.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { cylinder, dive, diver, lead, participant, revision, user } from '../src/db/schema.js';
import { createLogbookService } from '../src/dives/logbook-service.js';
import { BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, signIn, type TestDatabase } from './support.js';

describe.skipIf(!(await databaseReachable()))('reads of one Dive', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let logbook: ReturnType<typeof createLogbookService>;
  let annId: string;
  let otherId: string;
  const id: Record<'first' | 'second' | 'gone', string> = { first: '', second: '', gone: '' };

  const userIdOf = async (email: string) => (await t.db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    logbook = createLogbookService(t.db);
    await createUser(ctx.auth, 'ann@example.com');
    await createUser(ctx.auth, 'other@example.com');
    annId = await userIdOf('ann@example.com');
    otherId = await userIdOf('other@example.com');
    const cookie = await signIn(ctx.app, 'ann@example.com');
    const diverId = ((await ctx.app.inject({ method: 'GET', url: '/api/divers', headers: { cookie, origin: BASE_URL } })).json() as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!.id;
    const otherDiverId = (await t.db.insert(diver).values({ name: 'Bo' }).returning({ id: diver.id }))[0]!.id;
    const make = async (day: number, extra: Partial<typeof dive.$inferInsert> = {}) =>
      (await t.db.insert(dive).values({ diverId, startsAt: new Date(Date.UTC(2026, 1, day, 10)), durationSeconds: 2400, maxDepthM: 20, ...extra }).returning({ id: dive.id }))[0]!.id;
    id.first = await make(1);
    id.second = await make(2);
    id.gone = await make(3, { deletedAt: new Date(Date.UTC(2026, 1, 4)) });
    await t.db.insert(cylinder).values({ diveId: id.first, position: 0, volumeL: 12, workingPressureBar: 232, material: 'steel' });
    await t.db.insert(lead).values({ diveId: id.first, position: 0, amountKg: 4 });
    await t.db.insert(participant).values({ diveId: id.first, diverId: otherDiverId, role: 'buddy' });
    await t.db.insert(revision).values([
      { entityType: 'dive', entityId: id.first, actorType: 'user', actorId: annId, cause: 'edit', changes: { notes: { from: null, to: 'x' } } },
      { entityType: 'dive', entityId: id.gone, actorType: 'system', actorId: 'merge', cause: 'merge', changes: { mergedInto: { from: null, to: id.second } } },
    ]);
  });

  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('finds a Dive only for a User who manages its Diver, and not once it is deleted', async () => {
    expect((await logbook.findManagedDive(annId, id.first))?.id).toBe(id.first);
    expect(await logbook.findManagedDive(otherId, id.first)).toBeUndefined();
    expect(await logbook.findManagedDive(annId, id.gone)).toBeUndefined();
  });

  it('finds the Dive before one of the same Diver, none before the first', async () => {
    const second = (await logbook.findManagedDive(annId, id.second))!;
    expect((await logbook.previousDive(second))?.id).toBe(id.first);
    expect(await logbook.previousDive((await logbook.findManagedDive(annId, id.first))!)).toBeUndefined();
  });

  it('gives the version of a Dive, deleted or not', async () => {
    expect(await logbook.versionOf(id.gone)).toBe(1);
    expect(await logbook.versionOf('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });

  it('lists the deleted Dives of the User with where each went', async () => {
    const deleted = await logbook.deletedDives(annId, 100);
    expect(deleted.map((r) => r.d.id)).toEqual([id.gone]);
    expect(deleted[0]).toMatchObject({ mergedInto: id.second, movedTo: null });
    expect(await logbook.deletedDives(otherId, 100)).toEqual([]);
  });

  it('gives the history of a Dive with who made each change', async () => {
    const history = await logbook.revisionsOfDive(id.first);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ r: { cause: 'edit' }, userName: expect.any(String), uploadName: null });
  });

  it('gives the Cylinders and Lead of a Dive, empty for one without', async () => {
    const parts = await logbook.partsOf(id.first);
    expect(parts.cylinders).toMatchObject([{ volumeL: 12, workingPressureBar: 232, material: 'steel' }]);
    expect(parts.lead).toEqual([{ amountKg: 4, placement: null }]);
    expect(await logbook.partsOf(id.second)).toEqual({ cylinders: [], lead: [] });
  });

  it('gives the Participants of a Dive with their names', async () => {
    expect(await logbook.participantsOfDive(id.first)).toEqual([{ diverId: expect.any(String), name: 'Bo', role: 'buddy' }]);
    expect(await logbook.participantsOfDive(id.second)).toEqual([]);
  });
});

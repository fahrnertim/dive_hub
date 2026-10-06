// The dive assessment through the API (ADR 0036): findings computed after imports and changes, the dives around a
// Dive, dismissing and muting, the list's count, the computer's own events, and what another User never sees.
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/assessment/rules.js';
import { dive, diveAssessment, diveFinding, recording, recordingEvent } from '../src/db/schema.js';
import { makeSyntheticDive } from './fixtures/synthetic-dive.js';
import {
  BASE_URL, createTestApp, createTestDatabase, createUser, databaseReachable, multipartFile, signIn, type TestDatabase,
} from './support.js';

type FindingView = {
  rule: string; severity: string; startSeconds: number | null; endSeconds: number | null; values: Record<string, unknown>;
  evidence: string[]; sources: { title: string; url: string }[]; dismissed: boolean; muted: boolean;
};
type Assessment = {
  engineVersion: number; current: boolean; applies: boolean; recordingId: string | null; sampleIntervalSeconds: number | null;
  ascentBands: [number, number, number][]; findings: FindingView[]; computerEvents: { atSeconds: number; event: string }[];
  noFly: { hours: number; reason: string; until: string; source: { title: string; url: string } } | null;
};

describe.skipIf(!(await databaseReachable()))('the dive assessment', () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let tim: string;
  let bob: string;
  let timDiver: string;
  let morning: string;
  let deep: string;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload && { payload }) });
  const json = async <T>(method: Parameters<typeof call>[0], url: string, cookie: string, payload?: object) =>
    (await call(method, url, cookie, payload)).json() as T;
  const assessment = (id: string, cookie = tim) => json<Assessment>('GET', `/api/dives/${id}/assessment`, cookie);
  const rules = (a: Assessment) => a.findings.map((f) => f.rule);
  const listed = async (id: string) => (await json<{ dives: { id: string; findings: number }[] }>('GET', '/api/dives', tim)).dives.find((d) => d.id === id)!.findings;
  const version = async (id: string) => (await json<{ version: number }>('GET', `/api/dives/${id}`, tim)).version;

  async function upload(cookie: string, options: Parameters<typeof makeSyntheticDive>[0]) {
    const { payload, headers } = multipartFile('dive.fit', makeSyntheticDive(options));
    const imported = await ctx.app.inject({ method: 'POST', url: '/api/imports', payload, headers: { ...headers, cookie } });
    await ctx.imports.processImport(imported.json().id);
    return (await json<{ outcome: { diveId: string }[] }>('GET', `/api/imports/${imported.json().id}`, cookie)).outcome[0]!.diveId;
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await createTestApp(t);
    await createUser(ctx.auth, 'tim@example.com');
    await createUser(ctx.auth, 'bob@example.com');
    tim = await signIn(ctx.app, 'tim@example.com');
    bob = await signIn(ctx.app, 'bob@example.com');
    timDiver = (await json<{ id: string; isOwn: boolean }[]>('GET', '/api/divers', tim)).find((d) => d.isOwn)!.id;
    // 18.5 m for half an hour with a three-minute stop: nothing to remark.
    morning = await upload(tim, { serialNumber: 111, start: new Date('2026-03-14T07:00:00Z') });
  });
  afterAll(async () => {
    await ctx?.app.close();
    await t?.drop();
  });

  it('assesses a Dive when its file is imported: nothing stands out on a clean dive, and it says how long not to fly', async () => {
    const a = await assessment(morning);
    expect(a).toMatchObject({ engineVersion: ENGINE_VERSION, current: true, applies: true, sampleIntervalSeconds: 2, computerEvents: [] });
    expect(a.recordingId).not.toBeNull();
    expect(a.findings).toEqual([]);
    // DAN's no-fly time is information beside the findings, not one of them.
    expect(a.noFly).toEqual({ hours: 12, reason: 'single', until: '2026-03-14T19:30:00.000Z', source: expect.objectContaining({ url: expect.stringMatching(/^https:\/\/dan\.org/) }) });
    expect(await listed(morning)).toBe(0);
    // Stored when the Import ran, not when it was first read.
    expect(await t.db.select().from(diveAssessment).where(eq(diveAssessment.diveId, morning))).toHaveLength(1);
  });

  it('finds a fast ascent and high oxygen pressure, with values, evidence and sources, and marks the Dive in the list', async () => {
    // 40 m on EAN32, twenty minutes in all: down at 30 m/min, 1.6 bar at the bottom, up at 13 m/min, three minutes between
    // 3 and 6 m where five are recommended. Four hours after the morning dive.
    deep = await upload(tim, { serialNumber: 111, start: new Date('2026-03-14T12:00:00Z'), maxDepthM: 40, durationSeconds: 20 * 60 });
    const a = await assessment(deep);
    expect(a.findings.map((f) => [f.rule, f.severity])).toEqual([
      ['descent_rate', 'info'], ['ppo2', 'note'], ['ascent_rate', 'note'], ['safety_stop', 'info'], ['reverse_profile', 'info'],
    ]);
    const ascent = a.findings[2]!;
    expect(ascent).toMatchObject({ severity: 'note', values: { limit_m_min: 10, stretches: 1 }, evidence: ['experiment', 'rule'] });
    expect(ascent.values.max_m_min as number).toBeGreaterThan(12);
    expect(ascent.startSeconds).toBeGreaterThan(700);
    expect(ascent.endSeconds!).toBeGreaterThan(ascent.startSeconds!);
    expect(ascent.sources.length).toBeGreaterThan(1);
    expect(a.findings[1]).toMatchObject({ values: { max_bar: 1.6, limit_bar: 1.4 }, evidence: ['rule'] });
    expect(a.findings[3]).toMatchObject({ values: { recommended_s: 300, minimum_s: 180, max_depth_m: 40 } });
    expect(a.ascentBands.some(([, , band]) => band === 2)).toBe(true);
    expect(await listed(deep)).toBe(2);
  });

  it('looks at the dives around a Dive: the reverse profile, and the no-fly time moves to the day\'s last dive', async () => {
    const a = await assessment(deep);
    expect(a.findings.find((f) => f.rule === 'reverse_profile')).toMatchObject({
      severity: 'info', startSeconds: null, values: { reason: 'difference', previous_dive_id: morning, previous_max_depth_m: 18.5, max_depth_m: 40 },
    });
    expect(a.noFly).toMatchObject({ hours: 18, reason: 'several' });
    expect((await assessment(morning)).noFly).toBeNull();
  });

  it('follows the logbook: deleting the later dive gives the earlier one its no-fly time back, restoring takes it again', async () => {
    await call('DELETE', `/api/dives/${deep}`, tim, { version: await version(deep) });
    expect((await assessment(morning)).noFly).toMatchObject({ hours: 12 });
    // The deleted Dive keeps its findings and counts nowhere.
    expect((await t.db.select().from(diveFinding).where(eq(diveFinding.diveId, deep))).length).toBe(5);
    expect((await call('GET', `/api/dives/${deep}/assessment`, tim)).statusCode).toBe(404);
    const deleted = await json<{ dives: { id: string; version: number }[] }>('GET', '/api/dives/deleted', tim);
    await call('POST', `/api/dives/${deep}/restore`, tim, { version: deleted.dives[0]!.version });
    expect((await assessment(morning)).noFly).toBeNull();
    expect(rules(await assessment(deep))).toContain('reverse_profile');
  });

  it('lets the User put a finding aside on one Dive, and bring it back', async () => {
    const dismissed = await json<Assessment>('PUT', `/api/dives/${deep}/findings/ppo2/dismissal`, tim, { dismissed: true });
    expect(dismissed.findings.filter((f) => f.dismissed).map((f) => f.rule)).toEqual(['ppo2']);
    expect(await listed(deep)).toBe(1);
    // What was computed stays.
    expect(dismissed.findings[1]!.values).toMatchObject({ max_bar: 1.6 });
    const back = await json<Assessment>('PUT', `/api/dives/${deep}/findings/ppo2/dismissal`, tim, { dismissed: false });
    expect(back.findings[1]!.dismissed).toBe(false);
    expect(await listed(deep)).toBe(2);
    expect((await call('PUT', `/api/dives/${deep}/findings/sawtooth/dismissal`, tim, { dismissed: true })).json()).toMatchObject({ code: 'finding_not_found' });
    expect((await call('PUT', `/api/dives/${deep}/findings/nonsense/dismissal`, tim, { dismissed: true })).statusCode).toBe(400);
  });

  it('lets the User mute a rule for a Diver: its findings stay, marked, and leave the list\'s count', async () => {
    expect((await call('PUT', `/api/divers/${timDiver}/muted-rules/ascent_rate`, tim, { muted: true })).statusCode).toBe(204);
    // The Diver lists what is muted, so it can be shown again without finding a Dive that has it.
    expect((await json<{ id: string; mutedRules: string[] }[]>('GET', '/api/divers', tim)).find((d) => d.id === timDiver)!.mutedRules).toEqual(['ascent_rate']);
    const a = await assessment(deep);
    expect(a.findings[2]).toMatchObject({ rule: 'ascent_rate', muted: true, dismissed: false });
    expect(await listed(deep)).toBe(1);
    await call('PUT', `/api/divers/${timDiver}/muted-rules/ascent_rate`, tim, { muted: false });
    expect((await assessment(deep)).findings[2]!.muted).toBe(false);
  });

  it('is the User\'s own: another User gets nothing and changes nothing', async () => {
    expect((await call('GET', `/api/dives/${deep}/assessment`, bob)).statusCode).toBe(404);
    expect((await call('PUT', `/api/dives/${deep}/findings/safety_stop/dismissal`, bob, { dismissed: true })).statusCode).toBe(404);
    expect((await call('PUT', `/api/divers/${timDiver}/muted-rules/safety_stop`, bob, { muted: true })).json()).toMatchObject({ code: 'diver_not_found' });
    expect((await assessment(deep)).findings.every((f) => !f.dismissed && !f.muted)).toBe(true);
  });

  it('shows what the dive computer itself noted, in our words, and leaves out alerts that say nothing about the dive', async () => {
    const [rec] = await t.db.select({ id: recording.id }).from(recording).where(eq(recording.diveId, deep));
    await t.db.insert(recordingEvent).values([
      { recordingId: rec!.id, offsetMs: 900_000, type: 'dive_alert', data: { eventType: 'marker', data: 17 } },
      { recordingId: rec!.id, offsetMs: 902_000, type: 'dive_alert', data: { eventType: 'marker', data: 19 } },
      { recordingId: rec!.id, offsetMs: 1_100_000, type: 'dive_alert', data: { eventType: 'marker', data: 11 } },
      { recordingId: rec!.id, offsetMs: 0, type: 'timer', data: { eventType: 'start', data: 0 } },
    ]);
    expect((await assessment(deep)).computerEvents).toEqual([{ atSeconds: 900, event: 'ascent_critical' }, { atSeconds: 1100, event: 'safety_stop_broken' }]);
  });

  it('assesses again after a new engine version, and drops a dismissal whose finding is gone', async () => {
    await call('PUT', `/api/dives/${deep}/findings/ascent_rate/dismissal`, tim, { dismissed: true });
    // As if an older engine had found something else: a stale version, a finding the rules no longer give.
    await t.db.update(diveAssessment).set({ engineVersion: ENGINE_VERSION - 1 }).where(eq(diveAssessment.diveId, deep));
    await t.db.delete(diveFinding).where(and(eq(diveFinding.diveId, deep), eq(diveFinding.rule, 'safety_stop')));
    await t.db.execute(sql`insert into finding_dismissal (dive_id, rule) values (${deep}::uuid, 'sawtooth')`);
    expect(await ctx.assessments.refreshAll()).toBe(1);
    const stored = await t.db.select().from(diveFinding).where(eq(diveFinding.diveId, deep));
    expect(stored.map((f) => f.rule).sort()).toEqual(['ascent_rate', 'descent_rate', 'ppo2', 'reverse_profile', 'safety_stop']);
    expect(stored.every((f) => f.engineVersion === ENGINE_VERSION)).toBe(true);
    const a = await assessment(deep);
    // The dismissal of a finding that is still there stays; the other went with its finding.
    expect(a.findings.filter((f) => f.dismissed).map((f) => f.rule)).toEqual(['ascent_rate']);
    expect((await t.db.execute(sql`select rule from finding_dismissal where dive_id = ${deep}::uuid`)).rows).toEqual([{ rule: 'ascent_rate' }]);
    await call('PUT', `/api/dives/${deep}/findings/ascent_rate/dismissal`, tim, { dismissed: false });
  });

  it('gives a Dive without a Recording only what the dives around it say', async () => {
    const [typed] = await t.db.insert(dive).values({
      diverId: timDiver, startsAt: new Date('2026-03-14T13:00:00Z'), utcOffsetSeconds: 7200, durationSeconds: 2400, maxDepthM: 22, fromProvider: 'ssi',
    }).returning({ id: dive.id });
    const a = await assessment(typed!.id);
    expect(a).toMatchObject({ applies: true, recordingId: null, sampleIntervalSeconds: null, ascentBands: [] });
    // 40 minutes after the deep dive ended, to 22 m; and now the last dive of the day.
    expect(rules(a)).toEqual(['surface_interval']);
    expect(a.noFly).toMatchObject({ hours: 18 });
    expect((await assessment(deep)).noFly).toBeNull();
    await t.db.delete(dive).where(eq(dive.id, typed!.id));
  });

  it('leaves out dives the rules don\'t cover', async () => {
    const [rec] = await t.db.select().from(recording).where(eq(recording.diveId, deep));
    await t.db.update(recording).set({ summary: { ...rec!.summary, diveMode: 'apnea' }, updatedAt: new Date() }).where(eq(recording.id, rec!.id));
    const a = await assessment(deep);
    expect(a).toMatchObject({ applies: false, findings: [] });
    // It no longer counts for the dives around it either.
    expect((await assessment(morning)).noFly).toMatchObject({ hours: 12, reason: 'single' });
    expect(a.noFly).toBeNull();
    await t.db.update(recording).set({ summary: rec!.summary, updatedAt: new Date() }).where(eq(recording.id, rec!.id));
    expect(rules(await assessment(deep))).toContain('ascent_rate');
  });

  it('follows an edit: a Dive moved to another day stops being a reverse profile', async () => {
    await call('PATCH', `/api/dives/${deep}`, tim, { version: await version(deep), set: { startsAt: { at: '2026-03-20T12:00:00.000Z', utcOffsetSeconds: 7200 } } });
    const stored = await t.db.select().from(diveFinding).where(eq(diveFinding.diveId, deep));
    expect(stored.map((f) => f.rule).sort()).toEqual(['ascent_rate', 'descent_rate', 'ppo2', 'safety_stop']);
    expect((await assessment(deep)).noFly).toMatchObject({ hours: 12 });
    expect((await assessment(morning)).noFly).toMatchObject({ hours: 12 });
  });
});

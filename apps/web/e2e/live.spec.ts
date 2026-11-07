// Live updates in the browser (ADR 0066): a background Import's new Dive arrives through the hint stream, the same row
// arrives through polling when the proxy strips the stream, and a reconnect refetches what is on screen. Plus the
// "changed while editing" notice from the design decision (FAH-37).
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, editElsewhere, resetDive, seededDiveId, setPreferences } from './support.ts';

test.describe.configure({ mode: 'serial' });

const headers = { origin: E2E_BASE_URL };
const created: string[] = [];

/** Uploads a fixture while the page is open; returns its Dive id once the worker is done. */
async function importFixture(request: APIRequestContext, file: string): Promise<string> {
  const upload = await request.post('/api/imports', {
    headers,
    multipart: { file: { name: file, mimeType: 'application/octet-stream', buffer: readFileSync(`e2e/fixtures/${file}`) } },
  });
  expect(upload.status()).toBe(202);
  const url = `/api/imports/${(await upload.json() as { id: string }).id}`;
  await expect.poll(async () => (await (await request.get(url)).json()).status, { timeout: 15_000 }).toBe('done');
  const outcome = (await (await request.get(url)).json()) as { outcome: { diveId?: string }[] };
  const id = outcome.outcome.find((entry) => entry.diveId)?.diveId;
  if (!id) throw new Error(`${file} did not make a Dive`);
  created.push(id);
  return id;
}

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

test.afterAll(async ({ request }) => {
  for (const id of created) {
    const dive = await request.get(`/api/dives/${id}`);
    if (!dive.ok()) continue;
    const { version } = await dive.json() as { version: number };
    await request.delete(`/api/dives/${id}`, { headers, data: { version } });
  }
  await resetDive(request);
});

test('a background import brings a new Dive into an untouched logbook, tinted as it arrives', { tag: ['@live', '@dives'] }, async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
  const before = await page.locator('[data-dive-id]').count();

  const started = Date.now();
  const id = await importFixture(request, 'live-computer.fit');
  // The hint is emitted when the import's Revision commits; the row must show up without a reload or a scroll.
  await expect(page.locator(`[data-dive-id="${id}"]`)).toBeVisible({ timeout: 4_000 });
  expect(Date.now() - started).toBeLessThan(6_000);
  expect(await page.locator('[data-dive-id]').count()).toBeGreaterThan(before);
  // It arrived at the top of the newest-first list, so the design's brief tint starts as it becomes visible.
  await expect(page.locator(`[data-dive-id="${id}"]`)).toHaveClass(/is-arrival/, { timeout: 2_000 });
});

test('with the stream blocked, the polling fallback still brings the new Dive in', { tag: ['@live', '@dives'] }, async ({ page, request }) => {
  // A proxy that strips text/event-stream: EventSource fails and the list falls back to asking again.
  await page.route('**/api/live', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();

  const id = await importFixture(request, 'live-computer-2.fit');
  await expect(page.locator(`[data-dive-id="${id}"]`)).toBeVisible({ timeout: 20_000 });
});

test('a Dive changed elsewhere while its edit form is dirty keeps the edits and says so', { tag: ['@live', '@dives'] }, async ({ page, request }) => {
  const id = await seededDiveId(request);
  await page.goto(`/#/dives/${id}`);
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await page.getByRole('textbox', { name: 'Notes' }).fill('typed here and not saved yet');

  await editElsewhere(request, id, 'changed elsewhere while the form was open');

  await expect(page.getByText('This dive changed elsewhere. Your edits are still here.')).toBeVisible({ timeout: 4_000 });
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('typed here and not saved yet');
  await expect(page.getByRole('button', { name: 'Load the new version' })).toBeVisible();
});

test('a reconnect refetches what is on screen', { tag: ['@live', '@dives'] }, async ({ page, request }) => {
  const id = await seededDiveId(request);
  await page.goto(`/#/dives/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.context().setOffline(true);
  // Hints missed while the stream is down are covered by the refetch on reconnect.
  await editElsewhere(request, id, 'written while the page was offline');
  await page.context().setOffline(false);
  await expect(page.getByText('written while the page was offline')).toBeVisible({ timeout: 15_000 });
});

test('no polling fires while the live channel is healthy', { tag: ['@live', '@dives'] }, async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
  // The logbook would ask again every five seconds without a channel (ADR 0066); with one, none of those fire.
  let asked = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/dives') asked += 1;
  });
  await page.waitForTimeout(6_000);
  expect(asked).toBe(0);
});

test('two tabs of one browser share one live stream', { tag: ['@live', '@account'] }, async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  let streams = 0;
  for (const page of [first, second]) {
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/live') streams += 1;
    });
  }
  await Promise.all([first.goto('/'), second.goto('/')]);
  await expect(first.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
  // The leader holds the one stream; the other tab follows over the BroadcastChannel.
  await first.waitForTimeout(2_000);
  expect(streams).toBe(1);
  await first.close();
  await second.close();
});

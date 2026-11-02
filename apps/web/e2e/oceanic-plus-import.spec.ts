// A dive from the Oceanic+ app's UDDF logbook export (docs/references/oceanic-plus.md) in a real browser: imported like
// any dive file, at the local time the app meant, with its profile.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, setPreferences } from './support.ts';

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

test('imports an Oceanic+ UDDF export', { tag: ['@dives'] }, async ({ page, request }) => {
  // The same file again is "already imported" and still names its Dive, so the test can run twice on one server.
  const upload = await request.post('/api/imports', {
    headers: { origin: E2E_BASE_URL },
    multipart: { file: { name: 'Oceanic+ logbook.uddf', mimeType: 'application/octet-stream', buffer: readFileSync('e2e/fixtures/oceanic-plus.uddf') } },
  });
  const url = `/api/imports/${(await upload.json() as { id: string }).id}`;
  await expect.poll(async () => (await (await request.get(url)).json()).status).toBe('done');
  const [outcome] = ((await (await request.get(url)).json()) as { outcome: { result: string; diveId?: string }[] }).outcome;
  expect(['created', 'unchanged']).toContain(outcome!.result);

  const dive = await (await request.get(`/api/dives/${outcome!.diveId}`)).json() as Record<string, unknown>;
  // The app writes the offset as `-00:04`: four hours behind UTC, so 10:05 local is 14:05 UTC. The site's coordinates
  // are where the dive was.
  expect(dive).toMatchObject({
    fromRecording: { startsAt: { at: '2025-12-06T14:05:20.000Z', utcOffsetSeconds: -14400 }, maxDepthM: 12.4, durationSeconds: 85 },
    position: { latitude: 18.3, longitude: -65.6 },
  });

  await page.goto(`/#/dives/${outcome!.diveId}`);
  await expect(page.getByRole('img', { name: /depth/i }).first()).toBeVisible();
});

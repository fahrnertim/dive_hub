// A Suunto dive from the Suunto app's JSON export (ADR 0037) in a real browser: imported like a Garmin file, with
// Suunto's model in our words and what the computer noted beside the assessment.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, setPreferences } from './support.ts';

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

test('imports a Suunto JSON export and shows its computer\'s data', { tag: ['@dives'] }, async ({ page, request }) => {
  // The same file again is "already imported" and still names its Dive, so the test can run twice on one server.
  const upload = await request.post('/api/imports', {
    headers: { origin: E2E_BASE_URL },
    multipart: { file: { name: 'ScubaDiving_2025-11-08T09_30_00.json', mimeType: 'application/json', buffer: readFileSync('e2e/fixtures/suunto-d5.json') } },
  });
  const url = `/api/imports/${(await upload.json() as { id: string }).id}`;
  await expect.poll(async () => (await (await request.get(url)).json()).status).toBe('done');
  const [outcome] = ((await (await request.get(url)).json()) as { outcome: { result: string; diveId?: string }[] }).outcome;
  expect(['created', 'unchanged']).toContain(outcome!.result);

  await page.goto(`/#/dives/${outcome!.diveId}`);
  await expect(page.getByText('Suunto D5').first()).toBeVisible();
  await expect(page.getByText('Suunto Fused RGBM 2')).toBeVisible();
  await expect(page.getByText('EAN32').first()).toBeVisible();

  // What the computer itself noted, in our words, beside the findings.
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Assessment', exact: true }) });
  for (const noted of ['ascent too fast', 'safety stop made mandatory', 'deep stop started', 'deep stop left early', 'safety stop started', 'tank pressure low']) {
    await expect(panel.getByRole('listitem').filter({ hasText: noted })).toBeVisible();
  }

  await setPreferences(request, { language: 'de' });
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Tiefenstopp vorzeitig verlassen' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Flaschendruck niedrig' })).toBeVisible();
});

test('says in the import texts that Suunto files are read', { tag: ['@dives'] }, async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByText('You can also drop dive files and zips anywhere on this page.')).toBeVisible();
});

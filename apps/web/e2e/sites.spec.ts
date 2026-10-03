// Dive sites in a real browser (ADR 0020). One story in order: a dive recorded with a position gets a
// new site made from that position; the logbook filters by it; dive 42 (no position) picks a site by
// searching; the Dive sites page creates, edits and deletes a site.
// Fixture: e2e/fixtures/sited-computer.fit (apps/server/test/fixtures/write-sited-fixture.ts).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, expectGoodPage, resetDive, seededDiveId, setPreferences } from './support.ts';

test.describe.configure({ mode: 'serial' });

const headers = { origin: E2E_BASE_URL };
let sitedDiveId: string;
let diveId: string;

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
  const upload = await request.post('/api/imports', {
    headers,
    multipart: { file: { name: 'sited-computer.fit', mimeType: 'application/octet-stream', buffer: readFileSync('e2e/fixtures/sited-computer.fit') } },
  });
  expect(upload.status()).toBe(202);
  const id = (await upload.json()).id as string;
  await expect.poll(async () => (await (await request.get(`/api/imports/${id}`)).json()).status).toBe('done');
  sitedDiveId = (await (await request.get(`/api/imports/${id}`)).json()).outcome[0].diveId;
  diveId = await seededDiveId(request);
});

test.afterAll(async ({ request }) => {
  // Later specs expect dive 42 without a site.
  const dive = await (await request.get(`/api/dives/${diveId}`)).json() as { version: number };
  await request.patch(`/api/dives/${diveId}`, { headers, data: { version: dive.version, siteId: null } });
  await resetDive(request);
});

test('a dive with a position: a new dive site is made from it and chosen', async ({ page }) => {
  await page.goto(`/#/dives/${sitedDiveId}`);
  const facts = page.locator('dl.facts').first();
  await expect(facts).toContainText('28.5003° N, 34.5197° E');
  await expect(page.getByRole('link', { name: 'Open in maps' })).toHaveAttribute('href', /openstreetmap\.org\/\?mlat=28\.50030&mlon=34\.51970/);

  await page.getByRole('button', { name: 'Choose dive site' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dive site' });
  await expect(dialog).toContainText('No dive sites within 2 km of this dive yet.');
  await dialog.getByRole('button', { name: 'New dive site' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await expect(dialog.getByRole('textbox', { name: 'Latitude' })).toHaveValue('28.5003');
  await expect(dialog).toContainText('Every User of this Dive Hub sees the dive site');
  await expectGoodPage(page, 'Dive 7');
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Lighthouse');
  await dialog.getByRole('button', { name: 'Country' }).click();
  await page.getByRole('option', { name: 'Egypt' }).click();
  await dialog.getByRole('textbox', { name: 'Body of water' }).fill('Red Sea');
  await dialog.getByRole('button', { name: 'Create and choose' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change dive site' })).toBeFocused();
  await expect(facts.getByRole('link', { name: 'Lighthouse' })).toBeVisible();
  await expect(page.locator('.history > li').first()).toContainText('Dive site: – → Lighthouse');

  await facts.getByRole('link', { name: 'Lighthouse' }).click();
  await expect(page.getByRole('heading', { name: 'Lighthouse', level: 1 })).toBeVisible();
  await expect(page.getByText('Egypt · Red Sea')).toBeVisible();
  await expectGoodPage(page, 'Lighthouse');
  await page.getByRole('link', { name: '1 dive', exact: true }).click();
  await expect(page.getByText('Dives at Lighthouse')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2); // header + dive 7
  await expect(page.getByRole('row').nth(1)).toContainText('Lighthouse');
  await page.getByRole('link', { name: 'Show all dives' }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('a dive without a position picks a site by searching, and can go back to none', async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Choose dive site' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dive site' });
  await dialog.getByRole('searchbox', { name: 'Find a dive site' }).fill('light');
  await dialog.getByText('Lighthouse', { exact: true }).click(); // the label, as a person would
  await dialog.getByRole('button', { name: 'Choose' }).click();
  await expect(page.locator('dl.facts').first().getByRole('link', { name: 'Lighthouse' })).toBeVisible();

  await page.getByRole('button', { name: 'Change dive site' }).click();
  await expect(dialog.getByRole('radio', { name: /Lighthouse/ })).toBeChecked();
  await dialog.getByText('No dive site', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Choose' }).click();
  await expect(page.getByRole('button', { name: 'Choose dive site' })).toBeVisible();
});

test('the Dive sites page creates, edits and deletes a site', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Dive sites' }).click();
  await expect(page.getByRole('heading', { name: 'Dive sites', level: 1 })).toBeFocused();
  await expect(page.getByRole('row').filter({ hasText: 'Lighthouse' })).toContainText('Egypt');

  await page.getByRole('button', { name: 'New dive site' }).click();
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Name' }).fill('Blu Hole');
  await page.getByRole('textbox', { name: 'Latitude' }).fill('28.5722');
  await page.getByRole('button', { name: 'Create dive site' }).click();
  await expect(page.getByText('Enter both latitude and longitude, or neither.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Longitude' }).fill('34.5372');
  await page.getByRole('button', { name: 'Create dive site' }).click();

  await expect(page.getByRole('heading', { name: 'Blu Hole', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Edit dive site' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Blue Hole');
  await page.getByRole('button', { name: 'Save dive site' }).click();
  await expect(page.getByRole('heading', { name: 'Blue Hole', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit dive site' })).toBeFocused();

  await page.getByRole('button', { name: /^More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Delete dive site' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Dive sites', level: 1 })).toBeVisible();
  await expect(page.getByText('Blue Hole')).toHaveCount(0);
});

test('a site with dives says why it can\'t be deleted', async ({ page }) => {
  await page.goto('/#/sites');
  await page.getByRole('link', { name: 'Lighthouse' }).click();
  await expect(page.getByText('Dives are at this dive site, so it can’t be deleted.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^More actions/ })).toHaveCount(0);
});

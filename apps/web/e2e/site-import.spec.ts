// Importing Dive sites from open data in a real browser (ADR 0021). The e2e server answers Overpass and
// Wikidata from recorded responses (apps/server/test/fixtures/site-sources): Malta has 36 OSM dive spots
// and no Wikidata item. One story in order: the admin imports Malta, a site shows where it comes from
// with OSM's Attribution and its history, the SSI site ID and maximum depth are entered by hand.
import { expect, test } from '@playwright/test';
import { expectGoodPage, setPreferences } from './support.ts';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

test('the admin imports the dive sites of a country, after confirming the ODbL conditions', async ({ page }) => {
  await page.goto('/#/admin');
  await page.getByRole('link', { name: 'Import dive sites' }).click();
  await expect(page.getByRole('heading', { name: 'Import dive sites', level: 1 })).toBeFocused();
  await expect(page.getByText('No imports yet.')).toBeVisible();
  await expect(page.getByText('OpenStreetMap’s data comes with conditions (Open Database License).')).toBeVisible();
  await expectGoodPage(page, 'Import dive sites');

  // Nothing chosen yet: the form says what is missing, one thing at a time.
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect(page.getByText('Choose a country.')).toBeVisible();
  await page.getByRole('button', { name: 'Country' }).click();
  await page.getByRole('option', { name: 'Malta' }).click();
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect(page.getByText('Confirm the conditions of OpenStreetMap’s data, or import from Wikidata only.')).toBeVisible();

  await page.getByText('I understand and import OpenStreetMap data under these conditions').click();
  await page.getByRole('button', { name: 'Start import' }).click();
  const latest = page.locator('.site-imports > li').first();
  await expect(latest).toContainText('OpenStreetMap, Wikidata · Malta');
  await expect(latest).toContainText('done', { timeout: 20_000 });
  await expect(latest).toContainText('36 new');
  await expectGoodPage(page, 'Import dive sites');
});

test('an imported site says where it comes from, with OpenStreetMap\'s Attribution and the import in its history', async ({ page }) => {
  await page.goto('/#/sites');
  await expect(page.getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  await page.getByRole('searchbox', { name: 'Search' }).fill('Ras il');
  await page.getByRole('link', { name: 'Ras il-Ħobż' }).click();

  await expect(page.getByRole('heading', { name: 'Ras il-Ħobż', level: 1 })).toBeVisible();
  await expect(page.getByText('Malta', { exact: true })).toBeVisible();
  const origin = page.locator('.site-origin');
  await expect(origin).toContainText('From OpenStreetMap: node/4159831401');
  await expect(origin.getByRole('link', { name: 'node/4159831401' })).toHaveAttribute('href', 'https://www.openstreetmap.org/node/4159831401');
  await expect(origin.getByRole('link', { name: '© OpenStreetMap contributors' })).toBeVisible();
  const created = page.locator('.history > li').first();
  await expect(created).toContainText('Created');
  await expect(created).toContainText('Import from OpenStreetMap, Wikidata');
  await expect(created).toContainText('OpenStreetMap ID: node/4159831401');
  await expectGoodPage(page, 'Ras il-Ħobż');
});

test('anyone enters the SSI site ID and maximum depth by hand', async ({ page }) => {
  await page.goto('/#/sites');
  await page.getByRole('searchbox', { name: 'Search' }).fill('Ras il');
  await page.getByRole('link', { name: 'Ras il-Ħobż' }).click();
  await page.getByRole('button', { name: 'Edit dive site' }).click();
  await page.getByRole('textbox', { name: 'SSI site ID' }).fill('Q3314');
  await page.getByRole('button', { name: 'Save dive site' }).click();
  await expect(page.getByText('An SSI site ID is a number, e.g. 3314.')).toBeVisible();

  // What SSI's QR code says works as well as the number.
  await page.getByRole('textbox', { name: 'SSI site ID' }).fill('site:3314');
  await page.getByRole('textbox', { name: 'Maximum depth' }).fill('32');
  await page.getByRole('button', { name: 'Save dive site' }).click();
  await expect(page.getByRole('button', { name: 'Edit dive site' })).toBeFocused();
  const facts = page.locator('dl.facts');
  await expect(facts).toContainText('3314');
  await expect(facts).toContainText('32 m');
  const edited = page.locator('.history > li').first();
  await expect(edited).toContainText('Edited');
  await expect(edited).toContainText('you');
  await expect(edited).toContainText('SSI site ID: – → 3314');
});

test('a Wikidata-only import needs no confirmation, and says when there is nothing', async ({ page }) => {
  await page.goto('/#/admin/site-imports');
  await page.getByRole('button', { name: 'Country' }).click();
  await page.getByRole('option', { name: 'Malta' }).click();
  await page.getByText('OpenStreetMap (ODbL)').click(); // Wikidata only: nothing to confirm
  await page.getByRole('button', { name: 'Start import' }).click();
  const latest = page.locator('.site-imports > li').first();
  await expect(latest).toContainText('Wikidata · Malta');
  await expect(latest).toContainText('done', { timeout: 20_000 });
  await expect(latest).toContainText('The sources have no dive sites there.');
});

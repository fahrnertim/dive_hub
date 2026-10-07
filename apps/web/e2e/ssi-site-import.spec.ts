// Importing Dive sites from SSI's list in a real browser (ADR 0025). The e2e server answers with a hand-made file
// in SSI's format (apps/server/test/fixtures/site-sources/ssi-sites.json), never the real one. One story in order:
// the admin confirms the explanation and only fills sites already here; a site made here takes SSI's data; the
// dives there take its water type, with a hint when the computer was set to other water; then an import creates.
// It uses Belize and Germany, which no other spec imports (Austria's 5120 is ssi.spec's, Palau is counted).
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, expectGoodPage, leaveSsi, seededDiveId, setPreferences } from './support.ts';

test.describe.configure({ mode: 'serial' });

const headers = { origin: E2E_BASE_URL };
const OURS = 'Blue Hole (club notes)';

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
  // A site made here, with SSI's ID typed into its form: a reference that SSI's data can fill.
  const ours = await (await request.post('/api/dive-sites', { headers, data: { name: OURS, position: { latitude: 17.316, longitude: -87.5346 } } })).json() as { id: string };
  await request.put(`/api/dive-sites/${ours.id}/external-ids/ssi`, { headers, data: { externalId: '7006' } });
});

// Other specs expect the seeded Dive without a site; this runs even when a test timed out.
test.afterAll(async ({ request }) => {
  await leaveSsi(request, await seededDiveId(request));
});

test('the admin imports SSI\'s sites only after confirming that SSI gives no licence, here only filling sites already here', { tag: ['@sites', '@admin'] }, async ({ page }) => {
  await page.goto('/#/admin/site-imports');
  await page.getByText('Wikidata (CC0, free to use)').click();
  await page.getByText('OpenStreetMap (ODbL)').click();
  await page.getByText('SSI (no licence, see below)').click();
  const terms = page.locator('.terms');
  await expect(terms).toContainText('SSI gives no licence for its list of dive sites.');
  await expect(terms).toContainText('In the EU the list is protected as a database');
  await expect(terms).toContainText('your decision as the operator of this Dive Hub, and your risk');
  await expect(terms).toContainText('Moderation comments, statistics and wildlife are never stored.');

  await page.getByRole('button', { name: 'Country' }).click();
  await page.getByRole('option', { name: 'Belize' }).click();
  await page.getByText('Only fill dive sites that are already here').click();
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect(page.getByText('Confirm the explanation about SSI’s list, or leave SSI out.')).toBeVisible();
  await expectGoodPage(page, 'Import dive sites');

  await page.getByText('I understand and import SSI’s dive sites at my own risk').click();
  await page.getByRole('button', { name: 'Start import' }).click();
  const latest = page.locator('.site-imports > li').first();
  await expect(latest).toContainText('SSI · Belize');
  await expect(latest).toContainText('done', { timeout: 20_000 });
  await expect(latest).toContainText('only filled sites already here');
  await expect(latest).toContainText('1 of ours can take its source’s data');
  await expect(latest.getByRole('link', { name: OURS })).toBeVisible();
  await expectGoodPage(page, 'Import dive sites');
});

test('a site made here takes SSI\'s data: its empty fields fill, its name stays, and it says "From SSI"', { tag: ['@sites', '@admin'] }, async ({ page }) => {
  await page.goto('/#/sites');
  await page.getByRole('searchbox', { name: 'Search' }).fill('club notes');
  await page.getByRole('link', { name: OURS }).click();
  const origin = page.locator('.site-origin');
  await expect(origin).toContainText('Also in SSI: 7006');
  await origin.getByRole('button', { name: 'Use SSI’s data' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Its empty fields take Country and Water type from SSI.');
  await expect(dialog).toContainText('These stay as they are, though SSI has other values: Name (Great Blue Hole)');
  await expectGoodPage(page);
  await dialog.getByRole('button', { name: 'Use the data' }).click();

  await expect(origin).toContainText('From SSI: 7006');
  // SSI has no page per site: nothing to link to, and no Attribution.
  await expect(origin.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: OURS, level: 1 })).toBeVisible();
  await expect(page.locator('dl.facts')).toContainText('Salt water');
  const latestChange = page.locator('.history > li').first();
  await expect(latestChange).toContainText('Data taken from its source');
  await expect(latestChange).toContainText('SSI’s data taken');
  await expect(latestChange).toContainText('Water type: – → Salt water');
});

test('a dive takes its site\'s water type, and says when the computer was set to other water', { tag: ['@sites', '@dives'] }, async ({ page, request }) => {
  const diveId = await seededDiveId(request);
  // Without a site the dive has no water type; the computer's setting is shown as such.
  await page.goto(`/#/dives/${diveId}`);
  await expect(page.locator('dl.facts').first()).toContainText('Choose a dive site, and the dive takes its water type.');
  await page.getByText('All values of the recording').click();
  await expect(page.getByText('Water setting on the computer')).toBeVisible();

  const { sites } = await (await request.get('/api/dive-sites?q=club%20notes')).json() as { sites: { id: string; version: number }[] };
  // The site has SSI's salt water from the import above; set here too, so this test stands alone when run by area.
  const site = await (await request.get(`/api/dive-sites/${sites[0]!.id}`)).json() as { version: number; waterType: string | null };
  if (site.waterType !== 'salt') await request.patch(`/api/dive-sites/${sites[0]!.id}`, { headers, data: { version: site.version, waterType: 'salt' } });
  const dive = await (await request.get(`/api/dives/${diveId}`)).json() as { version: number };
  await request.patch(`/api/dives/${diveId}`, { headers, data: { version: dive.version, siteId: sites[0]!.id } });
  await page.reload();
  await expect(page.locator('dl.facts').first()).toContainText('Salt water');
  await expect(page.locator('dl.facts').first()).toContainText('Comes from the dive site');

  // The site turns out to be fresh water: the form says what that changes.
  await page.getByRole('link', { name: OURS }).click();
  await page.getByRole('button', { name: 'Edit dive site' }).click();
  await expect(page.getByText('Changing it changes the water type of every dive at this site.')).toBeVisible();
  await page.getByRole('button', { name: 'Water type' }).click();
  await page.getByRole('option', { name: 'Fresh water' }).click();
  await page.getByRole('button', { name: 'Save dive site' }).click();
  await expect(page.getByRole('button', { name: 'Edit dive site' })).toBeFocused();

  await page.goto(`/#/dives/${diveId}`);
  const facts = page.locator('dl.facts').first();
  await expect(facts).toContainText('Fresh water');
  await expect(facts).toContainText('Your computer was set to salt water; this site is fresh water. Its depths read about 2 % shallow.');
  await expectGoodPage(page, 'Dive 42');
  // No water type in the dive's own form any more.
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await expect(page.getByRole('button', { name: 'Water type' })).toHaveCount(0);
});

test('an SSI import creates sites that say "From SSI" without a link', { tag: ['@sites', '@admin'] }, async ({ page }) => {
  await page.goto('/#/admin/site-imports');
  await page.getByText('Wikidata (CC0, free to use)').click();
  await page.getByText('OpenStreetMap (ODbL)').click();
  await page.getByText('SSI (no licence, see below)').click();
  await page.getByText('I understand and import SSI’s dive sites at my own risk').click();
  await page.getByRole('button', { name: 'Country' }).click();
  await page.getByRole('option', { name: 'Germany' }).click();
  await page.getByRole('button', { name: 'Start import' }).click();
  const latest = page.locator('.site-imports > li').first();
  await expect(latest).toContainText('SSI · Germany');
  await expect(latest).toContainText('done', { timeout: 20_000 });
  await expect(latest).toContainText('1 new');

  await page.goto('/#/sites');
  await page.getByRole('searchbox', { name: 'Search' }).fill('Tauchturm');
  await page.getByRole('link', { name: 'Tauchturm Hallenbad' }).click();
  await expect(page.locator('.site-origin')).toContainText('From SSI: 7002');
  await expect(page.locator('.site-origin').getByRole('link')).toHaveCount(0);
  // An artificial body of water says nothing about the water.
  await expect(page.locator('dl.facts')).toContainText('Water type');
  await expect(page.locator('dl.facts')).not.toContainText('Salt water');
  await expectGoodPage(page, 'Tauchturm Hallenbad');
});

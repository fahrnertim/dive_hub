// Dive sites in a real browser (ADR 0020). One story in order: a dive recorded with a position gets a
// new site made from that position; the logbook filters by it; dive 42 (no position) picks a site by
// searching; the Dive sites page creates, edits and deletes a site.
// Fixture: e2e/fixtures/sited-computer.fit (apps/server/test/fixtures/write-sited-fixture.ts).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, activeResultShown, diveRows, expectGoodPage, resetDive, seededDiveId, setPreferences } from './support.ts';

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

test('a dive with a position: a new dive site is made from it and chosen', { tag: ['@sites', '@dives'] }, async ({ page }) => {
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
  await expect(diveRows(page)).toHaveCount(1); // dive 7
  await expect(diveRows(page).getByRole('link', { name: 'Lighthouse' })).toBeVisible();
  await page.getByRole('link', { name: 'Show all dives' }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('a dive without a position picks a site from the results while typing, and can go back to none', { tag: ['@sites', '@dives'] }, async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Choose dive site' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dive site' });
  const search = dialog.getByRole('searchbox', { name: 'Find a dive site' });
  await expect(search).toBeFocused();
  await search.fill('lighth');
  // The results follow the typing, with how many match; the typed part of each name is marked.
  await expect(dialog.getByRole('status')).toHaveText('1 dive site matches “lighth”.');
  const option = dialog.getByRole('option', { name: /^Lighthouse/ });
  await expect(option.locator('mark')).toHaveText('Lighth');
  await activeResultShown(search);
  await expectGoodPage(page, 'Dive 42');
  // Arrow keys move through the results while the focus stays in the field; Enter picks and saves.
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('dl.facts').first().getByRole('link', { name: 'Lighthouse' })).toBeVisible();

  await page.getByRole('button', { name: 'Change dive site' }).click();
  await expect(dialog.getByRole('option', { name: /Lighthouse/ })).toContainText('current');
  await dialog.getByRole('button', { name: 'Remove dive site' }).click();
  await expect(page.getByRole('button', { name: 'Choose dive site' })).toBeVisible();
});

test('a search without results offers to create the site, with the name filled in', { tag: ['@sites', '@dives'] }, async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Choose dive site' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dive site' });
  await dialog.getByRole('searchbox', { name: 'Find a dive site' }).fill('Nowhere Pinnacle');
  await expect(dialog.getByRole('status')).toHaveText('No dive sites match “Nowhere Pinnacle”.');
  await dialog.getByRole('option', { name: 'Create “Nowhere Pinnacle” as a new dive site' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Nowhere Pinnacle');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('the Dive sites page creates, edits and deletes a site', { tag: ['@sites'] }, async ({ page }) => {
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
  // The list, not the announcement ("Blue Hole deleted.") that the live region keeps for a while.
  await expect(page.getByRole('link', { name: 'Blue Hole' })).toHaveCount(0);
});

test('a site with dives says why it can\'t be deleted', { tag: ['@sites'] }, async ({ page }) => {
  await page.goto('/#/sites');
  await page.getByRole('link', { name: 'Lighthouse' }).click();
  await expect(page.getByText('Dives are at this dive site, so it can’t be deleted.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^More actions/ })).toHaveCount(0);
});

test('a duplicate close by is merged into the site (ADR 0022)', { tag: ['@sites'] }, async ({ page, request }) => {
  const lighthouse = (await (await request.get('/api/dive-sites?q=Lighthouse')).json()).sites.find((s: { name: string }) => s.name === 'Lighthouse');
  const duplicate = await (await request.post('/api/dive-sites', {
    headers, data: { name: 'Light House', position: { latitude: 28.5007, longitude: 34.5197 }, maxDepthM: 18 },
  })).json() as { id: string };

  await page.goto(`/#/sites/${lighthouse.id}`);
  await expect(page.getByRole('heading', { name: 'Close by' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Light House' })).toBeVisible();
  await page.getByRole('button', { name: 'Merge into this site: Light House' }).click();
  const dialog = page.getByRole('dialog', { name: 'Merge Light House into Lighthouse?' });
  await expect(dialog).toContainText('Light House disappears, and its links lead here.');
  await expect(dialog).toContainText('its empty fields take Maximum depth from there');
  await expect(dialog).toContainText('This can’t be undone.');
  await expectGoodPage(page, 'Lighthouse');
  await dialog.getByRole('button', { name: 'Merge' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('dl.facts')).toContainText('18 m');
  await expect(page.getByRole('heading', { name: 'Close by' })).toHaveCount(0);
  await expect(page.locator('.history > li').first()).toContainText('Light House merged into this site');

  // The duplicate's link leads to the kept site.
  await page.goto(`/#/sites/${duplicate.id}`);
  await expect(page.getByRole('heading', { name: 'Lighthouse', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/sites/${lighthouse.id}$`));
});

test('the Dive sites list pages, sorts and filters, keeping it in the address', { tag: ['@sites'] }, async ({ page, request }) => {
  for (let i = 1; i <= 55; i++) {
    await request.post('/api/dive-sites', { headers, data: { name: `Test Pinnacle ${String(i).padStart(2, '0')}`, country: 'PW' } });
  }
  await page.goto('/#/sites');
  await expect(page.getByText(/^1–50 of \d+ dive sites$/)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/#\/sites\?page=2$/);
  await expect(page.getByText(/^51–\d+ of \d+ dive sites$/)).toBeVisible();

  await page.getByRole('button', { name: 'Country' }).click();
  await page.getByRole('option', { name: 'Palau' }).click();
  await expect(page).toHaveURL(/#\/sites\?country=PW$/);
  await expect(page.getByText('1–50 of 55 dive sites')).toBeVisible();
  await page.getByRole('button', { name: 'Name' }).click();
  await expect(page).toHaveURL(/country=PW&sort=name&order=desc|country=PW&order=desc/);
  await expect(page.getByRole('row').nth(1)).toContainText('Test Pinnacle 55');

  await page.getByText('Only sites with my dives').click();
  await expect(page.getByText('No dive sites match these filters.')).toBeVisible();
  await expectGoodPage(page, 'Dive sites');
  await page.goBack();
  await expect(page.getByRole('row').nth(1)).toContainText('Test Pinnacle 55');
});

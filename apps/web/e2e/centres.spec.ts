// Dive centres and their SSI verification codes in a real browser (ADR 0043). One story in order: a centre is created
// from the text of its code; a Dive site is added to it; dive 42 at that site shows the centre's code; the site's page
// names the centre and takes it away again, and the code is gone from the dive.
// The centre number and name are made up: no real centre's code is in this repository.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, expectGoodPage, openLine, resetDive, seededDiveId, setPreferences, uniqueWord } from './support.ts';

test.describe.configure({ mode: 'serial' });

const headers = { origin: E2E_BASE_URL };
const CENTRE = 'Example Divers GmbH, Musterstadt';
// Shown without the town SSI puts after the comma; the whole name is what is edited and what the code holds.
const SHOWN = 'Example Divers GmbH';
const CODE = `center;700001;name:${CENTRE}`;
const siteName = `Centre Reef ${uniqueWord()}`;
let diveId: string;
let siteId: string;

/** Deletes the centres an earlier run of this story left behind. */
async function forgetCentres(api: APIRequestContext) {
  const { centres } = await (await api.get('/api/dive-centres?q=Example+Divers')).json() as { centres: { id: string }[] };
  for (const c of centres) await api.delete(`/api/dive-centres/${c.id}`, { headers });
}

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
  await forgetCentres(request);
  diveId = await seededDiveId(request);
  siteId = (await (await request.post('/api/dive-sites', { headers, data: { name: siteName } })).json()).id;
  const dive = await (await request.get(`/api/dives/${diveId}`)).json() as { version: number };
  await request.patch(`/api/dives/${diveId}`, { headers, data: { version: dive.version, siteId } });
});

test.afterAll(async ({ request }) => {
  await forgetCentres(request);
  // Later specs expect dive 42 without a site.
  const dive = await (await request.get(`/api/dives/${diveId}`)).json() as { version: number };
  await request.patch(`/api/dives/${diveId}`, { headers, data: { version: dive.version, siteId: null } });
  await request.delete(`/api/dive-sites/${siteId}`, { headers });
  await resetDive(request);
});

test('a dive centre is created from the text of its code, and shows the code', { tag: ['@sites'] }, async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Dive centres' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dive centres' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Dive centres' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'New dive centre' }).click();
  // A diver's code is told apart, and nothing of it is taken.
  const code = page.getByRole('textbox', { name: 'Text of the centre’s SSI code (optional)' });
  await code.fill('buddy;1234567;firstName:Erika;lastName:Example;email:erika@example.com');
  await page.getByRole('button', { name: 'Read code' }).click();
  await expect(page.getByText('This is a diver’s buddy code, not a dive centre’s.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('');

  await code.fill(CODE);
  await page.getByRole('button', { name: 'Read code' }).click();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(CENTRE);
  await expect(page.getByRole('textbox', { name: 'SSI centre number (optional)' })).toHaveValue('700001');
  await expectGoodPage(page, 'Dive centres');
  await page.getByRole('button', { name: 'Create dive centre' }).click();

  await expect(page.getByRole('heading', { level: 1, name: SHOWN })).toBeVisible();
  await expect(page.getByRole('img', { name: `SSI verification code of ${SHOWN}` })).toBeVisible();
  await expect(page.locator('dl.facts')).toContainText('700001');
  await expect(page.locator('dl.facts')).toContainText(CENTRE);
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(CENTRE);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expectGoodPage(page, SHOWN);

  // The same number a second time: the centre that has it is named.
  await page.goto('/#/centres');
  await expect(page.getByRole('link', { name: SHOWN })).toBeVisible();
  await page.getByRole('button', { name: 'New dive centre' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Example Divers again');
  await page.getByRole('textbox', { name: 'SSI centre number (optional)' }).fill('700001');
  await page.getByRole('button', { name: 'Create dive centre' }).click();
  await expect(page.getByText('Another dive centre already has this number.')).toBeVisible();
  await expect(page.getByRole('link', { name: `Open ${CENTRE}` })).toBeVisible();
});

test('a dive at one of the centre’s dive sites shows the centre’s code', { tag: ['@sites', '@dives'] }, async ({ page }) => {
  await page.goto('/#/centres');
  await page.getByRole('link', { name: SHOWN }).click();
  await page.getByRole('button', { name: 'Add dive site' }).click();
  const dialog = page.getByRole('dialog', { name: `Add a dive site to ${SHOWN}` });
  await dialog.getByRole('searchbox', { name: 'Find a dive site' }).fill(siteName);
  await dialog.getByRole('option', { name: new RegExp(`^${siteName}`) }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name: siteName })).toBeVisible();
  await expectGoodPage(page, SHOWN);

  await page.goto(`/#/dives/${diveId}`);
  await openLine(page, 'Verification code');
  await expect(page.getByRole('img', { name: `SSI verification code of ${SHOWN}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'To the dive centre' })).toBeVisible();
  await expectGoodPage(page, 'Dive 42');
});

test('the dive site names its centres; without the centre, the dive shows no code', { tag: ['@sites', '@dives'] }, async ({ page }) => {
  await page.goto(`/#/sites/${siteId}`);
  const panel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Dive centres' }) });
  await expect(panel.getByRole('link', { name: SHOWN })).toBeVisible();
  await expect(panel).toContainText('SSI code');
  await expectGoodPage(page, siteName);
  await panel.getByRole('button', { name: `Remove: ${SHOWN}` }).click();
  await expect(panel).toContainText('No dive centre yet.');

  await page.goto(`/#/dives/${diveId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verification code', exact: true })).toHaveCount(0);

  // Adding it back from the site's page.
  await page.goto(`/#/sites/${siteId}`);
  await panel.getByRole('button', { name: 'Add dive centre' }).click();
  const dialog = page.getByRole('dialog', { name: `Add a dive centre to ${siteName}` });
  await dialog.getByRole('searchbox', { name: 'Find a dive centre' }).fill('Example Divers');
  await dialog.getByRole('option', { name: new RegExp(`^${SHOWN}`) }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel.getByRole('link', { name: SHOWN })).toBeVisible();
});

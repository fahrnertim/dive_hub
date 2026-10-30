// The hint on the Dive's form (ADR 0031, slice 20d) in a real browser: what the Diver carried the last time with the suit
// being chosen, from the lead estimate. It asks only with a site that has a water type, a suit and a Cylinder with a size,
// is absent without an earlier Dive with this suit, and fills nothing in.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_BASE_URL, resetDive, setPreferences, tankPodDive } from './support.ts';

const headers = { origin: E2E_BASE_URL };
const NOTHING = { lead: [], suit: null, weightingFeedback: null, cylinders: [] };

test.describe.configure({ mode: 'serial' });

const getDive = async (api: APIRequestContext, id: string) => (await (await api.get(`/api/dives/${id}`)).json()) as { version: number; site: { id: string } | null };
async function patchDive(api: APIRequestContext, id: string, values: object) {
  const { version } = await getDive(api, id);
  expect((await api.patch(`/api/dives/${id}`, { data: { version, ...values }, headers })).status()).toBe(200);
}
async function choose(page: Page, label: RegExp, option: string) {
  await page.getByRole('button', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
const hint = (page: Page) => page.getByTestId('lead-hint');

let diveId: string;
let earlierId: string;
let siteId: string;
let earlierSiteBefore: string | null;

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: 'en', units: 'metric' });
  diveId = (await resetDive(request)).id;
  earlierId = await tankPodDive(request);
  earlierSiteBefore = (await getDive(request, earlierId)).site?.id ?? null;
  siteId = ((await (await request.post('/api/dive-sites', { data: { name: 'Lead hint reef', waterType: 'salt' }, headers })).json()) as { id: string }).id;
  await patchDive(request, earlierId, {
    siteId, suit: { type: 'wetsuit', thicknessMm: 5, hood: false }, lead: [{ amountKg: 8, placement: 'belt' }], weightingFeedback: { felt: 'right' },
  });
});
test.afterAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
  // Only what beforeAll set: the tank pod dive keeps its Cylinder, which other specs read.
  const { cylinders: _kept, ...setBefore } = NOTHING;
  await patchDive(request, earlierId, { ...setBefore, siteId: earlierSiteBefore });
  await patchDive(request, diveId, { ...NOTHING, siteId: null });
  expect((await request.delete(`/api/dive-sites/${siteId}`, { headers })).status()).toBeLessThan(300);
});

async function openForm(page: Page, request: APIRequestContext, site: string | null) {
  await patchDive(request, diveId, { ...NOTHING, siteId: site, cylinders: [{ volumeL: 12, material: 'steel', gas: { o2: 21, he: 0 } }] });
  await page.goto(`/#/dives/${diveId}`);
  await page.reload(); // the page may hold the dive from before the patch
  await page.getByRole('button', { name: 'Edit dive' }).click();
}

test('names what was carried last time with this suit; nothing is filled in', { tag: ['@dives'] }, async ({ page, request }) => {
  await openForm(page, request, siteId);
  await expect(hint(page)).toHaveCount(0);
  await choose(page, /Suit$/, 'Wetsuit');
  await page.getByRole('textbox', { name: 'Thickness' }).fill('5');
  await choose(page, /Hood$/, 'Without hood');
  await expect(hint(page)).toContainText('Last time with this suit: 8 kg, felt right.');
  await expect(hint(page).getByRole('link', { name: 'Open that dive' })).toHaveAttribute('href', `#/dives/${earlierId}`);
  await expect(hint(page).getByRole('link', { name: /Starting point and range/ })).toHaveAttribute('href', /^#\/tools\/lead\?.*lw=salt.*suit=wetsuit/);
  await expect(page.getByRole('textbox', { name: 'Lead' })).toHaveValue('');
  await expect(page.getByRole('button', { name: /The weighting felt$/ })).toContainText('Not said');
});

test('absent: no earlier dive with this suit or no site water type', { tag: ['@dives'] }, async ({ page, request }) => {
  await openForm(page, request, siteId);
  await choose(page, /Suit$/, 'Drysuit');
  await expect(page.getByRole('textbox', { name: 'Lead' })).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
  // The same suit, but a dive with no site has no water to ask for.
  await choose(page, /Suit$/, 'Wetsuit');
  await page.getByRole('textbox', { name: 'Thickness' }).fill('5');
  await choose(page, /Hood$/, 'Without hood');
  await expect(hint(page)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Discard changes' }).click(); // the unsaved suit
  await openForm(page, request, null);
  await choose(page, /Suit$/, 'Wetsuit');
  await page.getByRole('textbox', { name: 'Thickness' }).fill('5');
  await choose(page, /Hood$/, 'Without hood');
  await expect(page.getByRole('textbox', { name: 'Lead' })).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
});

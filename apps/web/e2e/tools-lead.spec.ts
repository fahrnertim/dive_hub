// The Tools page's lead calculator (ADR 0031, slice 20c) in a real browser: the planned conditions in the address, the
// answer with its range and reasons, what is missing, and the weight check that is on the page in every state. The
// numbers are the server's (lead-estimate*.test.ts); here: what the page asks, shows and says.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_BASE_URL, seededDiveId, setPreferences } from './support.ts';

const headers = { origin: E2E_BASE_URL };
const WEIGHT_DATE = '2026-09-15';
const NOTHING = { lead: [], suit: null, weightingFeedback: null };

test.describe.configure({ mode: 'serial' });

type Dive = { id: string; version: number; site: { id: string } | null };
const getDive = async (api: APIRequestContext, id: string) => (await (await api.get(`/api/dives/${id}`)).json()) as Dive;
const ownDiver = async (api: APIRequestContext) => ((await (await api.get('/api/divers')).json()) as { id: string; isOwn: boolean }[]).find((d) => d.isOwn)!;
async function patchDive(api: APIRequestContext, id: string, values: object) {
  const { version } = await getDive(api, id);
  expect((await api.patch(`/api/dives/${id}`, { data: { version, ...values }, headers })).status()).toBe(200);
}
const estimate = (page: Page) => page.getByRole('region', { name: 'Lead estimate' });
const check = (page: Page) => page.getByRole('region', { name: 'Weight check' });

let diverId: string;
let diveId: string;
let siteBefore: string | null;

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: 'en', units: 'metric' });
  diverId = (await ownDiver(request)).id;
  diveId = await seededDiveId(request);
  siteBefore = (await getDive(request, diveId)).site?.id ?? null;
  await request.delete(`/api/divers/${diverId}/body-weights/${WEIGHT_DATE}`, { headers });
});
test.afterAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
  await request.delete(`/api/divers/${diverId}/body-weights/${WEIGHT_DATE}`, { headers });
  await patchDive(request, diveId, { ...NOTHING, siteId: siteBefore });
});

test('empty: says what to choose, and the weight check is already there', { tag: ['@tools'] }, async ({ page }) => {
  await page.goto('/#/tools/lead');
  await expect(page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Lead' })).toHaveAttribute('aria-current', 'page');
  await expect(estimate(page).getByText(/^Choose the water, the suit and the size of at least one cylinder/)).toBeVisible();
  await expect(page.getByTestId('lead-total')).toHaveCount(0);
  await expect(check(page).getByText('Float at eye level with an empty BC.')).toBeVisible();
  await expect(check(page).getByText(/^Hover neutral at 5 m with 50 bar left in the cylinder\.$/)).toBeVisible();
  await expect(page.locator('#main').getByText(/estimate, not advice/i)).toBeVisible();
});

test('no dive with the suit and no body weight: no number, the way to add one, the weight check', { tag: ['@tools'] }, async ({ page }) => {
  await page.goto('/#/tools/lead?lw=salt&suit=skin&cyl=11.1%7Ealuminium');
  await expect(estimate(page).getByText('No number yet')).toBeVisible();
  await expect(page.getByTestId('lead-total')).toHaveCount(0);
  await expect(estimate(page).getByRole('link', { name: 'Add body weight on the Divers page' })).toHaveAttribute('href', '#/divers');
  await expect(check(page).getByText('Float at eye level with an empty BC.')).toBeVisible();
});

test('a rule of thumb from the body weight: the number with its range, confidence, each adjustment and the reserve', { tag: ['@tools'] }, async ({ page, request }) => {
  expect((await request.put(`/api/divers/${diverId}/body-weights/${WEIGHT_DATE}`, { data: { kg: 80 }, headers })).status()).toBe(204);
  await page.goto('/#/tools/lead?lw=salt&suit=skin&cyl=11.1%7Ealuminium');
  await expect(page.getByTestId('lead-total')).toHaveText(/^\d+(\.\d)? kg$/);
  await expect(page.getByTestId('lead-range')).toHaveText(/^Range \d+(\.\d)? kg to \d+(\.\d)? kg$/);
  await expect(estimate(page).getByText('Confidence: low')).toBeVisible();
  await expect(estimate(page).getByText(/^No dive with this suit\. A rule of thumb for the body weight gives .* a first guess\.$/)).toBeVisible();
  await expect(estimate(page).getByText(/^Cylinder: [+−]?[\d.]+ kg\./)).toBeVisible();
  await expect(estimate(page).getByText(/^Water, salt water: [+−]?[\d.]+ kg\./)).toBeVisible();
  await expect(estimate(page).getByText(/^For neutral buoyancy at 5 m with \d+ bar left in the cylinder \(/)).toBeVisible();
  await expect(estimate(page).getByText(/not a certain number/)).toBeVisible();
  await expect(check(page).getByText('Float at eye level with an empty BC.')).toBeVisible();
});

test('the form: water, suit with its own fields and a catalogue cylinder fill the address and the answer', { tag: ['@tools'] }, async ({ page }) => {
  await page.goto('/#/tools/lead');
  await expect(page.getByRole('textbox', { name: /^Thickness/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Water$/ }).click();
  await page.getByRole('option', { name: 'Fresh water', exact: true }).click();
  await page.getByRole('button', { name: /Suit$/ }).click();
  await page.getByRole('option', { name: 'Wetsuit', exact: true }).click();
  await page.getByRole('textbox', { name: /^Thickness/ }).fill('5');
  await page.getByRole('button', { name: /Hood$/ }).click();
  await page.getByRole('option', { name: 'With hood', exact: true }).click();
  await page.getByRole('button', { name: /Fill in from a common cylinder/ }).click();
  await page.getByRole('option').filter({ hasText: /Steel/ }).first().click();
  await expect(page).toHaveURL(/#\/tools\/lead\?.*lw=fresh.*suit=wetsuit.*mm=5.*hood=1.*cyl=[\d.]+%7Esteel/);
  await expect(page.getByTestId('lead-total')).toBeVisible();
  await expect(estimate(page).getByText(/^Water, fresh water: /)).toBeVisible();

  await page.getByRole('button', { name: 'Add cylinder' }).click();
  await expect(page.getByRole('group', { name: 'Cylinder 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove cylinder 2' }).click();
  await expect(page.getByRole('group', { name: 'Cylinder 2' })).toHaveCount(0);

  // A reload brings the same page back from the address; going to another part and back keeps what was typed.
  await page.reload();
  await expect(page.getByTestId('lead-total')).toBeVisible();
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Gas plan' }).click();
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Lead' }).click();
  await expect(page).toHaveURL(/lw=fresh/);
});

test('imperial: amounts in pounds, the address in the same units as ever', { tag: ['@tools'] }, async ({ page, request }) => {
  await setPreferences(request, { units: 'imperial' });
  await page.goto('/#/tools/lead?lw=salt&suit=skin&cyl=11.1%7Ealuminium');
  await expect(page.getByTestId('lead-total')).toHaveText(/^\d+(\.\d)? lb$/);
  await expect(page.getByTestId('lead-range')).toHaveText(/lb to .* lb$/);
  await expect(check(page).getByText(/left in the cylinder\.$/)).toContainText('psi');
  await setPreferences(request, { units: 'metric' });
});

test('a dive with lead and a suit but no site is left out, with the way to fix it; with a salt site it is the basis', { tag: ['@tools'] }, async ({ page, request }) => {
  const url = '/#/tools/lead?lw=salt&suit=wetsuit&mm=5&hood=0&cyl=11.1%7Ealuminium';
  const site = (await (await request.post('/api/dive-sites', { data: { name: 'Lead test reef', waterType: 'salt' }, headers })).json()) as { id: string };
  const values = { lead: [{ amountKg: 8, placement: 'belt' }], suit: { type: 'wetsuit', thicknessMm: 5, hood: false, undergarment: null }, weightingFeedback: { felt: 'right', amountKg: null } };

  await patchDive(request, diveId, { ...values, siteId: null });
  await page.goto(url);
  await expect(estimate(page).getByText(/^1 dive with lead and a suit was left out because its site has no water type/)).toBeVisible();
  await expect(estimate(page).getByRole('link', { name: 'Go to the sites' })).toHaveAttribute('href', '#/sites');
  await expect(estimate(page).getByText(/^Based on/)).toHaveCount(0);

  await patchDive(request, diveId, { siteId: site.id });
  await page.reload();
  await expect(estimate(page).getByText(/^Based on 1 of .+’s dives with this suit:$/)).toBeVisible();
  const row = estimate(page).getByRole('listitem').filter({ hasText: 'carried' });
  await expect(row).toContainText('carried 8 kg, needed 8 kg');
  await expect(row.getByRole('link')).toHaveAttribute('href', `#/dives/${diveId}`);
  // The dive has no cylinder logged: the answer says so and links to it.
  await expect(estimate(page).getByText(/^1 dive used has no cylinder logged/)).toBeVisible();
  await expect(estimate(page).getByText('Confidence: low')).toHaveCount(0);
  await expect(page.getByTestId('lead-total')).toBeVisible();
  await expect(check(page).getByText('Float at eye level with an empty BC.')).toBeVisible();

  await patchDive(request, diveId, { ...NOTHING, siteId: siteBefore });
  expect((await request.delete(`/api/dive-sites/${site.id}`, { headers })).status()).toBeLessThan(300);
});

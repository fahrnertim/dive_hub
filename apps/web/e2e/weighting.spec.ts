// Exposure suit, Lead and weighting feedback on a Dive in a real browser (ADR 0031, slice A): typed in the Dive's
// form, shown as facts and in the history, copied from the last dive, and in pounds for imperial.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_BASE_URL, openLine, resetDive, setPreferences, tankPodDive } from './support.ts';

const headers = { origin: E2E_BASE_URL };
type Dive = { id: string; version: number; lead: object[]; suit: object | null; weightingFeedback: object | null };
const NOTHING = { lead: [], suit: null, weightingFeedback: null };

const getDive = async (api: APIRequestContext, id: string) => (await (await api.get(`/api/dives/${id}`)).json()) as Dive;
async function setWeighting(api: APIRequestContext, id: string, values: object) {
  const { version } = await getDive(api, id);
  expect((await api.patch(`/api/dives/${id}`, { data: { version, ...values }, headers })).status()).toBe(200);
}
/** Picks an option of one of the form's selects, named by its label. */
async function choose(page: Page, label: string | RegExp, option: string) {
  await page.getByRole('button', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
const fact = (page: Page, label: string) => page.locator('dl.facts > div').filter({ has: page.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }) }).getByRole('definition');

let diveId: string;

test.beforeEach(async ({ request }) => {
  diveId = (await resetDive(request)).id;
  await setWeighting(request, diveId, NOTHING);
});
test.afterEach(async ({ request }) => {
  await setWeighting(request, diveId, NOTHING);
  await setPreferences(request, { language: null, units: null });
});

test('adds suit, lead and how the weighting felt from the facts: saved, shown and in the history', { tag: ['@dives'] }, async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Add suit and lead' }).click();
  await expect(page.getByRole('textbox', { name: 'Lead' })).toBeFocused();

  // A suit's own fields come with its type.
  await expect(page.getByRole('textbox', { name: 'Thickness' })).toHaveCount(0);
  await choose(page, /Suit$/, 'Wetsuit');
  await page.getByRole('textbox', { name: 'Thickness' }).fill('7');
  await choose(page, /Hood$/, 'With hood');

  await page.getByRole('textbox', { name: 'Lead' }).fill('6');
  await choose(page, /Where lead 1 was carried$/, 'Belt');
  await page.getByRole('button', { name: 'Add lead' }).click();
  await page.getByRole('textbox', { name: 'Lead 2' }).fill('2');
  await choose(page, /Where lead 2 was carried$/, 'Trim');
  await expect(page.getByText('Total: 8 kg')).toBeVisible();

  // By how much only for weighting that was off.
  await expect(page.getByRole('textbox', { name: 'By how much' })).toHaveCount(0);
  await choose(page, /The weighting felt$/, 'Too heavy');
  await page.getByRole('textbox', { name: 'By how much' }).fill('1');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(fact(page, 'Suit')).toHaveText('Wetsuit, 7 mm, with hood');
  await expect(fact(page, 'Lead')).toHaveText('8 kg (6 kg on a belt, 2 kg trim)');
  await expect(fact(page, 'Weighting')).toHaveText('Too heavy by 1 kg');
  await expect(page.getByRole('button', { name: 'Add suit and lead' })).toHaveCount(0);
  await openLine(page, 'History');
  const latest = page.locator('.history > li').first();
  await expect(latest).toContainText('Suit: Wetsuit, 7 mm, with hood');
  await expect(latest).toContainText('Lead: 8 kg (6 kg on a belt, 2 kg trim)');
  await expect(latest).toContainText('Weighting: Too heavy by 1 kg');
});

test('"Same as last dive" fills the suit and the lead of the last dive, not how its weighting felt; nothing is saved until Save', { tag: ['@dives'] }, async ({ page, request }) => {
  // The Dive before the seeded one (2026) is the one with the tank pod (2025), unless another test put one between.
  await tankPodDive(request);
  const last = (await (await request.get(`/api/dives/${diveId}/same-as-last`)).json()) as { diveId: string };
  await setWeighting(request, last.diveId, {
    lead: [{ amountKg: 10, placement: 'integrated' }], suit: { type: 'drysuit', undergarment: 'heavy', hood: true }, weightingFeedback: { felt: 'too_light', amountKg: 2 },
  });
  try {
    await page.goto(`/#/dives/${diveId}`);
    await page.getByRole('button', { name: 'Add suit and lead' }).click();
    await page.getByRole('button', { name: 'Same as last dive' }).click();
    await expect(page.getByRole('textbox', { name: 'Lead' })).toHaveValue('10');
    await expect(page.getByRole('button', { name: /Suit$/ })).toContainText('Drysuit');
    await expect(page.getByRole('button', { name: /Undergarment$/ })).toContainText('Heavy');
    await expect(page.getByRole('button', { name: /The weighting felt$/ })).toContainText('Not said');
    expect(await getDive(request, diveId)).toMatchObject(NOTHING);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(fact(page, 'Suit')).toHaveText('Drysuit, heavy undergarment, with hood');
    await expect(fact(page, 'Lead')).toHaveText('10 kg integrated');
    await expect(page.getByRole('term').filter({ hasText: /^Weighting$/ })).toHaveCount(0);
  } finally {
    await setWeighting(request, last.diveId, NOTHING);
  }
});

test('lead is in pounds for imperial, an amount nobody touched stays as it was, and 0 says the dive had no lead', { tag: ['@dives'] }, async ({ page, request }) => {
  await setWeighting(request, diveId, { lead: [{ amountKg: 8, placement: 'belt' }], weightingFeedback: { felt: 'right' } });
  await setPreferences(request, { units: 'imperial' });
  await page.goto(`/#/dives/${diveId}`);
  await expect(fact(page, 'Lead')).toHaveText('17.6 lb on a belt');
  await expect(fact(page, 'Weighting')).toHaveText('Felt right');
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await expect(page.getByRole('textbox', { name: 'Lead (lb)' })).toHaveValue('17.6');
  await page.getByRole('textbox', { name: 'Notes' }).fill('Shore dive');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Shore dive')).toBeVisible();
  expect((await getDive(request, diveId)).lead).toEqual([{ amountKg: 8, placement: 'belt' }]);

  await page.getByRole('button', { name: 'Edit dive' }).click();
  await page.getByRole('textbox', { name: 'Lead (lb)' }).fill('0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(fact(page, 'Lead')).toHaveText('No lead');
  expect((await getDive(request, diveId)).lead).toEqual([{ amountKg: 0, placement: 'belt' }]);
});

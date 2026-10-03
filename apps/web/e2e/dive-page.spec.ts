// The dive page in a real browser (ADR 0015): reading a Dive, editing it, going back to the
// recording's values, switching the Primary recording, the history, other languages and units.
import { expect, test } from '@playwright/test';
import { editElsewhere, resetDive, setPreferences } from './support.ts';

let diveId: string;

test.beforeEach(async ({ request }) => {
  diveId = (await resetDive(request)).id;
});

test('shows the dive with the recording\'s values, the device data and how it came to be', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Jan 15, 2026/ }).click();
  await expect(page.getByRole('heading', { name: /Dive 42/ })).toBeVisible();
  const facts = page.locator('dl.facts').first();
  await expect(facts).toContainText('18.5 m');
  await expect(facts).toContainText('30 min');
  await expect(facts).toContainText('Salt water');
  await expect(page.getByText('edited')).toHaveCount(0);
  await expect(page.getByText('Bühlmann ZHL-16C, GF 40/85')).toBeVisible();
  await expect(page.getByText('Created from an import')).toBeVisible();
  // The depth profile was drawn (its canvas exists and the page didn't fail).
  await expect(page.getByRole('img', { name: 'Depth profile' }).locator('canvas').first()).toBeVisible();
});

test('edits values and notes, marks them as edited and records the change', async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await page.getByRole('textbox', { name: 'Max depth' }).fill('19.2');
  await page.getByRole('textbox', { name: 'Notes' }).fill('Turtle at the wreck');
  await page.getByRole('button', { name: 'Save' }).click();

  const facts = page.locator('dl.facts').first();
  await expect(facts).toContainText('19.2 m');
  await expect(facts.getByText('edited')).toHaveCount(1);
  await expect(page.getByText('Turtle at the wreck')).toBeVisible();
  const latest = page.locator('.history > li').first();
  await expect(latest).toContainText('Edited');
  await expect(latest).toContainText('Max depth: 18.5 m → 19.2 m (set by hand)');
  await expect(latest).toContainText('Notes changed');
});

test('goes back to the recording\'s value', async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await page.getByRole('textbox', { name: 'Max depth' }).fill('25');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('dl.facts').first()).toContainText('25 m');

  await page.getByRole('button', { name: 'Edit dive' }).click();
  await page.getByRole('button', { name: /Use the recording’s value \(18\.5 m\)/ }).click();
  await expect(page.getByText('Goes back to 18.5 m when you save')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('dl.facts').first()).toContainText('18.5 m');
  await expect(page.locator('dl.facts').first().getByText('edited')).toHaveCount(0);
  await expect(page.locator('.history > li').first()).toContainText('(back to the recording)');
});

test('switches the Primary recording; values without Override follow it', async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('radio', { name: /Recording 2/ }).click();
  await page.getByRole('button', { name: 'Make this the primary recording' }).click();
  await expect(page.locator('dl.facts').first()).toContainText('29 min');
  await expect(page.getByRole('radio', { name: 'Recording 2 (primary)' })).toBeVisible();
  await expect(page.locator('.history > li').first()).toContainText('Primary recording changed');
});

test('refuses to overwrite a change made elsewhere meanwhile', async ({ page, request }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await editElsewhere(request, diveId, 'Written on the phone');
  await page.getByRole('textbox', { name: 'Notes' }).fill('Written on the laptop');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This dive was changed meanwhile.')).toBeVisible();
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByText('Written on the phone')).toBeVisible();
});

test('speaks German and works in feet, including typing a decimal comma', async ({ page, request }) => {
  await setPreferences(request, { language: 'de', units: 'imperial' });
  await page.goto(`/#/dives/${diveId}`);
  await expect(page.getByRole('heading', { name: /Tauchgang 42/ })).toBeVisible();
  await expect(page.locator('dl.facts').first()).toContainText('60,7 ft');
  await expect(page.locator('dl.facts').first()).toContainText('Salzwasser');

  await page.getByRole('button', { name: 'Tauchgang bearbeiten' }).click();
  await page.getByRole('textbox', { name: 'Maximaltiefe' }).fill('65,6');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('dl.facts').first()).toContainText('65,6 ft');
  // Stored in metres: 65.6 ft = 20.0 m.
  const dive = await (await request.get(`/api/dives/${diveId}`)).json();
  expect(dive.values.maxDepthM).toBeCloseTo(19.995, 2);
});

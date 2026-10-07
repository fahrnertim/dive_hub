// The dive page in a real browser (ADR 0015): reading a Dive (its facts and profile in one panel, the rest a step
// away), editing it, going back to the recording's values, switching the Primary recording, the history, other
// languages and units.
import { expect, test } from '@playwright/test';
import { editElsewhere, openLine, resetDive, setPreferences } from './support.ts';

let diveId: string;

test.beforeEach(async ({ request }) => {
  diveId = (await resetDive(request)).id;
});

test('shows the dive with the recording\'s values, the device data and how it came to be', { tag: ['@dives'] }, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Jan 15, 2026, 11:00 AM (UTC+2)' }).click();
  await expect(page.getByRole('heading', { name: /Dive 42/ })).toBeVisible();
  const facts = page.locator('dl.facts').first();
  await expect(facts).toContainText('18.5 m');
  await expect(facts).toContainText('30 min');
  // The water type is the dive site's (ADR 0025); the computer's own setting is with its data.
  await expect(facts).toContainText('Choose a dive site, and the dive takes its water type.');
  // In the facts only: the history may say "Edited" when other specs changed this Dive on this server before.
  await expect(page.locator('dl.facts').first().getByText('edited')).toHaveCount(0);
  // The facts and the profile share one panel, so the profile is on the first screen. Who dived along and the notes
  // are facts too: empty, each is its own way in, not a panel.
  const panel = page.locator('section', { has: page.getByRole('img', { name: 'Depth profile' }) });
  await expect(panel).toContainText('18.5 m');
  await expect(facts).toContainText('GasEAN32');
  await expect(facts.getByRole('button', { name: 'Add someone' })).toBeVisible();
  await expect(facts.getByRole('button', { name: 'Add notes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Buddies and guides' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Notes' })).toHaveCount(0);
  // The tabs name the devices. Under the chart, one line says how it was recorded; the computer's other values are a
  // step away.
  await expect(panel.getByRole('tab', { name: 'Garmin Descent Mk3 (111) (primary)' })).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: 'Bühlmann ZHL-16C, GF 40/85' })).toBeVisible();
  await expect(panel.getByText('Water setting on the computer')).toBeHidden();
  await panel.getByText('All values of the recording').click();
  await expect(panel.getByText('Salt water (1,025 kg/m³)')).toBeVisible();
  // The history is one line that says the latest change, until it is opened.
  const history = page.locator('section', { has: page.getByRole('heading', { name: 'History', exact: true }) });
  await expect(page.getByRole('button', { name: 'History', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(history.getByText(/ on \w+ \d+, \d{4}/)).toBeVisible();
  await expect(page.locator('.history > li').first()).toBeHidden();
  await openLine(page, 'History');
  // More than three entries hide behind "Show the whole history"; how many there are depends on what
  // other specs did on this server before (ADR 0023).
  // The button comes with the history: wait for the history before asking whether it is there.
  await expect(page.locator('.history > li').first()).toBeVisible();
  const showAll = page.getByRole('button', { name: 'Show the whole history' });
  if (await showAll.isVisible()) await showAll.click();
  await expect(page.getByText('Created from an import')).toBeVisible();
  // The depth profile was drawn (its canvas exists and the page didn't fail).
  await expect(page.getByRole('img', { name: 'Depth profile' }).locator('canvas').first()).toBeVisible();
});

test('edits values and notes, marks them as edited and records the change', { tag: ['@dives'] }, async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await page.getByRole('textbox', { name: 'Max depth' }).fill('19.2');
  await page.getByRole('textbox', { name: 'Notes' }).fill('Turtle at the wreck');
  await page.getByRole('button', { name: 'Save' }).click();

  const facts = page.locator('dl.facts').first();
  await expect(facts).toContainText('19.2 m');
  await expect(facts.getByText('edited')).toHaveCount(1);
  await expect(page.getByText('Turtle at the wreck')).toBeVisible();
  // With notes, they have their heading and paragraph, and the fact that offered to add them is gone.
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add notes' })).toHaveCount(0);
  await openLine(page, 'History');
  const latest = page.locator('.history > li').first();
  await expect(latest).toContainText('Edited');
  await expect(latest).toContainText('Max depth: 18.5 m → 19.2 m (set by hand)');
  await expect(latest).toContainText('Notes changed');
});

test('adds notes from the facts: the form opens at the notes', { tag: ['@dives'] }, async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Add notes' }).click();
  await expect(page.getByRole('textbox', { name: 'Notes' })).toBeFocused();
  await page.keyboard.type('Pike under the jetty');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Pike under the jetty')).toBeVisible();
});

test('goes back to the recording\'s value', { tag: ['@dives'] }, async ({ page }) => {
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
  await openLine(page, 'History');
  // Set by hand and back within minutes is one history entry with no net change to max depth.
  await expect(page.locator('.history > li').first()).not.toContainText('Max depth');
});

test('switches the Primary recording; values without Override follow it', { tag: ['@dives'] }, async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('tab', { name: /\(999\)/ }).click();
  await page.getByRole('button', { name: /^Recording actions/ }).click();
  await page.getByRole('menuitem', { name: 'Make this the primary recording' }).click();
  await expect(page.locator('dl.facts').first()).toContainText('29 min');
  await expect(page.getByRole('tab', { name: 'Garmin Descent Mk3 (999) (primary)' })).toBeVisible();
  await openLine(page, 'History');
  await expect(page.locator('.history > li').first()).toContainText('Primary recording changed');
});

test('refuses to overwrite a change made elsewhere meanwhile', { tag: ['@dives'] }, async ({ page, request }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await editElsewhere(request, diveId, 'Written on the phone');
  await page.getByRole('textbox', { name: 'Notes' }).fill('Written on the laptop');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This dive was changed meanwhile.')).toBeVisible();
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByText('Written on the phone')).toBeVisible();
});

test('speaks German and works in feet, including typing a decimal comma', { tag: ['@dives'] }, async ({ page, request }) => {
  await setPreferences(request, { language: 'de', units: 'imperial' });
  await page.goto(`/#/dives/${diveId}`);
  await expect(page.getByRole('heading', { name: /Tauchgang 42/ })).toBeVisible();
  await expect(page.locator('dl.facts').first()).toContainText('60,7 ft');
  await page.getByText('Alle Werte der Aufzeichnung').click();
  await expect(page.getByText('Salzwasser (1.025 kg/m³)')).toBeVisible();

  await page.getByRole('button', { name: 'Tauchgang bearbeiten' }).click();
  await page.getByRole('textbox', { name: 'Maximaltiefe' }).fill('65,6');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('dl.facts').first()).toContainText('65,6 ft');
  // Stored in metres: 65.6 ft = 20.0 m.
  const dive = await (await request.get(`/api/dives/${diveId}`)).json();
  expect(dive.values.maxDepthM).toBeCloseTo(19.995, 2);
});

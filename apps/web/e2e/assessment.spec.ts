// The dive assessment (ADR 0036) in a real browser: findings under the profile with their numbers, guidance, evidence
// and sources; the time lane; the ascent's colours in words; putting a finding aside and muting a rule; the list's mark.
import { expect, test } from '@playwright/test';
import { assessedDive, setPreferences } from './support.ts';

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});
test.afterEach(async ({ request }) => {
  await assessedDive(request);
});

test('shows a dive\'s findings as facts with guidance and sources, and on the profile', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await assessedDive(request);
  await page.goto(`/#/dives/${id}`);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Assessment', exact: true }) });
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Fast descent', 'High oxygen pressure', 'Fast ascent', 'Short safety stop', 'Flying after this dive']);
  // The no-fly time is information beside the findings, not one of them.
  await expect(panel.locator('ul.findings').getByRole('heading', { level: 3 })).toHaveCount(4);
  await expect(panel.getByText(/DAN’s guideline after a single dive without decompression stops: no flying for 12 hours, until /)).toBeVisible();

  const ascent = panel.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Fast ascent' }) });
  // What was measured, in the User's units; the guidance; how well founded it is; where it comes from.
  await expect(ascent).toContainText(/You ascended at up to 13 m\/min for \d+ s, from 39\.\d m to 5 m\./);
  await expect(ascent).toContainText('Tables and dive computers assume about 9 to 10 m/min');
  await expect(ascent).toContainText('experiments, agency or maker rule');
  await expect(ascent.getByRole('link', { name: /Carturan et al\. 2002/ })).toHaveAttribute('href', /europepmc/);
  await expect(ascent).toContainText('Start the ascent early enough');
  // No score, no verdict; the fixed note is there.
  await expect(panel).not.toContainText(/score|unsafe|dangerous/i);
  await expect(panel.getByText(/Not medical advice, and no measure of how safe a dive was/)).toBeVisible();

  // The lane under the profile: a bar per finding with a stretch; selecting one marks it in the list too.
  const lane = page.getByRole('group', { name: 'Findings along the dive' });
  await expect(lane.getByRole('button')).toHaveCount(4);
  const chip = lane.getByRole('button', { name: /^Fast ascent, Minute 13:\d\d to 16:\d\d$/ });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(ascent.getByRole('button', { name: /^Minute 13/ })).toHaveAttribute('aria-pressed', 'true');
  await ascent.getByRole('button', { name: /^Minute 13/ }).click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');

  // The ascent's colours, in words.
  const legend = page.getByRole('list', { name: 'Ascent speed' });
  await expect(legend).toContainText(/above 9 m\/min: \d:\d\d min/);

  // Imperial units reach the sentences.
  await setPreferences(request, { units: 'imperial' });
  await page.reload();
  await expect(ascent).toContainText(/You ascended at up to 43 ft\/min/);
  await expect(page.getByRole('list', { name: 'Ascent speed' })).toContainText('above 30 ft/min');
});

test('puts a finding aside on the dive and mutes a rule for the Diver; the logbook\'s mark follows', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await assessedDive(request);
  await page.goto('/#/?q=77');
  const row = page.getByRole('row', { name: /77/ });
  await expect(row).toContainText('2 findings');

  await page.goto(`/#/dives/${id}`);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Assessment', exact: true }) });
  await panel.getByRole('button', { name: 'Put aside on this dive: High oxygen pressure' }).click();
  await expect(panel.getByText('1 finding put aside')).toBeVisible();
  await expect(panel.locator('ul.findings').first().getByRole('heading', { name: 'High oxygen pressure' })).toHaveCount(0);
  await panel.getByText('1 finding put aside').click();
  await expect(panel.getByText('put aside on this dive', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Don’t show for Erika…: Fast ascent' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('It is hidden on every dive of Erika, also on future ones.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Don’t show it' }).click();
  await expect(panel.getByText('2 findings put aside')).toBeVisible();
  await expect(panel.getByText('not shown for Erika')).toBeVisible();
  // Its bar left the lane with it.
  await expect(page.getByRole('group', { name: 'Findings along the dive' }).getByRole('button', { name: /^Fast ascent/ })).toHaveCount(0);

  await page.goto('/#/?q=77');
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(/finding/);

  // The muted rule is listed with its Diver, and comes back from there.
  await page.goto('/#/divers');
  const erika = page.getByRole('listitem').filter({ hasText: 'Not shown in Erika’s assessments:' });
  await expect(erika).toContainText('Fast ascent');
  await erika.getByRole('button', { name: 'Show again: Fast ascent, Erika' }).click();
  await expect(page.getByText('Not shown in Erika’s assessments:')).toHaveCount(0);

  // The dismissed finding comes back from the dive.
  await page.goto(`/#/dives/${id}`);
  await expect(panel.locator('ul.findings').first().getByRole('heading', { name: 'Fast ascent' })).toBeVisible();
  await panel.getByText('1 finding put aside').click();
  await panel.getByRole('button', { name: 'Show again: High oxygen pressure' }).click();
  await expect(panel.getByText(/put aside/)).toHaveCount(0);
  await expect(panel.locator('ul.findings').first().getByRole('heading', { level: 3 })).toHaveCount(4);
});

// The dive assessment (ADR 0036) in a real browser: findings under the profile, each one row with its numbers, and
// guidance, evidence and sources on demand; the time lane; the ascent's colours in words; putting a finding aside and
// muting a rule; the list's mark.
import { expect, test } from '@playwright/test';
import { assessedDive, setPreferences } from './support.ts';

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});
test.afterEach(async ({ request }) => {
  await assessedDive(request);
});

test('shows each finding as one row with its numbers; guidance, sources and actions open on demand', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await assessedDive(request);
  await page.goto(`/#/dives/${id}`);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Assessment', exact: true }) });
  // The head counts what this dive has; what is for information only waits behind one line that names it.
  await expect(panel.getByText('2 findings differ from guidance · 2 for information')).toBeVisible();
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['High oxygen pressure', 'Fast ascent']);
  const more = panel.getByRole('button', { name: '2 more for information: Fast descent, Short safety stop' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  const ascent = panel.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Fast ascent' }) });
  const open = ascent.getByRole('button', { name: 'Fast ascent', exact: true });
  // The row: what was measured, in the User's units, and when. The rest is closed.
  await expect(ascent.getByText(/^Up to 13 m\/min for \d+ s, from 39\.\d m to 5 m\.$/)).toBeVisible();
  await expect(ascent.getByText(/^Minute 13:\d\d to 16:\d\d/)).toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(ascent.getByText(/Tables and dive computers assume/)).toBeHidden();
  await expect(ascent.getByRole('button', { name: /Put aside/ })).toBeHidden();
  // Screen readers get the whole sentence.
  await expect(ascent).toContainText(/You ascended at up to 13 m\/min for \d+ s, from 39\.\d m to 5 m\./);

  // Opened: the guidance with how well founded it is, the recommendation, where it comes from, the two actions.
  await open.click();
  await expect(ascent.getByText(/Tables and dive computers assume about 9 to 10 m\/min/)).toBeVisible();
  await expect(ascent.getByText('Based on experiments and an agency or maker rule.')).toBeVisible();
  await expect(ascent.getByText(/Start the ascent early enough/)).toBeVisible();
  await expect(ascent.getByRole('link', { name: /Carturan et al\. 2002/ })).toHaveAttribute('href', /europepmc/);
  await expect(ascent.getByRole('button', { name: 'Put aside on this dive: Fast ascent' })).toBeVisible();
  await expect(ascent.getByRole('button', { name: 'Don’t show for Erika…: Fast ascent' })).toBeVisible();

  // The lane under the profile: a bar per finding with a stretch. An opened finding is the one shown on the profile.
  const lane = page.getByRole('group', { name: 'Findings along the dive' });
  await expect(lane.getByRole('button')).toHaveCount(4);
  const chip = lane.getByRole('button', { name: /^Fast ascent, Minute 13:\d\d to 16:\d\d$/ });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  // Selecting a bar opens its finding and closes none.
  const oxygen = panel.getByRole('button', { name: 'High oxygen pressure', exact: true });
  await lane.getByRole('button', { name: /^High oxygen pressure/ }).click();
  await expect(oxygen).toHaveAttribute('aria-expanded', 'true');
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  // The bar of one that is for information opens the line it waits behind, too.
  await lane.getByRole('button', { name: /^Fast descent/ }).click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('button', { name: 'Fast descent', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText(/No study links descent speed to harm/)).toBeVisible();
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['High oxygen pressure', 'Fast ascent', 'Fast descent', 'Short safety stop']);
  // Closing the finding shown on the profile takes it off the profile.
  await panel.getByRole('button', { name: 'Fast descent', exact: true }).click();
  await expect(lane.getByRole('button', { name: /^Fast descent/ })).toHaveAttribute('aria-pressed', 'false');

  // The no-fly time is one line beside the findings, not one of them.
  await expect(panel.getByText(/^Flying after this dive: not before .+ \(12 hours after a single dive without decompression stops\)\./)).toBeVisible();
  // No score, no verdict. The fixed note is short, and its full text one step away.
  await expect(panel).not.toContainText(/score|unsafe|dangerous/i);
  await expect(panel.getByText(/^Not medical advice, and no measure of how safe a dive was\. With symptoms after a dive, call DAN or the emergency services\./)).toBeVisible();
  await expect(page.getByText(/decompression sickness can happen within every limit/)).toHaveCount(0);
  await panel.getByRole('button', { name: 'What the assessment can and can’t tell' }).click();
  const dialog = page.getByRole('dialog', { name: 'What the assessment can and can’t tell' });
  await expect(dialog.getByText(/decompression sickness can happen within every limit/)).toBeVisible();
  await expect(dialog.getByText(/unusual tiredness, joint pain, skin changes, numbness, dizziness/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(panel.getByRole('button', { name: 'What the assessment can and can’t tell' })).toBeFocused();

  // One recording has no tabs to name its device: the line under the chart does.
  await expect(page.getByRole('listitem').filter({ hasText: /^Garmin Descent Mk3 \(\d+\)$/ })).toBeVisible();

  // The ascent's colours, in words.
  const legend = page.getByRole('list', { name: 'Ascent speed' });
  await expect(legend).toContainText(/above 9 m\/min: \d:\d\d min/);

  // Imperial units reach the sentences.
  await setPreferences(request, { units: 'imperial' });
  await page.reload();
  await expect(ascent.getByText(/^Up to 43 ft\/min/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ascent speed' })).toContainText('above 30 ft/min');
});

test('puts a finding aside on the dive and mutes a rule for the Diver; the logbook\'s mark follows', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await assessedDive(request);
  await page.goto('/#/?q=77');
  const row = page.getByRole('row', { name: /77/ });
  await expect(row).toContainText('2 findings');

  await page.goto(`/#/dives/${id}`);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Assessment', exact: true }) });
  // The actions are with the finding's details.
  await panel.getByRole('button', { name: 'High oxygen pressure', exact: true }).click();
  await panel.getByRole('button', { name: 'Put aside on this dive: High oxygen pressure' }).click();
  await expect(panel.getByText('1 finding put aside')).toBeVisible();
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Fast ascent']);
  await expect(panel.getByText('1 finding differs from guidance · 2 for information')).toBeVisible();
  // Focus goes on to the finding that is left, not to the page.
  await expect(panel.getByRole('button', { name: 'Fast ascent', exact: true })).toBeFocused();
  await panel.getByText('1 finding put aside').click();
  await expect(panel.getByText('put aside on this dive', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Fast ascent', exact: true }).click();
  await panel.getByRole('button', { name: 'Don’t show for Erika…: Fast ascent' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('It is hidden on every dive of Erika, also on future ones.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Don’t show it' }).click();
  await expect(panel.getByText('2 findings put aside')).toBeVisible();
  await expect(panel.getByText('not shown for Erika')).toBeVisible();
  // Nothing differs from guidance any more; what is for information still waits behind its line.
  await expect(panel.getByText('2 for information', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '2 for information: Fast descent, Short safety stop' })).toBeVisible();
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
  await expect(panel.getByRole('heading', { name: 'Fast ascent', level: 3 })).toBeVisible();
  await panel.getByText('1 finding put aside').click();
  await panel.getByRole('button', { name: 'Show again: High oxygen pressure' }).click();
  await expect(panel.getByText(/put aside/)).toHaveCount(0);
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['High oxygen pressure', 'Fast ascent']);
});

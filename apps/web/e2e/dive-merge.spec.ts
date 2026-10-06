// Merging two Dives in a real browser (ADR 0038): the dive page says another dive was at the same time, asks before
// merging, and afterwards one Dive is left while the other is among the deleted dives, saying where it went.
// Fixtures: e2e/fixtures/mergeable-main.fit and mergeable-backup.fit, dive 31 (apps/server/test/fixtures/write-merge-fixture.ts).
import { expect, test } from '@playwright/test';
import { mergePair, mergeablePair, setPreferences } from './support.ts';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

test('says another dive was at the same time, merges the two after asking, and lists the other as merged', { tag: ['@dives'] }, async ({ page, request }) => {
  const { kept, other } = await mergeablePair(request);
  await page.goto(`/#/dives/${kept}`);
  const hint = page.locator('#main').getByText('Another dive in this logbook was at the same time');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('without a recording');
  await expect(page.getByRole('link', { name: 'Open the other dive' })).toHaveAttribute('href', `#/dives/${other}`);

  // Cancel keeps both, and focus goes back to the button that opened the dialog.
  await page.getByRole('button', { name: 'Merge the two…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Merge these two dives?' });
  await expect(dialog).toContainText('This dive is kept.');
  await expect(dialog).toContainText('goes to “Deleted dives” on the logbook, where you can restore it.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Merge the two…' })).toBeFocused();

  await page.getByRole('button', { name: 'Merge the two…' }).click();
  dialog = page.getByRole('dialog', { name: 'Merge these two dives?' });
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(hint).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('#main').getByText('Another dive of the same time was merged into this one').first()).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: /^Show deleted dives/ }).click();
  await expect(page.locator('#main').getByText('Merged into another dive.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open that dive' }).first()).toHaveAttribute('href', `#/dives/${kept}`);
});

// Logbook checks (ADR 0038): the pair waits in "Needs your decision" on the logbook.
test('lists two dives at the same time on the logbook, keeps them apart when told so, asks again, and merges them', { tag: ['@dives'] }, async ({ page, request }) => {
  await mergeablePair(request);
  try {
    await page.goto('/');
    const main = page.locator('#main');
    await expect(main.getByRole('heading', { name: 'Needs your decision' })).toBeVisible();
    await expect(main.getByText('Two dives in your logbook are at the same time.')).toBeVisible();
    await expect(main.getByText('A dive without a recording and a dive with one are at the same time')).toBeVisible();

    // "They are two dives": the pair leaves, with a way back that has the focus.
    await page.getByRole('button', { name: 'They are two dives: Dive 31 and Dive 31' }).click();
    await expect(main.getByText('Kept as two dives.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeFocused();
    await expect(main.getByText('A dive without a recording and a dive with one are at the same time')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(main.getByText('A dive without a recording and a dive with one are at the same time')).toBeVisible();

    // Kept apart again, the pair can be asked about again from the quiet list.
    await page.getByRole('button', { name: 'They are two dives: Dive 31 and Dive 31' }).click();
    await expect(main.getByText('Kept as two dives.')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Show pairs kept as two dives' }).click();
    await page.getByRole('button', { name: 'Ask again: Dive 31 and Dive 31' }).click();
    await expect(main.getByText('A dive without a recording and a dive with one are at the same time')).toBeVisible();

    // Merged from the logbook: asked first, and the logbook stays.
    await page.getByRole('button', { name: 'Merge the two…: Dive 31 and Dive 31' }).click();
    const dialog = page.getByRole('dialog', { name: 'Merge these two dives?' });
    await expect(dialog).toContainText('This dive is kept.');
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(main.getByText('A dive without a recording and a dive with one are at the same time')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
    await expect(page.getByRole('cell', { name: '31', exact: true })).toHaveCount(1);
  } finally {
    await mergePair(request);
  }
});

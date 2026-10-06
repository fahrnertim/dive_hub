// Merging two Dives in a real browser (ADR 0038): the dive page says another dive was at the same time, asks before
// merging, and afterwards one Dive has both recordings while the other is among the deleted dives, saying where it went.
// Fixtures: e2e/fixtures/mergeable-main.fit and mergeable-backup.fit, dive 31 (apps/server/test/fixtures/write-merge-fixture.ts).
import { expect, test } from '@playwright/test';
import { mergeablePair, setPreferences } from './support.ts';

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

test('says another dive was at the same time, merges the two after asking, and lists the other as merged', { tag: ['@dives'] }, async ({ page, request }) => {
  const { kept, other } = await mergeablePair(request);
  await page.goto(`/#/dives/${kept}`);
  const hint = page.locator('#main').getByText('Another dive in this logbook was at the same time');
  await expect(hint).toBeVisible();
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
  await expect(page.locator('#main').getByText('Another dive of the same time was merged into this one')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: /^Show deleted dives/ }).click();
  await expect(page.locator('#main').getByText('Merged into another dive.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open that dive' })).toHaveAttribute('href', `#/dives/${kept}`);
});

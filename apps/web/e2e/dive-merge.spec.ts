// Merging two Dives in a real browser (ADR 0038): the dive page says another dive was at the same time, asks before
// merging, and afterwards one Dive is left while the other is among the deleted dives, saying where it went.
// Fixtures: e2e/fixtures/mergeable-main.fit and mergeable-backup.fit, dive 31 (apps/server/test/fixtures/write-merge-fixture.ts).
import { expect, test } from '@playwright/test';
import { diveRows, falseStart, keepFalseStart, mergePair, mergeablePair, openLine, setPreferences } from './support.ts';

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
  await expect(hint).toContainText('Merged, this dive stays.');
  await expect(page.getByRole('link', { name: 'Open the other dive' })).toHaveAttribute('href', `#/dives/${other}`);

  // Cancel keeps both, and focus goes back to the button that opened the dialog.
  await page.getByRole('button', { name: 'Merge the two…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Merge these two dives?' });
  // Which of the two stays is said by what tells them apart, here the recording.
  await expect(dialog.getByText(/^Stays: Dive 31 .* with a recording$/)).toBeVisible();
  await expect(dialog.getByText(/^Goes to “Deleted dives”: Dive 31 .* without a recording$/)).toBeVisible();
  await expect(dialog).toContainText('The dive with the recording stays.');
  await expect(dialog).toContainText('You can restore the other one under “Deleted dives” on the logbook.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Merge the two…' })).toBeFocused();

  await page.getByRole('button', { name: 'Merge the two…' }).click();
  dialog = page.getByRole('dialog', { name: 'Merge these two dives?' });
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(hint).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await openLine(page, 'History');
  await expect(page.locator('#main').getByText('Another dive of the same time was merged into this one').first()).toBeVisible();

  await page.goto('/#/review?tab=deleted');
  await expect(page.locator('#main').getByText('Merged into another dive.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open that dive' }).first()).toHaveAttribute('href', `#/dives/${kept}`);
});

// Logbook checks (ADR 0038): the pair waits on the Review page, and the logbook says so in one line.
test('lists two dives at the same time on the logbook, keeps them apart when told so, asks again, and merges them', { tag: ['@dives'] }, async ({ page, request }) => {
  await mergeablePair(request);
  try {
    await page.goto('/');
    const main = page.locator('#main');
    await expect(main.getByText('One thing needs your decision: 1 pair of dives at the same time.')).toBeVisible();
    await page.getByRole('link', { name: 'Review them' }).click();
    await expect(main.getByRole('heading', { name: 'Dives at the same time', level: 2 })).toBeVisible();
    await expect(main.getByRole('button', { name: 'They are two dives: Dive 31 and Dive 31' })).toBeVisible();
    // The pair says which of the two a merge keeps.
    await expect(main.getByRole('listitem').filter({ hasText: /^Dive 31 ?stays when merged.* with a recording · Erika$/ })).toHaveCount(1);
    await expect(main.getByRole('listitem').filter({ hasText: /^Dive 31 ?stays when merged.* without a recording · Erika$/ })).toHaveCount(0);

    // "They are two dives": the pair leaves, with a way back that has the focus.
    await page.getByRole('button', { name: 'They are two dives: Dive 31 and Dive 31' }).click();
    await expect(main.getByText('Kept as two dives.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeFocused();
    await expect(main.getByRole('button', { name: 'They are two dives: Dive 31 and Dive 31' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(main.getByRole('button', { name: 'They are two dives: Dive 31 and Dive 31' })).toBeVisible();

    // Kept apart again, the pair can be asked about again from the quiet list.
    await page.getByRole('button', { name: 'They are two dives: Dive 31 and Dive 31' }).click();
    await expect(main.getByText('Kept as two dives.')).toBeVisible();
    await page.reload();
    await page.getByRole('link', { name: 'Decided' }).click();
    await page.getByRole('button', { name: 'Ask again: Dive 31 and Dive 31' }).click();
    await page.getByRole('link', { name: /^To decide/ }).click();
    await expect(main.getByRole('button', { name: 'They are two dives: Dive 31 and Dive 31' })).toBeVisible();

    // Merged from the logbook: asked first, and the logbook stays.
    await page.getByRole('button', { name: 'Merge the two…: Dive 31 and Dive 31' }).click();
    const dialog = page.getByRole('dialog', { name: 'Merge these two dives?' });
    await expect(dialog.getByText(/^Stays: Dive 31 .* with a recording$/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'They are two dives: Dive 31 and Dive 31' })).toHaveCount(0);
    await expect(page.getByText('Nothing waits for your decision.')).toBeVisible();
    await page.getByRole('link', { name: '‹ Logbook' }).click();
    await expect(diveRows(page).filter({ hasText: /Number 31(?!\d)/ })).toHaveCount(1);
  } finally {
    await mergePair(request);
  }
});

// A logbook check about one Dive (ADR 0038, `short_shallow_dive`): a recording of 50 seconds at 1.8 m is offered for
// deleting, kept when told so, and deleted only through the delete dialog, with its Undo.
test('offers a short and shallow dive for deleting, keeps it when told so, and deletes it only after asking', { tag: ['@dives'] }, async ({ page, request }) => {
  await falseStart(request);
  try {
    await page.goto('/');
    const main = page.locator('#main');
    await expect(main.getByText('One thing needs your decision: 1 dive that is probably no dive.')).toBeVisible();
    await page.getByRole('link', { name: 'Review them' }).click();
    await expect(main.getByRole('heading', { name: 'Probably not dives', level: 2 })).toBeVisible();
    await expect(main.getByText('A recording shorter than 2 min that stayed above 3 m is usually a dive computer that got wet, or a false start.')).toBeVisible();

    // "Keep it": the dive leaves the list, with a way back that has the focus.
    await main.getByRole('button', { name: /^Keep it: / }).click();
    await expect(main.getByText('Kept. You are asked again if its duration or depth changes.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeFocused();
    await expect(page.getByText('Nothing waits for your decision.')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(main.getByRole('button', { name: /^Keep it: / })).toBeVisible();

    // Kept again, it waits under "Decided" to be asked about again.
    await main.getByRole('button', { name: /^Keep it: / }).click();
    await page.getByRole('link', { name: 'Decided' }).click();
    await expect(main.getByRole('heading', { name: 'Short dives you kept', level: 2 })).toBeVisible();
    await main.getByRole('button', { name: /^Ask again: / }).click();
    await page.getByRole('link', { name: /^To decide/ }).click();

    // Deleting asks first, in the delete dialog; nothing is deleted by the button on the row.
    await main.getByRole('button', { name: /^Delete…: / }).click();
    const dialog = page.getByRole('dialog', { name: /^Delete .+\?$/ });
    await expect(dialog.getByText('You can restore it', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(main.getByRole('button', { name: /^Delete…: / })).toBeVisible();
    await main.getByRole('button', { name: /^Delete…: / }).click();
    await dialog.getByRole('button', { name: 'Delete dive' }).click();
    // The logbook, with the delete flow's own Undo; restored, the dive is kept and not asked about again.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(main.getByText('needs your decision', { exact: false })).toHaveCount(0);
  } finally {
    await keepFalseStart(request);
  }
});

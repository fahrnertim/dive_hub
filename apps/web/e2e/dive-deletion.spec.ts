// Deleting a Dive in a real browser (ADR 0026): asked first, back to the logbook with "Undo", restored from the
// deleted dives; and a Dive in SSI, kept there with a reminder and deleted there later, or deleted in both at once.
// Fixture: e2e/fixtures/deletable-computer.fit, dive 9 (apps/server/test/fixtures/write-deletion-fixture.ts).
import { expect, test, type Page } from '@playwright/test';
import { E2E_BASE_URL, deletableDive, sendToSsi, setPreferences } from './support.ts';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

async function openDeleteDialog(page: Page, diveId: string) {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'More: Dive 9' }).click();
  await page.getByRole('menuitem', { name: 'Delete dive…' }).click();
  return page.getByRole('dialog', { name: 'Delete Dive 9?' });
}
const logbookHeading = (page: Page) => page.getByRole('heading', { name: 'Logbook', level: 1 });
const diveNine = (page: Page) => page.getByRole('cell', { name: '9', exact: true });

test('deletes a dive after asking, offers Undo, and restores it from the deleted dives', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  let dialog = await openDeleteDialog(page, id);
  await expect(dialog).toContainText('You can restore it under “Deleted dives” on the logbook.');
  await expect(dialog.getByRole('button', { name: 'Delete here and in SSI' })).toHaveCount(0);
  // Cancel keeps it, and focus goes back to the menu that opened the dialog.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'More: Dive 9' })).toBeFocused();

  dialog = await openDeleteDialog(page, id);
  await dialog.getByRole('button', { name: 'Delete dive' }).click();
  await expect(logbookHeading(page)).toBeFocused();
  await expect(page.locator('#main').getByText('Dive 9 deleted.')).toBeVisible();
  await expect(diveNine(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#main').getByText('Dive 9 deleted.')).toHaveCount(0);
  await expect(diveNine(page)).toBeVisible();
  await expect(logbookHeading(page)).toBeFocused();

  // Deleted elsewhere, then restored from the list; its history shows both.
  const { version } = await (await request.get(`/api/dives/${id}`)).json() as { version: number };
  await request.delete(`/api/dives/${id}`, { data: { version }, headers: { origin: E2E_BASE_URL } });
  await page.reload();
  await page.getByRole('link', { name: 'Deleted dives (1)' }).click();
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Deleted dives' }) });
  await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeFocused();
  await expect(panel).toContainText(/Deleted .*2026/);
  await panel.getByRole('button', { name: 'Restore: Dive 9' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('link', { name: '‹ Logbook' }).click();
  await expect(diveNine(page)).toBeVisible();
  await diveNine(page).click();
  await expect(page.locator('.history > li').first()).toContainText('Restored');
});

test('keeps a dive in SSI when asked to, reminds about it, and deletes it there later', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  await sendToSsi(request, id);
  const dialog = await openDeleteDialog(page, id);
  await expect(dialog).toContainText(/It is also in SSI, as dive \d+\. Delete it there too\? SSI’s app can’t bring it back\./);
  await dialog.getByRole('button', { name: 'Delete only here' }).click();
  await expect(page.locator('#main').getByText(/Dive 9 deleted\. It is still in SSI, as dive \d+/)).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(logbookHeading(page)).toBeFocused();

  // Next visit: the reminder, until it's gone from SSI.
  await page.reload();
  await expect(page.locator('#main').getByText('A dive you deleted is still in SSI.')).toBeVisible();
  await page.getByRole('link', { name: 'Show deleted dives', exact: true }).click();
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Deleted dives' }) });
  await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeFocused();
  await expect(panel).toContainText(/Still in SSI, as dive \d+\./);
  await panel.getByRole('button', { name: 'Delete in SSI: Dive 9' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete in SSI' }).click();
  await expect(panel.getByText(/Still in SSI/)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Restore: Dive 9' })).toBeFocused();
  await expect(page.locator('#main').getByText('A dive you deleted is still in SSI.')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Restore: Dive 9' }).click();
  await page.getByRole('link', { name: '‹ Logbook' }).click();
  await expect(diveNine(page)).toBeVisible();
});

test('deletes a dive here and in SSI at once; Undo brings it back here only', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  await sendToSsi(request, id);
  const dialog = await openDeleteDialog(page, id);
  await dialog.getByRole('button', { name: 'Delete here and in SSI' }).click();
  await expect(page.locator('#main').getByText('Dive 9 deleted, here and in SSI. Undo brings it back here only.')).toBeVisible();
  await expect(page.locator('#main').getByText('A dive you deleted is still in SSI.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await diveNine(page).click();
  const ssi = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await expect(ssi.getByText('Not in SSI yet.')).toBeVisible();
});

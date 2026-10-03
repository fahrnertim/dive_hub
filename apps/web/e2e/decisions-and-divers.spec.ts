// Deciding about Recordings and keeping several Divers, in a real browser (ADR 0016).
// One story in order: a third computer's recording needs a decision; it is discarded, brought back,
// added to dive 42, then split off into its own dive; a second Diver gets that dive and a Device.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, setPreferences } from './support.ts';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
  const upload = await request.post('/api/imports', {
    headers: { origin: E2E_BASE_URL },
    multipart: { file: { name: 'odd-computer.fit', mimeType: 'application/octet-stream', buffer: readFileSync('e2e/fixtures/odd-computer.fit') } },
  });
  expect(upload.status()).toBe(202);
  // The server processes Imports in the background; wait until it's done.
  await expect.poll(async () => (await (await request.get(`/api/imports/${(await upload.json()).id}`)).json()).status).toBe('done');
});

test('a recording that doesn\'t clearly fit is put aside, brought back and added to a dive', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Needs your decision' }) });
  await expect(panel).toContainText('One recording doesn’t clearly belong to a dive.');
  await expect(panel).toContainText('Garmin Descent Mk3 (777)');
  await expect(panel).toContainText('the max depth differs too much');

  await panel.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Needs your decision' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show discarded recordings' }).click();
  await page.getByRole('button', { name: 'Decide again' }).click();
  await page.getByRole('button', { name: 'Hide discarded recordings' }).click();

  await page.getByRole('button', { name: 'Add to this dive' }).click();
  await expect(page.getByRole('heading', { name: 'Needs your decision' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Jan 15, 2026, 11:00 AM (UTC+2)' }).click();
  await expect(page.getByRole('radio', { name: /\(777\)/ })).toBeVisible();
  await expect(page.locator('.history > li').first()).toContainText('Recording added');
});

test('a recording that belongs elsewhere is split off into its own dive', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Jan 15, 2026, 11:00 AM (UTC+2)' }).click();
  await page.getByRole('radio', { name: /\(777\)/ }).click();
  await page.getByRole('button', { name: 'Split off into its own dive' }).click();
  await expect(page.getByRole('radio', { name: /\(777\)/ })).toHaveCount(0);
  await expect(page.locator('.history > li').first()).toContainText('Recording split off');
  await page.getByRole('link', { name: 'Logbook' }).first().click();
  await expect(page.getByRole('link', { name: 'Jan 15, 2026, 11:01 AM (UTC+2)' })).toBeVisible();
});

test('a second Diver gets a dive and a device; the logbook can show one Diver', async ({ page }) => {
  await page.goto('/#/divers');
  await page.getByRole('textbox', { name: 'Add a Diver' }).fill('Mia');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.diver-list')).toContainText('Mia');

  // The backup computer belongs to Mia from now on.
  const backupRow = page.getByRole('row').filter({ hasText: '999' });
  await backupRow.getByRole('button', { name: /Belongs to/ }).click();
  await page.getByRole('option', { name: 'Mia' }).click();
  await expect(backupRow.getByRole('button', { name: /Belongs to/ })).toContainText('Mia');

  // Move the split-off dive to Mia.
  await page.goto('/');
  await page.getByRole('link', { name: 'Jan 15, 2026, 11:01 AM (UTC+2)' }).click();
  await page.getByRole('button', { name: 'Move to another Diver…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText('Diver: Mia')).toBeVisible();
  await expect(page.locator('.history > li').first()).toContainText('Moved to another Diver');

  // The logbook, filtered to Mia, shows just that dive.
  await page.goto('/');
  await page.getByRole('button', { name: /Diver$/ }).click(); // the filter: value, then its label
  await page.getByRole('option', { name: 'Mia' }).click();
  await expect(page.getByRole('row')).toHaveCount(2); // header + one dive
  await expect(page.getByRole('cell', { name: 'Mia' })).toBeVisible();
});

test('the Divers page speaks German', async ({ page, request }) => {
  await setPreferences(request, { language: 'de' });
  await page.goto('/#/divers');
  await expect(page.getByRole('heading', { name: 'Taucher', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Geräte' })).toBeVisible();
  await expect(page.getByText('Importe ab jetzt landen bei diesem Taucher').first()).toBeVisible();
  await setPreferences(request, { language: null });
});

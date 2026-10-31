// Garmin as an import-only Provider (ADR 0062) in a real browser: connected with the User's own key and its expiry date,
// the notice a week ahead, the dives fetched, the kinds to fetch chosen, and nothing to send.
import { expect, test } from '@playwright/test';
import { GARMIN_KEY, leaveGarmin, setPreferences } from './support.ts';

/** The day `days` from now as the date field takes it (YYYY-MM-DD, local). */
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('sv');

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: 'en', units: null });
  await leaveGarmin(request);
});
test.afterEach(async ({ request }) => { await leaveGarmin(request); });

test('connects Garmin with a key that expires soon, fetches its dives and chooses the kinds', { tag: ['@account'] }, async ({ page }) => {
  await page.goto('/#/account?tab=connections');
  const garmin = page.locator('section', { has: page.getByRole('heading', { name: 'Garmin', level: 2 }) });

  // The key's page is one link away, in a new tab.
  const create = garmin.getByRole('link', { name: 'Create a key at Garmin Connect' });
  await expect(create).toHaveAttribute('href', 'https://connect.garmin.com/app/settings/personalApiToken');
  await expect(create).toHaveAttribute('target', '_blank');

  await garmin.getByLabel('Garmin key').fill(GARMIN_KEY);
  await garmin.getByLabel('Key expires on').fill(inDays(5));
  await garmin.getByRole('button', { name: 'Connect to Garmin' }).click();

  await expect(garmin.getByText(/The key expires on /)).toBeVisible();
  await expect(garmin.getByRole('link', { name: 'Create a key at Garmin Connect' })).toHaveCount(2);

  // Fetching: the fake account's two dives, both kinds by default.
  const dives = garmin.getByRole('region', { name: 'Dives of Erika from Garmin' });
  // Its dives come as files: fetching or not, nothing to add or create, no window.
  await expect(dives.getByRole('radio', { name: /^Also create dives/ })).toHaveCount(0);
  await dives.getByText('Fetch dives', { exact: true }).click();
  await expect(dives.getByRole('radio', { name: /^Fetch dives/ })).toBeChecked();
  await expect(dives.getByRole('button', { name: /Same dive if the start is within/ })).toHaveCount(0);
  await expect(dives.getByRole('checkbox', { name: 'Scuba dives' })).toBeChecked();
  await expect(dives.getByRole('checkbox', { name: 'Apnea sessions' })).toBeChecked();
  await dives.getByRole('button', { name: 'Show what the import would do' }).click();
  await expect(dives.getByText('2 dives in Garmin')).toBeVisible();

  // Apnea off: that session is skipped, and saying so is part of the preview. The last kind can't be turned off.
  await dives.getByRole('checkbox', { name: 'Apnea sessions' }).click({ force: true });
  await expect(dives.getByRole('checkbox', { name: 'Apnea sessions' })).not.toBeChecked();
  await expect(dives.getByRole('checkbox', { name: 'Scuba dives' })).toBeDisabled();
  await expect(dives.getByText('1 is a kind of dive you don’t fetch: left out')).toBeVisible();
  await dives.getByRole('button', { name: 'Import from Garmin' }).click();
  await expect(dives.getByRole('link', { name: 'Show in logbook' }).or(dives.getByText('Done'))).toBeVisible();

  // A new key later: the sign-in-again dialog takes the expiry date too.
  await garmin.getByRole('button', { name: /^Sign in again: / }).click();
  await expect(page.getByRole('dialog').getByLabel('Key expires on')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // Nothing to send: no automation for sending, no sending anywhere on the Connection.
  await expect(garmin.getByText(/Send changes automatically|Send new dives automatically/)).toHaveCount(0);
  await expect(garmin.getByRole('button', { name: /^Send/ })).toHaveCount(0);

  await dives.getByRole('checkbox', { name: 'Apnea sessions' }).click({ force: true });
  await expect(dives.getByRole('checkbox', { name: 'Apnea sessions' })).toBeChecked();
  await expect(dives.getByRole('checkbox', { name: 'Scuba dives' })).toBeEnabled();
});

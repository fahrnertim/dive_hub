// SSI as a Target in a real browser (ADR 0024), against the e2e server's fake SSI: connecting the account,
// signing in again, disconnecting; picking the SSI site, sending a Dive, updating it and deleting it there.
import { expect, test } from '@playwright/test';
import { SSI_ACCOUNT, connectSsi, disconnectSsi, editElsewhere, leaveSsi, readyForSsi, resetDive } from './support.ts';

test('connects a Diver to SSI, signs in again with another choice, and disconnects', { tag: ['@account'] }, async ({ page, request }) => {
  await resetDive(request);
  await disconnectSsi(request);
  await page.goto('/#/account');
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await expect(panel.getByText('SSI has no official interface for this')).toBeVisible();
  await panel.getByRole('textbox', { name: 'SSI e-mail' }).fill(SSI_ACCOUNT.email);
  await panel.getByRole('textbox', { name: 'SSI password' }).fill('wrong');
  await panel.getByRole('button', { name: 'Connect to SSI' }).click();
  await expect(panel.getByText('SSI didn’t accept this e-mail and password.')).toBeVisible();

  await panel.getByRole('textbox', { name: 'SSI password' }).fill(SSI_ACCOUNT.password);
  // Not storing the password is the default; the User chooses to keep it.
  await expect(panel.getByRole('radio', { name: /Don’t store my password/ })).toBeChecked();
  await panel.getByText('Keep me signed in').click();
  await panel.getByRole('button', { name: 'Connect to SSI' }).click();
  await expect(panel.getByText('Connected, password kept')).toBeVisible();
  await expect(panel.getByRole('cell', { name: SSI_ACCOUNT.email, exact: true })).toBeVisible();

  // The e2e instance keeps several Divers, so each row names its Diver too.
  await panel.getByRole('button', { name: `Sign in again: Erika, ${SSI_ACCOUNT.email}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'SSI password' }).fill(SSI_ACCOUNT.password);
  await dialog.getByText('Don’t store my password').click();
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText('Connected', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: `Disconnect: Erika, ${SSI_ACCOUNT.email}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(panel.getByRole('button', { name: 'Connect to SSI' })).toBeVisible();
  await expect(panel.getByRole('table')).toHaveCount(0);
});

test('picks the SSI site, sends the dive, updates it after a change and deletes it in SSI', { tag: ['@dives'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  await connectSsi(request);
  await readyForSsi(request, dive.id);
  await page.goto(`/#/dives/${dive.id}`);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await expect(panel.getByText('Not in SSI yet.')).toBeVisible();
  await expect(panel.getByText('SSI shows dives sent from Dive Hub as unconfirmed')).toBeVisible();

  await panel.getByRole('button', { name: 'Choose the SSI site' }).click();
  const dialog = page.getByRole('dialog');
  // Nearest first: Schwarzenbach is next to the test reef, Hausreef is in Egypt.
  await expect(dialog.getByRole('option').first()).toHaveAccessibleName(/Attersee – Schwarzenbach/);
  // Typing narrows the logbook's sites; an ID that isn't there can be used as typed.
  const search = dialog.getByRole('searchbox', { name: 'Find a site or type its SSI ID' });
  await search.fill('site:999');
  await expect(dialog.getByRole('option', { name: 'Use SSI site ID 999' })).toBeVisible();
  await search.fill('schwarz');
  await dialog.getByRole('option', { name: /Attersee – Schwarzenbach/ }).click();
  await expect(dialog).toBeHidden();

  await panel.getByRole('button', { name: 'Send to SSI' }).click();
  await expect(panel.getByText(/In SSI as dive \d+, sent/)).toBeVisible();
  await expect(panel.getByText('Up to date')).toBeVisible();

  await editElsewhere(request, dive.id, 'Saw a pike');
  await page.reload();
  await expect(panel.getByText('Changed since sent')).toBeVisible();
  await panel.getByRole('button', { name: 'Update in SSI' }).click();
  await expect(panel.getByText('Up to date')).toBeVisible();
  await panel.getByText('History of sending').click();
  await expect(panel.getByRole('listitem').filter({ hasText: 'Updated' }).first()).toBeVisible();

  await panel.getByRole('button', { name: 'Delete in SSI' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete in SSI' }).click();
  await expect(panel.getByText('Not in SSI yet.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send to SSI' })).toBeVisible();
  await leaveSsi(request, dive.id);
});

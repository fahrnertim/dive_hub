// SSI as a Target in a real browser (ADR 0024), against the e2e server's fake SSI: connecting the account,
// signing in again, disconnecting; picking the SSI site, sending a Dive, updating it and deleting it there.
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, SSI_ACCOUNT, connectSsi, disconnectSsi, editElsewhere, expectGoodPage, leaveSsi, openLine, readyForSsi, resetDive } from './support.ts';

test('connects a Diver to SSI, signs in again with another choice, and disconnects', { tag: ['@account'] }, async ({ page, request }) => {
  await resetDive(request);
  await disconnectSsi(request);
  await page.goto('/#/account');
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await expect(panel.getByText('SSI has no official interface for this')).toBeVisible();
  await panel.getByRole('textbox', { name: 'SSI e-mail' }).fill(SSI_ACCOUNT.login);
  await panel.getByRole('textbox', { name: 'SSI password' }).fill('wrong');
  await panel.getByRole('button', { name: 'Connect to SSI' }).click();
  await expect(panel.getByText('SSI didn’t accept this e-mail and password.')).toBeVisible();

  await panel.getByRole('textbox', { name: 'SSI password' }).fill(SSI_ACCOUNT.password);
  // Not storing the password is the default; the User chooses to keep it.
  await expect(panel.getByRole('radio', { name: /Don’t store my password/ })).toBeChecked();
  await panel.getByText('Keep me signed in').click();
  await panel.getByRole('button', { name: 'Connect to SSI' }).click();
  await expect(panel.getByText('Connected, password kept')).toBeVisible();
  await expect(panel.getByRole('cell', { name: SSI_ACCOUNT.login, exact: true })).toBeVisible();

  // The e2e instance keeps several Divers, so each row names its Diver too.
  await panel.getByRole('button', { name: `Sign in again: Erika, ${SSI_ACCOUNT.login}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'SSI password' }).fill(SSI_ACCOUNT.password);
  await dialog.getByText('Don’t store my password').click();
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText('Connected', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: `Disconnect: Erika, ${SSI_ACCOUNT.login}` }).click();
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
  // One line says where the dive is at SSI; the rest opens from it.
  const line = page.getByRole('button', { name: 'SSI', exact: true });
  await expect(panel.getByText('Not in SSI yet.')).toBeVisible();
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('button', { name: 'Choose the SSI site' })).toBeHidden();
  await openLine(page, 'SSI');
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
  // A dive that changed since it was sent opens its line by itself.
  await expect(line).toHaveAttribute('aria-expanded', 'true');
  await panel.getByRole('button', { name: 'Update in SSI' }).click();
  await expect(panel.getByText('Up to date')).toBeVisible();
  await panel.getByText('History of sending').click();
  await expect(panel.getByRole('listitem').filter({ hasText: 'Updated' }).first()).toBeVisible();
  // Notes left the start time alone: nothing was said about SSI's verification.
  await expect(panel.getByText(/start time/)).toHaveCount(0);

  // A changed start time makes SSI drop a dive centre's verification (ADR 0043): said before sending, and after.
  // The dive's site has a centre with a code (made up), so the way to verify again is offered.
  const headers = { origin: E2E_BASE_URL };
  const now = await (await request.get(`/api/dives/${dive.id}`)).json() as { version: number; site: { id: string }; values: { startsAt: { at: string } } };
  const left = await (await request.get('/api/dive-centres?q=Example+Divers+Send')).json() as { centres: { id: string }[] };
  for (const c of left.centres) await request.delete(`/api/dive-centres/${c.id}`, { headers });
  const centre = await (await request.post('/api/dive-centres', {
    headers, data: { name: 'Example Divers Send e.K.', externalIds: [{ source: 'ssi', externalId: '700002' }], siteIds: [now.site.id] },
  })).json() as { id: string };
  const later = new Date(new Date(now.values.startsAt.at).getTime() + 10 * 60_000).toISOString();
  await request.patch(`/api/dives/${dive.id}`, { headers, data: { version: now.version, set: { startsAt: { ...now.values.startsAt, at: later } } } });
  await page.reload();
  await expect(panel.getByText('This update changes the dive’s start time in SSI. SSI then removes the dive centre’s verification of this dive.')).toBeVisible();
  await expectGoodPage(page, 'Dive 42');
  await panel.getByRole('button', { name: 'Update in SSI' }).click();
  await expect(panel.getByText('Up to date')).toBeVisible();
  await expect(panel.getByText('The start time changed in SSI, so a dive centre’s verification of this dive is gone there.')).toBeVisible();
  await panel.getByRole('button', { name: 'Show the centre’s code' }).click();
  await expect(page.getByRole('img', { name: 'SSI verification code of Example Divers Send e.K.' })).toBeVisible();
  await request.delete(`/api/dive-centres/${centre.id}`, { headers });
  await page.reload();
  await openLine(page, 'SSI');

  await panel.getByRole('button', { name: 'Delete in SSI' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete in SSI' }).click();
  await expect(panel.getByText('Not in SSI yet.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send to SSI' })).toBeVisible();
  await leaveSsi(request, dive.id);
});

// Sending many Dives to SSI from the logbook (ADR 0047), against the e2e server's fake SSI: the dialog says what goes and
// what is held back, a run shows its progress and its result, and a run stopped by a sign-in need goes on after it.
import { expect, test } from '@playwright/test';
import { clearPushRuns, expireSsiTokens, headers, leaveSsi, pushRunSetup, resetDive, signInSsi } from './support.ts';

test.afterEach(async ({ request }) => {
  await clearPushRuns(request);
});

test('sends the logbook\'s list to SSI: held back first, then sent with progress and a result', { tag: ['@dives'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  const { siteId } = await pushRunSetup(request, dive.id, { keepSignedIn: true, siteExternalId: null });
  await page.goto(`/#/?site=${siteId}`);

  await page.getByRole('button', { name: 'Send to SSI…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send dives to SSI' });
  // The site has no SSI ID: SSI can't take the dive, and the dialog says where to fix it.
  await expect(dialog.getByRole('button', { name: 'Send 0 dives' })).toBeDisabled();
  await expect(dialog.getByText('1 held back')).toBeVisible();
  const siteLink = dialog.getByRole('link', { name: '1 at SSI test reef' });
  await expect(siteLink).toHaveAttribute('href', `#/sites/${siteId}`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // Fixed (as the User would on the site's page), the dive goes.
  await request.put(`/api/dive-sites/${siteId}/external-ids/ssi`, { data: { externalId: '7099' }, headers });
  await page.getByRole('button', { name: 'Send to SSI…' }).click();
  await expect(dialog.getByText('1 new dive')).toBeVisible();
  // Nothing beyond new dives is sent unless asked for: the choices start unticked.
  await dialog.getByRole('button', { name: 'Send 1 dive' }).click();
  await expect(dialog).toBeHidden();

  const strip = page.locator('#main').getByText(/Sent 1 of 1 dives to SSI\./);
  await expect(strip).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  const status = await (await request.get(`/api/dives/${dive.id}/providers/ssi`)).json() as { current: unknown };
  expect(status.current).not.toBeNull();

  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(strip).toBeHidden();
  await leaveSsi(request, dive.id);
});

test('a run stopped by a sign-in need goes on after signing in', { tag: ['@dives'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  const { connectionId, siteId } = await pushRunSetup(request, dive.id, { keepSignedIn: false, siteExternalId: '7099' });
  await expireSsiTokens(request);
  const started = await request.post(`/api/connections/${connectionId}/push-runs`, {
    data: { dives: { list: { siteId } } }, headers,
  });
  expect(started.status(), `${await started.text()} ${JSON.stringify(await (await request.post(`/api/connections/${connectionId}/push-runs/preview`, { data: { dives: { list: { siteId } } }, headers })).json())}`).toBe(202);

  await page.goto('/#/');
  // It doesn't time out and doesn't hide behind a toast: the reason, and the way on.
  await expect(page.getByText(/Stopped after 0 of 1 dives to SSI\./)).toBeVisible();
  await expect(page.getByText('SSI wants you to sign in again')).toBeVisible();

  await signInSsi(request, connectionId);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#main').getByText(/Sent 1 of 1 dives to SSI\./)).toBeVisible();
  await leaveSsi(request, dive.id);
});

test('a dive changed since it was sent has its own filter, and the send dialog links to it', { tag: ['@dives'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  const { siteId } = await pushRunSetup(request, dive.id, { keepSignedIn: true, siteExternalId: '7099' });
  const sent = await request.post(`/api/dives/${dive.id}/providers/ssi`, { data: {}, headers });
  expect(sent.ok(), await sent.text()).toBe(true);
  const chips = page.getByRole('group', { name: 'Show only' });
  const chip = chips.getByRole('button', { name: /^Changed since sent \d+$/ });

  // Sent and unchanged: nothing to show, so the chip isn't offered.
  await page.goto(`/#/?site=${siteId}`);
  await expect(page.getByRole('region', { name: 'Dives' })).toBeVisible();
  await expect(chip).toHaveCount(0);

  // Changed after it was sent: the chip counts it, and pressing it shows exactly that dive.
  const now = await (await request.get(`/api/dives/${dive.id}`)).json() as { version: number };
  const patched = await request.patch(`/api/dives/${dive.id}`, { data: { version: now.version, notes: 'Changed after sending' }, headers });
  expect(patched.ok(), await patched.text()).toBe(true);
  await page.reload();
  await expect(chip).toHaveText('Changed since sent1');
  await chip.click();
  await expect(page).toHaveURL(/only=changed-since-sent/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Dives' }).getByRole('listitem')).toHaveCount(1);

  // The dialog's "also update" choice leads to the list it would update, from an unfiltered logbook.
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Send to SSI…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send dives to SSI' });
  await expect(dialog.getByRole('checkbox', { name: /Also update dives changed since they were sent/ })).toBeVisible();
  await dialog.getByRole('link', { name: 'Show these dives in the logbook' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/only=changed-since-sent/);
  await leaveSsi(request, dive.id);
});

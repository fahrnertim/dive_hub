// Sending many Dives to SSI from the logbook (ADR 0047), against the e2e server's fake SSI: the dialog says what goes and
// what is held back, a run shows its progress and its result, and a run stopped by a sign-in need goes on after it.
import { expect, test } from '@playwright/test';
import { clearPushRuns, deletableDive, diveNumber, expireSsiTokens, headers, leaveSsi, pushRunSetup, readyForSsi, resetDive, signInSsi } from './support.ts';

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
  // In the Dive page's words (UI/UX pass C13): which site, and what it needs.
  const siteLink = dialog.getByRole('link', { name: '1 dive: SSI test reef needs SSI’s ID for the site.' });
  await expect(siteLink).toHaveAttribute('href', `#/sites/${siteId}`);
  // The close button is in the title row, before everything else; the main action comes before Cancel (C1, C14).
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeVisible();
  const actions = dialog.locator('.form-actions').getByRole('button');
  await expect(actions.nth(0)).toHaveText('Send 0 dives');
  await expect(actions.nth(1)).toHaveText('Cancel');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Send to SSI…' }).click();
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
  // It doesn't time out and doesn't hide behind a toast: the reason, and the way on. (In #main: the live announcer
  // outside it says the same words while the announcement lasts.)
  await expect(page.locator('#main').getByText(/Stopped after 0 of 1 dives to SSI\./)).toBeVisible();
  await expect(page.getByText('SSI wants you to sign in again')).toBeVisible();
  // The way on is the sign-in, first; "Continue" would fail until then (C4).
  const signIn = page.getByRole('link', { name: 'Sign in to SSI again' });
  await expect(signIn).toHaveAttribute('href', '#/account?tab=connections');
  const actions = page.locator('.push-run-actions').locator('a, button');
  await expect(actions.nth(0)).toHaveText('Sign in to SSI again');
  await expect(actions.nth(1)).toHaveText('Continue');

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
  // The hint is a block of its own under the label, and counts in the singular (C3).
  const hint = dialog.locator('small.field-hint', { hasText: 'This replaces the values in SSI: 1 dive.' });
  await expect(hint).toBeVisible();
  expect(await hint.evaluate((el) => getComputedStyle(el).display)).toBe('block');
  // The choices that change what SSI already holds sit together, under one warning (UI/UX pass C2).
  const risky = dialog.getByRole('group', { name: 'These change what is already in SSI' });
  await expect(risky.getByRole('checkbox', { name: /Also update dives changed since they were sent/ })).toBeVisible();
  await dialog.getByRole('link', { name: 'Show these dives in the logbook' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/only=changed-since-sent/);
  await leaveSsi(request, dive.id);
});

test('the dialog says which dives go, lets one be left out, and sends exactly the ticked ones (UI/UX pass C2)', { tag: ['@dives'] }, async ({ page, request }) => {
  const first = await resetDive(request);
  const second = await deletableDive(request);
  const { siteId } = await pushRunSetup(request, first.id, { keepSignedIn: true, siteExternalId: '7099' });
  await readyForSsi(request, second);
  await request.put(`/api/dive-sites/${siteId}/external-ids/ssi`, { data: { externalId: '7099' }, headers });
  await page.goto(`/#/?site=${siteId}`);

  await page.getByRole('button', { name: 'Send to SSI…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send dives to SSI' });
  // The scope is a question the dialog asks: the list as it is now, named, with its size.
  const scope = dialog.getByRole('radiogroup', { name: /Which dives/ });
  await expect(scope.getByRole('radio', { name: /The dives in the list now \(2\)/ })).toBeChecked();
  await expect(scope.getByRole('radio', { name: /Everything not in SSI yet \(\d+\)/ })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Send 2 dives' })).toBeEnabled();

  // The dives that go are listed, each with a checkbox; leaving one out changes the button.
  await dialog.getByRole('button', { name: /Show the 2 dives/ }).click();
  const list = dialog.getByRole('group', { name: 'Dives to send' });
  await expect(list.getByRole('checkbox')).toHaveCount(2);
  await expect(list.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await list.locator('label').nth(1).click();
  await expect(dialog.getByRole('button', { name: 'Send 1 dive' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Select none' }).click();
  await expect(dialog.getByRole('button', { name: 'Send 0 dives' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Select all' }).click();
  await list.locator('label').nth(1).click();

  await dialog.getByRole('button', { name: 'Send 1 dive' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#main').getByText(/Sent 1 of 1 dives to SSI\./)).toBeVisible();
  const sentStatus = async (id: string) => ((await (await request.get(`/api/dives/${id}/providers/ssi`)).json()) as { current: unknown }).current;
  // The list is oldest first: the unticked one is the later of the two, and it was not sent.
  const states = await Promise.all([first.id, second].map(sentStatus));
  expect(states.filter((s) => s !== null)).toHaveLength(1);
  await leaveSsi(request, first.id);
  await leaveSsi(request, second);
});

test('"everything not in SSI yet" ignores the logbook\'s search, and the choice is the dialog\'s own', { tag: ['@dives'] }, async ({ page, request }) => {
  const first = await resetDive(request);
  const second = await deletableDive(request);
  const { siteId } = await pushRunSetup(request, first.id, { keepSignedIn: true, siteExternalId: '7099' });
  await readyForSsi(request, second);
  await request.put(`/api/dive-sites/${siteId}/external-ids/ssi`, { data: { externalId: '7099' }, headers });
  // A search that finds one of the two dives.
  const number = await diveNumber(request, first.id);
  await page.goto(`/#/?q=${number}&site=${siteId}`);

  await page.getByRole('button', { name: 'Send to SSI…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send dives to SSI' });
  await expect(dialog.getByRole('button', { name: 'Send 1 dive' })).toBeEnabled();
  await dialog.getByText('Everything not in SSI yet').click();
  await expect(dialog.getByRole('button', { name: 'Send 2 dives' })).toBeEnabled();
  // Back to the list: the dialog never changed the logbook behind it.
  await dialog.getByText('The dives in the list now').click();
  await expect(dialog.getByRole('button', { name: 'Send 1 dive' })).toBeEnabled();
  await expect(page).toHaveURL(new RegExp(`q=${number}`));
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await leaveSsi(request, first.id);
  await leaveSsi(request, second);
});

test('a dismissed run stays dismissed on the server, in any browser (UI/UX pass C5)', { tag: ['@dives'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  const { connectionId, siteId } = await pushRunSetup(request, dive.id, { keepSignedIn: true, siteExternalId: '7099' });
  const started = await request.post(`/api/connections/${connectionId}/push-runs`, { data: { dives: { list: { siteId } } }, headers });
  expect(started.status(), await started.text()).toBe(202);
  const { id } = await started.json() as { id: string };
  await page.goto('/#/');
  const strip = page.locator('#main').getByText(/Sent 1 of 1 dives to SSI\./);
  await expect(strip).toBeVisible();

  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(strip).toBeHidden();
  const stored = await (await request.get('/api/push-runs')).json() as { id: string; dismissedAt: string | null }[];
  expect(stored.find((r) => r.id === id)?.dismissedAt).not.toBeNull();

  // Not kept in this browser: with its storage emptied, the run is still put away.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('region', { name: 'Dives' })).toBeVisible();
  await expect(strip).toBeHidden();
  await leaveSsi(request, dive.id);
});

test('a run going shows beside "Logbook" on every page, with the count announced (UI/UX pass C5)', { tag: ['@dives'] }, async ({ page }) => {
  const run = {
    id: '00000000-0000-4000-8000-000000000001', connectionId: '00000000-0000-4000-8000-000000000002', provider: 'ssi',
    diverId: '00000000-0000-4000-8000-000000000003', status: 'running', stopCode: null, updates: false, updatesRemovingVerification: false,
    numbers: false, cancelRequested: false, counts: { total: 10, waiting: 7, sent: 3, skipped: 0, failed: 0 }, leftOut: {}, pauseMs: 0,
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: null, dismissedAt: null,
  };
  await page.route('**/api/push-runs', (route) => route.fulfill({ json: [run] }));
  await page.goto('/#/divers');
  const logbook = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Logbook/ });
  // Not only on the logbook: "you can leave this page" is true because the mark follows the User.
  await expect(logbook).toContainText('Sending to SSI: 3 of 10 dives');
  await expect(logbook.locator('.run-mark')).toBeVisible();
  await page.getByRole('link', { name: /Logbook/ }).click();
  await expect(page.locator('.push-run-strip').getByRole('progressbar')).toBeVisible();
});

test('earlier runs can be found again, also after the newest is dismissed (UI/UX pass C5)', { tag: ['@dives'] }, async ({ page, request }) => {
  const first = await resetDive(request);
  const second = await deletableDive(request);
  const { connectionId, siteId } = await pushRunSetup(request, first.id, { keepSignedIn: true, siteExternalId: '7099' });
  await readyForSsi(request, second);
  await request.put(`/api/dive-sites/${siteId}/external-ids/ssi`, { data: { externalId: '7099' }, headers });
  for (const id of [first.id, second]) {
    const started = await request.post(`/api/connections/${connectionId}/push-runs`, { data: { dives: { ids: [id] } }, headers });
    expect(started.status(), await started.text()).toBe(202);
    // One run at a time per Connection: the next starts after this one ended.
    await expect.poll(async () => ((await (await request.get('/api/push-runs')).json()) as { status: string }[])[0]?.status).toBe('done');
  }
  await page.goto('/#/');
  const earlier = page.getByRole('button', { name: 'Earlier runs (1)' });
  await expect(earlier).toBeVisible();
  await earlier.click();
  await expect(page.locator('.push-run-earlier').getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('.push-run-earlier').getByText(/Sent 1 of 1 dives to SSI\./)).toBeVisible();

  // Dismissing the strip does not lose the runs: both are listed now.
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('button', { name: 'Earlier runs (2)' })).toBeVisible();
  await leaveSsi(request, first.id);
  await leaveSsi(request, second);
});

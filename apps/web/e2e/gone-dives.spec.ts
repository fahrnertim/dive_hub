// Dives gone at SSI (ADR 0051) in a real browser, against the e2e server's fake SSI: a dive deleted in SSI's app is found
// by the Connection's check, shows on the Review page and in the logbook's strip, and waits for the User's choice. "Keep
// here" and "Delete here too" both ask SSI once more first; nothing is deleted or sent unasked.
import { expect, test } from '@playwright/test';
import { deletableDive, diveNumber, goneAtSsi, readyForSsi, E2E_BASE_URL, SSI_ACCOUNT, connectSsi } from './support.ts';

// Each test makes its own gone dive; the Connection they all need is made first.
test.beforeAll(async ({ request }) => connectSsi(request));

test('the Connection\'s check finds a dive deleted in SSI and says so; nothing about the dive changes', { tag: ['@account', '@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  await readyForSsi(request, id);
  const n = await diveNumber(request, id);
  try {
    // Sent, then deleted in SSI's app, but not checked yet: the dive still says it is in SSI.
    await goneAtSsi(request, id);
    const status = await (await request.get(`/api/dives/${id}/providers/ssi`)).json() as { current: { remoteId: string } | null };
    expect(status.current).not.toBeNull();

    await page.goto('/#/account?tab=connections');
    const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
    await panel.getByRole('button', { name: new RegExp(`^Check for dives deleted in SSI: ${SSI_ACCOUNT.login}`) }).click();
    await expect(panel.getByText(/dive is no longer in your SSI logbook\. Nothing was changed\./)).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Show them' })).toBeVisible();

    // The logbook says so in its strip; the Review page has the dive with its two choices.
    await page.goto('/');
    await expect(page.getByText(/1 dive no longer in SSI/)).toBeVisible();
    await page.getByRole('link', { name: 'Review them' }).click();
    await expect(page.getByRole('heading', { name: 'Dives no longer in SSI', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: `Delete here too: Dive ${n}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Keep here: Dive ${n}` })).toBeVisible();
  } finally {
    await request.post('/e2e/fake-ssi/clear-dives', { data: { email: SSI_ACCOUNT.login }, headers: { origin: E2E_BASE_URL } });
  }
});

test('"Keep here" asks SSI again, then the dive is no longer linked and is offered to SSI anew', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  await readyForSsi(request, id);
  const n = await diveNumber(request, id);
  await goneAtSsi(request, id);
  await page.goto('/#/review');
  await page.getByRole('button', { name: `Keep here: Dive ${n}` }).click();
  await expect(page.locator('#main').getByText(`Dive ${n} stays here. It is no longer linked with SSI`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dives no longer in SSI', level: 2 })).toBeHidden();
  await page.goto(`/#/dives/${id}`);
  await expect(page.getByText('Not in SSI yet.')).toBeVisible();
});

test('"Delete here too" asks SSI again, then opens the dive\'s own delete dialog', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  await readyForSsi(request, id);
  const n = await diveNumber(request, id);
  await goneAtSsi(request, id);
  try {
    await page.goto('/#/review');
    await page.getByRole('button', { name: `Delete here too: Dive ${n}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: `Delete Dive ${n}?` })).toBeVisible();
    // The dive is no longer in SSI, so the dialog has nothing to ask about SSI.
    await expect(dialog.getByRole('button', { name: 'Delete dive', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    // Cancelling deletes nothing: the dive is still here, no longer at SSI.
    expect((await request.get(`/api/dives/${id}`)).ok()).toBe(true);
  } finally {
    await deletableDive(request);
  }
});

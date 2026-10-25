// Private site IDs per SSI account (piece 4, ADR 0057), against the e2e server's fake SSI: a Dive at a positioned site
// without an SSI ID is sent (the send makes the site at SSI), the picker stores through the Connection, and the site
// page types, shows and clears the account's private ID.
import { request as playwrightRequest, expect, test } from '@playwright/test';
import { E2E_BASE_URL, connectSsi, leaveSsi, openLine, readyForSsi, resetDive } from './support.ts';

test.describe.configure({ mode: 'serial' });

const headers = { origin: E2E_BASE_URL };
type Site = { id: string; externalIds: { source: string; externalId: string; privateTo: { diverId: string } | null }[] };
const siteOf = async (api: import('@playwright/test').APIRequestContext, diveId: string) => {
  const dive = await (await api.get(`/api/dives/${diveId}`)).json() as { site: { id: string } };
  return (await (await api.get(`/api/dive-sites/${dive.site.id}`)).json()) as Site;
};

test('a dive at a site with a position and no SSI ID is sent: the send makes the site at SSI as a private one', { tag: ['@dives'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  await connectSsi(request);
  await readyForSsi(request, dive.id);
  await page.goto(`/#/dives/${dive.id}`);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await openLine(page, 'SSI');
  await expect(panel.getByText('Sending finds this site in your SSI logbook or creates it there as a private site.')).toBeVisible();
  // The pick stays on offer, but nothing waits for it.
  await expect(panel.getByRole('button', { name: 'Choose the SSI site' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send to SSI' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Send to SSI' }).click();
  await expect(panel.getByText(/In SSI as dive \d+, sent/)).toBeVisible();

  const site = await siteOf(request, dive.id);
  const own = site.externalIds.find((e) => e.source === 'ssi' && e.privateTo);
  expect(own, 'the send stores the site it made as the account’s private one').toBeTruthy();
  await page.goto(`/#/sites/${site.id}`);
  await expect(page.locator('dl.facts').getByText('Your private SSI site', { exact: true })).toBeVisible();
  await expect(page.locator('dl.facts div', { hasText: 'Your private SSI site' }).getByText(own!.externalId, { exact: true })).toBeVisible();
  await leaveSsi(request, dive.id);
});

test('picking a site in the picker stores it through the Connection, a private site shown as such', { tag: ['@dives'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  await connectSsi(request);
  await readyForSsi(request, dive.id);
  await page.goto(`/#/dives/${dive.id}`);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await openLine(page, 'SSI');
  await panel.getByRole('button', { name: 'Choose the SSI site' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox', { name: 'Find a site or type its SSI ID' }).fill('geheim');
  const mine = dialog.getByRole('option', { name: /Erikas Geheimriff/ });
  await expect(mine).toContainText('private');
  // Lena's private site is not Erika's to use: SSI's logbook lists it for Lena only, and Dive Hub drops it.
  await expect(dialog.getByRole('option', { name: /Lenas Geheimriff/ })).toHaveCount(0);
  const saved = page.waitForResponse((r) => /\/api\/connections\/[^/]+\/dive-sites\/[^/]+$/.test(r.url()) && r.request().method() === 'PUT');
  await mine.click();
  const answer = await saved;
  expect(answer.status()).toBe(200);
  expect(await answer.json()).toEqual({ externalId: '7010', private: true });
  await expect(dialog).toBeHidden();
  const site = await siteOf(request, dive.id);
  expect(site.externalIds.filter((e) => e.source === 'ssi').map((e) => [e.externalId, !!e.privateTo])).toEqual([['7010', true]]);
  await leaveSsi(request, dive.id);
});

test('the site page: an unknown ID is refused, a private one is shown and cleared, another User never sees it', { tag: ['@sites'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  await connectSsi(request);
  await readyForSsi(request, dive.id);
  const site = await siteOf(request, dive.id);
  await page.goto(`/#/sites/${site.id}`);
  await page.getByRole('button', { name: 'Edit dive site' }).click();
  const privateField = page.getByRole('textbox', { name: 'Your private SSI site ID' });
  await privateField.fill('99999');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('SSI has no site with this ID.')).toBeVisible();
  expect((await siteOf(request, dive.id)).externalIds).toEqual([]);

  await privateField.fill('7010');
  await page.getByRole('button', { name: 'Save' }).click();
  const shown = page.locator('dl.facts div', { hasText: 'Your private SSI site' });
  await expect(shown.getByText('7010', { exact: true })).toBeVisible();

  // Another User sees the site, never the private ID.
  const other = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: headers });
  const signedIn = await other.post('/api/auth/sign-in/email', { data: { email: 'bartholomaeus.oberhuber@example.com', password: 'a long enough test password' } });
  expect(signedIn.ok()).toBe(true);
  const theirs = await (await other.get(`/api/dive-sites/${site.id}`)).json() as Site;
  expect(theirs.id).toBe(site.id);
  expect(theirs.externalIds).toEqual([]);
  await other.dispose();

  await page.getByRole('button', { name: 'Edit dive site' }).click();
  await privateField.fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Edit dive site' })).toBeVisible();
  await expect(page.locator('dl.facts').getByText('Your private SSI site', { exact: true })).toHaveCount(0);
  expect((await siteOf(request, dive.id)).externalIds).toEqual([]);
  await leaveSsi(request, dive.id);
});

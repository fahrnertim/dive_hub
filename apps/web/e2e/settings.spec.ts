// Settings (UI overhaul, "The shell"): one area with a view per section, the section's name its h1. The old account and
// admin addresses lead to their section; on a phone "#/settings" is the list of sections.
import { expect, test } from '@playwright/test';
import { connectSsi, E2E_BASE_URL, headers, setPreferences } from './support.ts';

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

test('an old account address lands on its section, and the sections are beside it', { tag: ['@account'] }, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/account?tab=connections');
  await expect(page.getByRole('heading', { name: 'Connections', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/settings\/connections$/);
  const sections = page.getByRole('navigation', { name: 'Settings' });
  await expect(sections.getByRole('link', { name: 'Connections' })).toHaveAttribute('aria-current', 'page');
  // The admin sees Administration among the sections.
  await expect(sections.getByRole('link', { name: 'Administration' })).toBeVisible();

  // "#/settings" alone opens Display on a wide screen.
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Display', level: 1 })).toBeVisible();
  await sections.getByRole('link', { name: 'Sign-in and security' }).click();
  await expect(page).toHaveURL(/#\/settings\/security$/);
  await expect(page.getByRole('heading', { name: 'Where you’re signed in' })).toBeVisible();
});

test("an old link to a Connection's settings keeps the Connection and gives its settings the focus", { tag: ['@account'] }, async ({ page, request }) => {
  await connectSsi(request);
  const me = await (await request.get('/api/me')).json() as { ownDiver: { id: string } };
  const connections = await (await request.get('/api/connections')).json() as { id: string; provider: string; diverId: string }[];
  const id = connections.find((c) => c.provider === 'ssi' && c.diverId === me.ownDiver.id)!.id;
  await page.goto(`/#/account?tab=connections&connection=${id}`);
  await expect(page).toHaveURL(new RegExp(`#/settings/connections\\?connection=${id}$`));
  await expect(page.locator('h3:focus')).toHaveText(/^Automatic/);
});

test('on a laptop the sections are tabs above the view and tables stay tables; from 90rem they are beside it', { tag: ['@account'] }, async ({ page, request }) => {
  await connectSsi(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/settings/security');
  const sections = page.getByRole('navigation', { name: 'Settings' });
  const heading = page.getByRole('heading', { name: 'Sign-in and security', level: 1 });
  await expect(heading).toBeVisible();
  await expect(sections.getByRole('link', { name: 'Sign-in and security' })).toHaveAttribute('aria-current', 'page');
  const tabs = (await sections.boundingBox())!;
  expect(tabs.y + tabs.height).toBeLessThanOrEqual((await heading.boundingBox())!.y);
  // Every table keeps its columns: its rows are not cards.
  const tables = () => page.locator('#main table tbody tr').evaluateAll((rows) => rows.length > 0 && rows.every((r) => getComputedStyle(r).display === 'table-row'));
  await expect.poll(tables).toBe(true);
  for (const section of ['devices', 'connections', 'admin']) {
    await page.goto(`/#/settings/${section}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Devices|Connections|Administration/);
    await expect.poll(tables).toBe(true);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/settings/security');
  await expect(heading).toBeVisible();
  const list = (await sections.boundingBox())!;
  expect(list.x + list.width).toBeLessThanOrEqual((await heading.boundingBox())!.x);
});

test('an unknown section goes to Display on a wide screen and to the list on a phone', { tag: ['@account'] }, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/settings/foo');
  await expect(page).toHaveURL(/#\/settings\/display$/);
  await expect(page.getByRole('heading', { name: 'Display', level: 1 })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/settings/foo');
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

test('a phone at "#/settings" lists the sections; a section has its way back', { tag: ['@account'] }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'Settings' });
  await sections.getByRole('link', { name: 'Devices' }).click();
  await expect(page.getByRole('heading', { name: 'Devices', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settings' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).and(page.locator('.back-link')).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

test('someone not an admin is not offered Administration, and its address says only admins may', { tag: ['@account', '@admin'] }, async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });
  try {
    const signedIn = await context.request.post('/api/auth/sign-in/email', {
      data: { email: 'bartholomaeus.oberhuber@example.com', password: 'a long enough test password' }, headers,
    });
    expect(signedIn.ok()).toBe(true);
    const page = await context.newPage();
    await page.goto('/#/settings/display');
    const sections = page.getByRole('navigation', { name: 'Settings' });
    await expect(sections.getByRole('link', { name: 'Devices' })).toBeVisible();
    await expect(sections.getByRole('link', { name: 'Administration' })).toHaveCount(0);
    await page.goto('/#/admin');
    await expect(page).toHaveURL(/#\/settings\/admin$/);
    await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible();
    await expect(page.getByText('Only admins can do this.')).toBeVisible();
  } finally {
    await context.close();
  }
});

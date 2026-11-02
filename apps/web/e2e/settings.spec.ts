// Settings (UI overhaul, "The shell"): one area with a view per section, the section's name its h1. The old account and
// admin addresses lead to their section; on a phone "#/settings" is the list of sections.
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, headers, setPreferences } from './support.ts';

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

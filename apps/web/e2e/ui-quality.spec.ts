// Every page against the UI review's rules (docs/research/2026-10-03-ui-review.md), in English on a
// light desktop and in German on a dark phone: see expectGoodPage. Plus the behaviour the review
// asked for: focus after navigation, a quick "not found", field names with units, admin safeguards.
// Runs after the other specs (file order), so the data has two Divers and a split-off Dive by then.
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { E2E_BASE_URL, expectGoodPage, resetDive, seededDiveId, setPreferences } from './support.ts';

const headers = { origin: E2E_BASE_URL };
let diveId: string;
let invitationToken: string;
let resetToken: string;

/** A second, signed-out User's links: an Invitation, and a reset link for a User who accepted one. */
async function makeLinks(request: APIRequestContext, browser: Browser) {
  const stamp = Date.now();
  const used = await (await request.post('/api/invitations', { headers, data: { email: `member-${stamp}@example.com` } })).json();
  const anonymous = await browser.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] } });
  await anonymous.request.post('/api/invitations/accept', {
    headers, data: { token: used.url.split('/invite/')[1], name: `Member ${stamp}`, password: 'a long enough test password' },
  });
  await anonymous.close();
  const users = await (await request.get('/api/users')).json() as { id: string; email: string }[];
  const member = users.find((u) => u.email === `member-${stamp}@example.com`)!;
  resetToken = (await (await request.post(`/api/users/${member.id}/password-reset`, { headers })).json()).url.split('/reset/')[1];
  const open = await (await request.post('/api/invitations', { headers, data: { email: `guest-${stamp}@example.com` } })).json();
  invitationToken = open.url.split('/invite/')[1];
}

test.beforeAll(async ({ request, browser }) => {
  await setPreferences(request, { language: null, units: null }); // the browser's language decides
  diveId = await seededDiveId(request);
  await makeLinks(request, browser);
});

const variants = [
  { name: 'English, light, desktop', locale: 'en-GB', colorScheme: 'light' as const, viewport: { width: 1280, height: 900 }, english: true },
  { name: 'German, dark, phone', locale: 'de-DE', colorScheme: 'dark' as const, viewport: { width: 390, height: 844 }, english: false },
];

for (const v of variants) {
  test.describe(v.name, () => {
    test.use({ locale: v.locale, colorScheme: v.colorScheme, viewport: v.viewport });
    const title = (english: string) => (v.english ? english : undefined);

    test('logbook', async ({ page, request }) => {
      await resetDive(request);
      await page.goto('/');
      await expect(page.getByRole('table')).toBeVisible();
      await expectGoodPage(page, title('Logbook'));
    });

    test('dive, reading and editing', async ({ page }) => {
      await page.goto(`/#/dives/${diveId}`);
      await expect(page.locator('canvas').first()).toBeVisible();
      await expectGoodPage(page, title('Dive 42'));
      await page.getByRole('button', { name: v.english ? 'Edit dive' : 'Tauchgang bearbeiten' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Save' : 'Speichern' })).toBeVisible();
      await expectGoodPage(page, title('Dive 42'));
    });

    test('unknown dive', async ({ page }) => {
      await page.goto('/#/dives/00000000-0000-7000-8000-000000000000');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectGoodPage(page, title('Dive not found'));
    });

    test('Divers and Devices', async ({ page }) => {
      await page.goto('/#/divers');
      await expect(page.getByRole('table')).toBeVisible();
      await expectGoodPage(page, title('Divers'));
    });

    test('my account', async ({ page }) => {
      await page.goto('/#/account');
      await expect(page.getByRole('table')).toBeVisible();
      await expectGoodPage(page, title('My account'));
    });

    test('admin, with a link to pass on', async ({ page }) => {
      await page.goto('/#/admin');
      await page.getByRole('textbox', { name: v.english ? 'E-mail' : 'E-Mail' }).fill(`shown-${v.locale}@example.com`);
      await page.getByRole('button', { name: v.english ? 'Create invitation link' : 'Einladungslink erstellen' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Copy' : 'Kopieren' })).toBeVisible();
      await expectGoodPage(page, title('Admin'));
    });

    test.describe('signed out', () => {
      test.use({ storageState: { cookies: [], origins: [] } });

      test('sign-in, with errors', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: v.english ? 'Sign in' : 'Anmelden' }).click();
        await expect(page.getByRole('textbox').first()).toHaveAttribute('aria-invalid', 'true');
        await expectGoodPage(page, title('Sign in'));
      });

      test('setup', async ({ page }) => {
        await page.goto('/#/setup');
        await expectGoodPage(page, title('Set up Dive Hub'));
      });

      test('invitation', async ({ page }) => {
        await page.goto(`/#/invite/${invitationToken}`);
        await expect(page.getByRole('textbox').first()).toBeVisible();
        await expectGoodPage(page, title('Join Dive Hub'));
      });

      test('password reset link', async ({ page }) => {
        await page.goto(`/#/reset/${resetToken}`);
        await expect(page.getByRole('textbox').first()).toBeVisible();
        await expectGoodPage(page, title('Reset password'));
      });
    });
  });
}

test.describe('behaviour', () => {
  test.use({ locale: 'en-GB' });

  test('moving to another page puts focus on its heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('navigation').getByRole('link', { name: 'Divers' }).click();
    await expect(page.getByRole('heading', { name: 'Divers', level: 1 })).toBeFocused();
    await expect(page).toHaveTitle('Divers – Dive Hub');
  });

  test('an unknown dive says so at once, without retrying first', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('table')).toBeVisible();
    const started = Date.now();
    await page.evaluate(() => { location.hash = '/dives/00000000-0000-7000-8000-000000000000'; });
    await expect(page.getByRole('heading', { name: 'Dive not found' })).toBeVisible();
    expect(Date.now() - started).toBeLessThan(900); // a retry would wait a second first
    await expect(page.getByRole('link', { name: 'Logbook' }).last()).toBeVisible();
  });

  test('number fields name their unit and say what the recording has', async ({ page, request }) => {
    await resetDive(request);
    await page.goto(`/#/dives/${diveId}`);
    await page.getByRole('button', { name: 'Edit dive' }).click();
    const maxDepth = page.getByRole('textbox', { name: 'Max depth (m)' });
    await expect(maxDepth).toHaveAccessibleDescription('Recording: 18.5 m');
    await maxDepth.fill('20');
    await page.getByRole('button', { name: 'Save' }).click();
    // The value set by hand shows the recording's value as text, not in a tooltip.
    await expect(page.locator('dl.facts').first()).toContainText('Recording: 18.5 m');
    await resetDive(request);
  });

  test('the only admin is not offered to remove their own admin role', async ({ page }) => {
    await page.goto('/#/admin');
    const me = page.getByRole('row').filter({ hasText: 'erika@example.com' });
    await expect(me.getByRole('button', { name: /Password reset link/ })).toBeVisible();
    await expect(me.getByRole('button', { name: /Remove admin role/ })).toHaveCount(0);
  });
});

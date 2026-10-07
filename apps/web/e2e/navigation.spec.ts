// Moving between dives and around the app (UI redesign slice E, ADR 0042): previous and next in the order of the list the
// User came from, "Logbook" back to that list, and the navigation as a bar at the bottom of a phone.
import { expect, test } from '@playwright/test';
import { diveRows, expectGoodPage, setPreferences } from './support.ts';

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

const LIST = 'sort=duration&order=asc';

async function listedIds(request: import('@playwright/test').APIRequestContext) {
  const { dives } = await (await request.get('/api/dives?sort=duration&order=asc&limit=200')).json() as { dives: { id: string }[] };
  expect(dives.length, 'the seeded logbook has several dives').toBeGreaterThan(2);
  return dives.map((d) => d.id);
}

test('previous and next follow the list the dive was opened from, and Logbook goes back to it', { tag: ['@dives'] }, async ({ page, request }) => {
  const ids = await listedIds(request);
  await page.goto(`/#/?${LIST}`);
  await diveRows(page).first().getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/dives/${ids[0]}[?]list=`));

  const neighbours = page.getByRole('navigation', { name: 'Dives in the list' });
  // The first of the list has nothing before it; the control stays, and says so.
  await expect(neighbours.locator('[aria-disabled="true"]')).toHaveText('Previous dive');
  await expect(neighbours.getByText(new RegExp(`^1 of ${ids.length}$`))).toBeVisible();

  await neighbours.getByRole('link', { name: 'Next dive' }).click();
  await expect(page).toHaveURL(new RegExp(`/dives/${ids[1]}[?]list=`));
  await expect(neighbours.getByText(new RegExp(`^2 of ${ids.length}$`))).toBeVisible();
  // The new page starts at its title, as every page does.
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expectGoodPage(page);

  await neighbours.getByRole('link', { name: 'Previous dive' }).click();
  await expect(page).toHaveURL(new RegExp(`/dives/${ids[0]}[?]list=`));

  // "Logbook" is the list as it was: the sort is kept.
  await page.getByRole('main').getByRole('link', { name: 'Logbook' }).click();
  await expect(page).toHaveURL(new RegExp(`/#/[?]${LIST}$`));
});

test('a link to a dive without a list follows the whole logbook, newest first', { tag: ['@dives'] }, async ({ page, request }) => {
  const { dives } = await (await request.get('/api/dives?limit=3')).json() as { dives: { id: string }[] };
  await page.goto(`/#/dives/${dives[1]!.id}`);
  const neighbours = page.getByRole('navigation', { name: 'Dives in the list' });
  await neighbours.getByRole('link', { name: 'Previous dive' }).click();
  await expect(page).toHaveURL(new RegExp(`/dives/${dives[0]!.id}$`));
  await expect(page.getByRole('main').getByRole('link', { name: 'Logbook' })).toHaveAttribute('href', '#/');
});

test('a list that does not show the dive offers no neighbours', { tag: ['@dives'] }, async ({ page, request }) => {
  const { dives } = await (await request.get('/api/dives?limit=1')).json() as { dives: { id: string }[] };
  await page.goto(`/#/dives/${dives[0]!.id}?list=q%3Dzzzzzz`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dives in the list' })).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test('the navigation is a bar at the bottom, with icons and text, and the page is not hidden behind it', { tag: ['@layout'] }, async ({ page }) => {
    await page.goto('/');
    await expect(diveRows(page).first()).toBeVisible();
    const bar = page.getByRole('navigation', { name: 'Main' });
    const box = (await bar.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(780);
    for (const name of ['Logbook', 'Divers', 'Dive sites']) {
      const link = bar.getByRole('link', { name });
      await expect(link).toBeVisible();
      await expect(link.locator('svg')).toBeVisible();
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(bar.getByRole('link', { name: 'Logbook' })).toHaveAttribute('aria-current', 'page');
    // The header keeps the brand and the account, on one row.
    expect((await page.locator('.app-header').boundingBox())!.height).toBeLessThan(80);

    // The end of the page can be scrolled clear of the bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = (await page.locator('#main > *').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(box.y);

    await bar.getByRole('link', { name: 'Divers' }).click();
    await expect(page.getByRole('heading', { name: 'Divers', level: 1 })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Divers' })).toHaveAttribute('aria-current', 'page');
    await expect(bar.getByRole('link', { name: 'Logbook' })).not.toHaveAttribute('aria-current', 'page');
  });
});

test('on a wide screen the navigation stays in the header', { tag: ['@layout'] }, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const box = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
  expect(box.y).toBeLessThan(100);
});

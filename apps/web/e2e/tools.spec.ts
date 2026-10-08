// The Tools page's gas numbers and bottom time (ADR 0032, slice 21) in a real browser: Tim's nitrox dive from the data
// model's scenario 6, the inputs kept in the address, units, "outside recreational limits", and the estimate notice that
// is always on the page. The figures are tested in the server's planning tests; here: what the page asks and says.
import { expect, test } from '@playwright/test';
import { expectGoodPage, setPreferences } from './support.ts';

test.beforeAll(async ({ request }) => setPreferences(request, { language: 'en', units: 'metric' }));
test.afterAll(async ({ request }) => setPreferences(request, { language: null, units: null }));

test('gas numbers and a bottom time for 30 m on EAN32, with the assumptions and the notice', { tag: ['@tools'] }, async ({ page }) => {
  await page.goto('/#/tools');
  await expectGoodPage(page, 'Tools');
  // The estimate notice is on the page before anything is typed.
  await expect(page.locator('#main').getByText(/estimate, not advice/i)).toBeVisible();
  await expect(page.locator('#main').getByText(/dive computer and your training govern/i)).toBeVisible();

  await page.getByRole('textbox', { name: /^Oxygen/ }).fill('32');
  await page.getByRole('textbox', { name: /^Depth/ }).fill('30');
  await page.getByRole('textbox', { name: /^Depth/ }).press('Tab');

  const gas = page.getByRole('region', { name: 'Gas' });
  // 33.44 m and 39.66 m, shown rounded down; 1.29 bar and 34 % at 30 m (planning-gas.test.ts).
  await expect(gas.getByText('MOD at 1.4 bar')).toBeVisible();
  await expect(gas.getByText('33.4 m')).toBeVisible();
  await expect(gas.getByText('39.6 m')).toBeVisible();
  await expect(gas.getByText('1.29 bar')).toBeVisible();
  await expect(gas.getByText('34 %')).toBeVisible();

  // The address keeps what was typed.
  await expect(page).toHaveURL(/#\/tools\?.*o2=32/);
  await expect(page).toHaveURL(/depth=30/);

  const cylinder = page.getByRole('group', { name: 'Cylinder' });
  await cylinder.getByRole('textbox', { name: /^Volume/ }).fill('11.1');
  await cylinder.getByRole('textbox', { name: /^Fill pressure/ }).fill('200');
  await cylinder.getByRole('textbox', { name: /^Fill pressure/ }).press('Tab');

  const bottom = page.getByRole('region', { name: 'Bottom time' });
  await expect(bottom.getByTestId('bottom-time')).toHaveText(/^\d+ min$/);
  await expect(bottom.getByText(/Limited by/)).toBeVisible();
  // Each limit is shown, and the values that were assumed say where they came from (the Diver's own computer, once
  // other tests have imported a Recording with a gradient factor, else the default).
  for (const limit of ['No-decompression limit', 'Oxygen', 'Gas']) await expect(bottom.getByRole('row', { name: new RegExp(`^${limit}`) })).toBeVisible();
  await expect(bottom.getByText(/^Gradient factor high: \d+ % \((default|from your computer)\)$/)).toBeVisible();
  await expect(bottom.getByText(/^Gas use: [\d.]+ L\/min \((default|from your recent dives)\)$/)).toBeVisible();
  await expect(bottom.getByText('Water: salt (default)')).toBeVisible();
  await expect(bottom.getByText('No altitude given: sea level')).toBeVisible();
  await expect(bottom.getByText('Reserve: 50 bar (default)')).toBeVisible();
  await expect(page.locator('#main').getByText(/estimate, not advice/i)).toBeVisible();

  // A reload brings the same page back from the address.
  await page.reload();
  await expect(page.getByRole('textbox', { name: /^Oxygen/ })).toHaveValue('32');
  await expect(bottom.getByTestId('bottom-time')).toHaveText(/^\d+ min$/);
});

test('beyond the MOD there is no bottom time, only the reason and the MOD', { tag: ['@tools'] }, async ({ page }) => {
  await page.goto('/#/tools?o2=40&depth=36');
  const bottom = page.getByRole('region', { name: 'Bottom time' });
  await expect(bottom.getByText('Outside recreational limits')).toBeVisible();
  await expect(bottom.getByText(/beyond the MOD/)).toBeVisible();
  await expect(bottom.getByTestId('bottom-time')).toHaveCount(0);
  await expectGoodPage(page, 'Tools');

  // Deeper than 40 m.
  await page.goto('/#/tools?o2=21&depth=42');
  await expect(bottom.getByText(/deeper than 40 m/)).toBeVisible();

  // Trimix: gas numbers, no bottom time.
  await page.goto('/#/tools?o2=21&he=35&depth=30');
  await expect(page.getByRole('region', { name: 'Gas' }).getByText('MOD at 1.4 bar')).toBeVisible();
  await expect(bottom.getByText(/air and nitrox/i)).toBeVisible();
});

test('a mix under 16 % oxygen is refused with a reason', { tag: ['@tools'] }, async ({ page }) => {
  await page.goto('/#/tools?o2=15&he=50&depth=60');
  await expect(page.getByRole('alert')).toContainText(/16 %/);
});

test('imperial units: feet and psi in the fields and the answers, metres and bar in the address', { tag: ['@tools'] }, async ({ page, request }) => {
  await setPreferences(request, { units: 'imperial' });
  try {
    await page.goto('/#/tools?o2=32&depth=30&volume=11.1&pressure=200');
    // 30 m = 98 ft; the MOD at 1.4 bar, 33.4 m = 109.6 ft.
    await expect(page.getByRole('textbox', { name: /^Depth/ })).toHaveValue('98');
    await expect(page.getByRole('region', { name: 'Gas' }).getByText(/^109\.\d ft$/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Fill pressure/ })).toHaveValue('2,901');
    await expect(page).toHaveURL(/depth=30/);
  } finally {
    await setPreferences(request, { units: 'metric' });
  }
});

// A Diver's body weight (ADR 0031, slice A part 3) in a real browser: set on a date from the Divers page, shown in kg or
// lb, replaced by setting the same date again and removed; the dialog says who sees it, and a Diver nobody keeps has none.
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, expectGoodPage, setPreferences } from './support.ts';

const headers = { origin: E2E_BASE_URL };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => setPreferences(request, { language: null, units: 'metric' }));
test.afterAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
  const [own] = (await (await request.get('/api/divers')).json()) as { id: string }[];
  for (const date of ['2026-03-01', '2026-09-15']) await request.delete(`/api/divers/${own!.id}/body-weights/${date}`, { headers });
});

test('a body weight is set on a date, shown in kg or lb, replaced and removed', { tag: ['@divers'] }, async ({ page, request }) => {
  await page.goto('/#/divers');
  await page.getByRole('button', { name: /^Body weight: / }).first().click();
  const dialog = page.getByRole('dialog', { name: /^Body weight of / });
  await expect(dialog.getByText('Only you and the other Users who keep this Diver see it.')).toBeVisible();
  await expect(dialog.getByText('No body weight yet.')).toBeVisible();
  await expectGoodPage(page, 'Divers');

  const add = async (date: string, weight: string) => {
    // The form empties when the save is done; typing before that would lose the value.
    await expect(dialog.getByRole('textbox', { name: /^Weight/ })).toHaveValue('');
    await dialog.getByLabel('Date').fill(date);
    await dialog.getByRole('textbox', { name: /^Weight/ }).fill(weight);
    await dialog.getByRole('button', { name: 'Add weight' }).click();
    await expect(dialog.getByRole('textbox', { name: /^Weight/ })).toHaveValue('');
    await expect(dialog.getByText(`${weight} kg`)).toBeVisible();
  };
  await add('2026-03-01', '81.5');
  await expect(dialog.getByRole('listitem').filter({ hasText: '81.5 kg' })).toHaveCount(1);
  await add('2026-09-15', '83');
  await add('2026-03-01', '82');
  const rows = dialog.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('83 kg'); // the newest first
  await expect(rows.nth(1)).toContainText('82 kg');
  await expect(dialog.getByText('81.5 kg')).toHaveCount(0);

  // Pounds for imperial; the value kept is the same.
  await setPreferences(request, { units: 'imperial' });
  await page.reload();
  await page.getByRole('button', { name: /^Body weight: / }).first().click();
  await expect(dialog.getByRole('listitem').nth(0)).toContainText('183 lb');
  await expect(dialog.getByRole('listitem').nth(1)).toContainText('180.8 lb');

  await dialog.getByRole('button', { name: /^Remove: / }).first().click();
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await dialog.getByRole('button', { name: /^Remove: / }).click();
  await expect(dialog.getByText('No body weight yet.')).toBeVisible();
});

test('a Diver nobody keeps has no body weight section', { tag: ['@divers'] }, async ({ page, request }) => {
  await setPreferences(request, { units: 'metric' });
  await page.goto('/#/divers');
  const others = page.locator('section', { has: page.getByRole('heading', { name: 'Other divers' }) });
  await expect(others.getByRole('button', { name: /^Body weight/ })).toHaveCount(0);
});

// A Diver's certification cards (ADR 0050) in a real browser: typed by hand on the Divers page, edited and deleted; read from
// SSI against the e2e server's fake account (two invented cards) with their pictures, the imported card read-only apart from
// its notes; a card deleted stays deleted when the import runs again.
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, connectSsi, expectGoodPage, setPreferences } from './support.ts';

const headers = { origin: E2E_BASE_URL };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => setPreferences(request, { language: null, units: 'metric' }));
test.afterAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
  const [own] = (await (await request.get('/api/divers')).json()) as { id: string }[];
  const cards = (await (await request.get(`/api/divers/${own!.id}/certifications`)).json()) as { id: string }[];
  for (const c of cards) await request.delete(`/api/divers/${own!.id}/certifications/${c.id}`, { headers });
});

const open = async (page: import('@playwright/test').Page) => {
  await page.goto('/#/divers');
  await page.getByRole('button', { name: /^Certifications: / }).first().click();
  return page.getByRole('dialog', { name: /^Certifications of / });
};

test('a certification is typed, seen, edited and deleted', { tag: ['@divers'] }, async ({ page }) => {
  const dialog = await open(page);
  await expect(dialog.getByText('Only you and the other Users who keep this Diver see them.')).toBeVisible();
  await expect(dialog.getByText('No certifications yet.')).toBeVisible();
  await expectGoodPage(page, 'Divers');

  await dialog.getByRole('button', { name: 'Add certification' }).click();
  await dialog.getByRole('textbox', { name: /^Agency/ }).fill('PADI');
  await dialog.getByRole('textbox', { name: /^Course or level/ }).fill('Rescue Diver');
  await dialog.getByLabel('Issued').fill('2022-05-01');
  await dialog.getByRole('button', { name: 'Save certification' }).click();
  const card = dialog.getByRole('listitem').filter({ hasText: 'PADI Rescue Diver' });
  await expect(card).toContainText('Self-declared');
  await expectGoodPage(page, 'Divers');

  await card.getByRole('button', { name: /^Edit: / }).click();
  await dialog.getByText('I have seen the card').click();
  await dialog.getByRole('textbox', { name: 'Notes' }).fill('Seen at the dive base');
  await dialog.getByRole('button', { name: 'Save certification' }).click();
  await expect(card).toContainText('Card seen');
  await expect(card).toContainText('Seen at the dive base');

  await card.getByRole('button', { name: /^Delete…: / }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog').last()).getByRole('button', { name: 'Delete…' }).click();
  await expect(dialog.getByText('No certifications yet.')).toBeVisible();
});

test('cards are imported from SSI with their pictures, an imported card takes only notes, and a deleted one stays deleted', { tag: ['@divers', '@account'] }, async ({ page, request }) => {
  await connectSsi(request);
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Import from SSI' }).click();
  await expect(dialog.getByText('SSI: 2 new, 0 updated, 0 unchanged.')).toBeVisible();
  const owd = dialog.getByRole('listitem').filter({ hasText: 'SSI Open Water Diver' });
  await expect(owd).toContainText('Verified with the agency');
  await expect(owd).toContainText('Blue Hole Divers');
  // The picture is fetched afterwards by a job; the list looks again by itself.
  await expect(owd.getByRole('img', { name: /^Picture of the card/ })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => owd.getByRole('img', { name: /^Picture of the card/ }).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expectGoodPage(page, 'Divers');

  await owd.getByRole('button', { name: /^Edit: / }).click();
  await expect(dialog.getByText('This card was read from ssi.')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: /^Agency/ })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Notes' }).fill('Photo of the card in the drawer');
  await dialog.getByRole('button', { name: 'Save certification' }).click();
  await expect(owd).toContainText('Photo of the card in the drawer');

  const aa = dialog.getByRole('listitem').filter({ hasText: 'SSI Advanced Adventurer' });
  await aa.getByRole('button', { name: /^Delete…: / }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Delete…' }).click();
  await expect(aa).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Import from SSI' }).click();
  await expect(dialog.getByText('SSI: 0 new, 0 updated, 1 unchanged.')).toBeVisible();
  await expect(dialog.getByText('Advanced Adventurer: you deleted this card earlier; it stays deleted.')).toBeVisible();
  await expect(aa).toHaveCount(0);
});

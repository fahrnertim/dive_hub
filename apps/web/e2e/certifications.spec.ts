// A Diver's certification cards (ADR 0050) in a real browser, as a section of the Divers page (slice 25c): typed by hand,
// edited and deleted in a dialog; read from SSI against the e2e server's fake account (two invented cards) with their
// pictures, the imported card read-only apart from its notes; a card deleted stays deleted when the import runs again;
// an expired card says so and goes last; the profile menu's link lands on the open section.
import { expect, test, type Page } from '@playwright/test';
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

/** The own Diver's row (the first), found by its Certifications line. */
const ownRow = (page: Page) => page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Certifications: / }) }).first();
const sectionButton = (page: Page) => ownRow(page).getByRole('button', { name: /^Certifications: / });

/** The own Diver's row with its section open: in place on the page, not a dialog. */
const open = async (page: Page) => {
  await page.goto('/#/divers');
  if ((await sectionButton(page).getAttribute('aria-expanded')) !== 'true') await sectionButton(page).click();
  return ownRow(page);
};

test('a certification is typed, seen, edited and deleted', { tag: ['@divers'] }, async ({ page }) => {
  await page.goto('/#/divers');
  const row = ownRow(page);
  // Closed, the Diver's line already says there are no cards yet.
  await expect(row.getByText('No cards yet')).toBeVisible();
  await sectionButton(page).click();
  await expect(row.getByText('Only you and the other Users who keep this Diver see them.')).toBeVisible();
  await expect(row.getByText('No certifications yet.')).toBeVisible();
  await expectGoodPage(page, 'Divers');

  await row.getByRole('button', { name: 'Add certification' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Agency/ }).fill('PADI');
  await dialog.getByRole('textbox', { name: /^Course or level/ }).fill('Rescue Diver');
  await dialog.getByLabel('Issued').fill('2022-05-01');
  await dialog.getByRole('button', { name: 'Save certification' }).click();
  await expect(dialog).toHaveCount(0);
  const card = row.getByRole('listitem').filter({ hasText: 'PADI Rescue Diver' });
  await expect(card).toContainText('Self-declared');
  // The Diver's line follows without opening anything.
  await expect(row.getByText('1 card · Rescue Diver (PADI)')).toBeVisible();
  await expectGoodPage(page, 'Divers');

  await card.getByRole('button', { name: /^Edit: / }).click();
  await dialog.getByText('I have seen the card').click();
  await dialog.getByRole('textbox', { name: 'Notes' }).fill('Seen at the dive base');
  await dialog.getByRole('button', { name: 'Save certification' }).click();
  await expect(card).toContainText('Card seen');
  await expect(card).toContainText('Seen at the dive base');

  await card.getByRole('button', { name: /^Delete…: / }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Delete…' }).click();
  await expect(row.getByText('No certifications yet.')).toBeVisible();
  await expect(row.getByText('No cards yet')).toBeVisible();
});

test('the instructor and the centre sit behind "More details", and Save stays in view on a phone', { tag: ['@divers'] }, async ({ page }) => {
  const row = await open(page);
  await row.getByRole('button', { name: 'Add certification' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Instructor', exact: true })).toBeHidden();
  await dialog.getByRole('button', { name: 'More details' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Instructor', exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Dive centre', exact: true })).toBeVisible();
  // The form is longer than a phone's screen; its actions are still in the viewport.
  await page.setViewportSize({ width: 390, height: 640 });
  await expect(dialog.getByRole('button', { name: 'Save certification' })).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('cards are imported from SSI with their pictures, an imported card takes only notes, and a deleted one stays deleted', { tag: ['@divers', '@account'] }, async ({ page, request }) => {
  await connectSsi(request);
  const row = await open(page);
  await row.getByRole('button', { name: 'Import from SSI' }).click();
  await expect(row.getByText('SSI: 2 new, 0 updated, 0 unchanged.')).toBeVisible();
  const owd = row.getByRole('listitem').filter({ hasText: 'SSI Open Water Diver' });
  await expect(owd).toContainText('Verified with the agency');
  await expect(owd).toContainText('Blue Hole Divers');
  // The picture is fetched afterwards by a job; the list looks again by itself. A tile shows it small, as a button.
  const enlarge = owd.getByRole('button', { name: /^Show picture large/ });
  await expect(enlarge).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => enlarge.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expectGoodPage(page, 'Divers');

  // Pressed, the picture opens large in a dialog that closes again (the counter case: "show me your card").
  await enlarge.click();
  const large = page.getByRole('dialog', { name: /^Picture of the card SSI Open Water Diver/ });
  await expect(large.getByRole('img', { name: /^Picture of the card/ })).toBeVisible();
  await large.getByRole('button', { name: 'Close dialog' }).click();
  await expect(large).toHaveCount(0);
  await expect(enlarge).toBeFocused();

  await owd.getByRole('button', { name: /^Edit: / }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('This card was read from ssi.')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: /^Agency/ })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Notes' }).fill('Photo of the card in the drawer');
  await dialog.getByRole('button', { name: 'Save certification' }).click();
  await expect(owd).toContainText('Photo of the card in the drawer');

  const aa = row.getByRole('listitem').filter({ hasText: 'SSI Advanced Adventurer' });
  await aa.getByRole('button', { name: /^Delete…: / }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Delete…' }).click();
  await expect(aa).toHaveCount(0);

  await row.getByRole('button', { name: 'Import from SSI' }).click();
  await expect(row.getByText('SSI: 0 new, 0 updated, 1 unchanged.')).toBeVisible();
  await expect(row.getByText('Advanced Adventurer: you deleted this card earlier; it stays deleted.')).toBeVisible();
  await expect(aa).toHaveCount(0);
});

test('an expired card says so in words, goes last and is counted on the Diver’s line', { tag: ['@divers'] }, async ({ page, request }) => {
  // Start from none: the import test left cards behind.
  const [own] = (await (await request.get('/api/divers')).json()) as { id: string }[];
  for (const c of (await (await request.get(`/api/divers/${own!.id}/certifications`)).json()) as { id: string }[]) {
    await request.delete(`/api/divers/${own!.id}/certifications/${c.id}`, { headers });
  }
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const post = (body: object) => request.post(`/api/divers/${own!.id}/certifications`, { data: body, headers });
  // The expired card is the one issued last: by issue date it would be first.
  await post({ agency: 'ERC', level: 'Emergency First Response', issuedOn: '2024-06-01', expiresOn: day(-5) });
  await post({ agency: 'DAN', level: 'Oxygen Provider', issuedOn: '2020-06-01', expiresOn: day(30) });
  await post({ agency: 'CMAS', level: 'Two Star', issuedOn: '2019-06-01' });

  await page.goto('/#/divers');
  const row = ownRow(page);
  // Said while closed: the count, the newest valid card, what expires soon and what has expired.
  await expect(row.getByText('3 cards · Oxygen Provider (DAN)')).toBeVisible();
  await expect(row.getByText('1 expires soon')).toBeVisible();
  await expect(row.getByText('1 expired')).toBeVisible();

  await sectionButton(page).click();
  const tiles = row.getByRole('list', { name: 'Certification cards' }).getByRole('listitem');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.nth(0)).toContainText('Oxygen Provider');
  await expect(tiles.nth(0)).toContainText('Expires soon');
  await expect(tiles.nth(1)).toContainText('Two Star');
  await expect(tiles.nth(2)).toContainText('Emergency First Response');
  await expect(tiles.nth(2)).toContainText('Expired');
  await expectGoodPage(page, 'Divers');
  await page.setViewportSize({ width: 320, height: 700 });
  await expectGoodPage(page, 'Divers');
});

test('"My certifications" in the profile menu lands on the own Diver’s open section, and the address says which is open', { tag: ['@divers', '@account'] }, async ({ page }) => {
  await page.goto('/#/account');
  await page.getByRole('button', { name: /, account$/ }).click();
  await page.getByRole('menuitem', { name: 'My certifications' }).click();
  await expect(page).toHaveURL(/#\/divers\?certifications=/);
  await expect(sectionButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(ownRow(page).getByText('Only you and the other Users who keep this Diver see them.')).toBeVisible();
  // A reload keeps it open; closing it takes it out of the address.
  await page.reload();
  await expect(sectionButton(page)).toHaveAttribute('aria-expanded', 'true');
  await sectionButton(page).click();
  await expect(page).not.toHaveURL(/certifications=/);
});

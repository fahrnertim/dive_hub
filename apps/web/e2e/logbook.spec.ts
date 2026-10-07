// The logbook's rows in a real browser (ADR 0040, UI redesign slice C): what a row says, the months and totals around
// the list, buddies as circles with their names as text, and "Show only" with its counts, in the address.
import { expect, test } from '@playwright/test';
import { clearParticipants, diveRows, diveWithoutRecording, externalDiver, leaveLena, seededDiveId, setBuddies, setPreferences } from './support.ts';

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});
// diveWithoutRecording connects Lena to SSI; other specs expect only Erika's Connection.
test.afterEach(async ({ request }) => {
  await leaveLena(request);
});

test('a row says its number, when and with whom; a month heading and the logbook\'s totals frame the list', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await seededDiveId(request);
  await setBuddies(request, id, [await externalDiver(request, 'Kai Lund'), await externalDiver(request, 'Ulla Berg')]);
  try {
    await page.goto('/#/?q=42');
    const row = diveRows(page).filter({ hasText: 'Number 42' });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('link')).toHaveAttribute('href', `#/dives/${id}?list=q%3D42`);
    // Circles with two letters for the eye; the names and roles are text for screen readers.
    await expect(row.getByText('KL', { exact: true })).toBeVisible();
    await expect(row.getByText('UB', { exact: true })).toBeVisible();
    await expect(row).toContainText('with Kai Lund (Buddy) and Ulla Berg (Buddy)');

    // Sorted by date: the row stands under its month, which counts all its dives.
    const list = page.getByRole('region', { name: 'Dives' });
    await expect(list.getByRole('heading', { level: 2 })).toHaveCount(1);
    await expect(list.getByText(/^1 dive · \d+ min$/)).toBeVisible();

    // The whole logbook's numbers, whatever is searched for.
    const { totals } = await (await request.get('/api/dives?limit=1')).json() as { totals: { dives: number } };
    const numbers = page.getByRole('group', { name: 'In total' });
    await expect(numbers.getByText('Under water')).toBeVisible();
    await expect(numbers.getByRole('definition').first()).toHaveText(String(totals.dives));

    // The row is one large target; its link is the way in for keyboard and screen readers.
    await row.getByText('KL', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dive 42', level: 1 })).toBeVisible();
  } finally {
    await clearParticipants(request, id);
  }
});

test('a row sketches its dive from the recorded profile; a dive without a recording has an empty dashed box instead', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await seededDiveId(request);
  const without = await diveWithoutRecording(request);
  const { dives } = await (await request.get('/api/dives?limit=200')).json() as { dives: { id: string; profile: { depthsM: number[] } | null }[] };
  expect(dives.find((d) => d.id === id)!.profile!.depthsM.length).toBe(48);
  expect(dives.find((d) => d.id === without)!.profile).toBeNull();

  await page.goto('/#/?q=42');
  const row = diveRows(page).filter({ hasText: 'Number 42' });
  await expect(row.locator('svg.sketch path.sketch-line')).toHaveCount(1);
  // The sketch is decoration: nothing for a screen reader to stop at, and it stays inside its box.
  await expect(row.locator('.sketch')).toHaveAttribute('aria-hidden', 'true');
  await expect(row.locator('.sketch')).toBeVisible(); // boundingBox() doesn't wait, and is null until it is
  expect((await row.locator('.sketch').boundingBox())!.width).toBeGreaterThan(60);

  await page.goto('/#/?only=no-recording');
  const empty = diveRows(page).first();
  await expect(empty.locator('.sketch-empty')).toHaveCount(1);
  await expect(empty.locator('svg.sketch')).toHaveCount(0);
  await expect(empty).toContainText('No recording');
});

test('"Show only" narrows the logbook: the chips keep their counts, live in the address, and no result offers all dives', { tag: ['@dives'] }, async ({ page, request }) => {
  await diveWithoutRecording(request);
  const { counts, total } = await (await request.get('/api/dives')).json() as {
    total: number; counts: { noRecording: number; noSite: number; withFindings: number; notAtProvider: number };
  };
  expect(counts.noRecording).toBeGreaterThan(0);
  const shown = (n: number) => Math.min(25, n);

  await page.goto('/');
  const chips = page.getByRole('group', { name: 'Show only' });
  const noRecording = chips.getByRole('button', { name: /^No recording \d+$/ });
  await expect(noRecording).toHaveText(`No recording${counts.noRecording}`);
  await expect(noRecording).toHaveAttribute('aria-pressed', 'false');
  // A filter that would show nothing isn't offered.
  for (const [name, count] of [['No dive site', counts.noSite], ['With findings', counts.withFindings], ['Not in SSI', counts.notAtProvider]] as const) {
    await expect(chips.getByRole('button', { name: `${name} ${count}`, exact: true })).toHaveCount(count > 0 ? 1 : 0);
  }

  await noRecording.click();
  await expect(page).toHaveURL(/#\/\?only=no-recording$/);
  await expect(noRecording).toHaveAttribute('aria-pressed', 'true');
  await expect(noRecording).toBeFocused();
  await expect(diveRows(page)).toHaveCount(shown(counts.noRecording));
  await expect(diveRows(page).filter({ hasText: 'No recording' })).toHaveCount(shown(counts.noRecording));
  await expect(page.getByText(new RegExp(`^1–${shown(counts.noRecording)} of ${counts.noRecording} dives?$`))).toBeVisible();

  // A reload keeps the filter; the count stays what it was.
  await page.reload();
  await expect(noRecording).toHaveAttribute('aria-pressed', 'true');

  // Nothing fits: the filters are named and all dives are one press away.
  await page.getByRole('searchbox', { name: 'Search' }).fill('no such words');
  await expect(page.getByText('No dives match “no such words” and these filters: No recording.')).toBeVisible();
  await expect(noRecording).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Show all dives' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeFocused();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
  await expect(diveRows(page)).toHaveCount(shown(total));

  // Two filters must both fit; released again, the address is the plain logbook's.
  await page.goto('/#/?only=no-site,no-recording');
  await expect(noRecording).toHaveAttribute('aria-pressed', 'true');
  const noSite = chips.getByRole('button', { name: /^No dive site \d+$/ });
  await expect(noSite).toHaveAttribute('aria-pressed', 'true');
  await noSite.click();
  await expect(page).toHaveURL(/#\/\?only=no-recording$/);
  await noRecording.click();
  await expect(page).toHaveURL(/#\/$/);
});

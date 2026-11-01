// Appending a Continuation in a real browser (ADR 0063): a dive cut in two by a surface break becomes one Dive, asked
// first, from the later one's page; its profile shows the time at the surface, and the two recordings are its parts.
// Fixtures: e2e/fixtures/surface-break-first.fit and surface-break-second.fit, the owner's dive 85/86 with a surface
// break of 241 s (apps/server/test/fixtures/write-continuation-fixture.ts).
import { expect, test } from '@playwright/test';
import { diveNumber, openLine, setPreferences, surfaceBreakPair } from './support.ts';

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

test('appends the dive after a surface break from the dive page, after asking', { tag: ['@dives'] }, async ({ page, request }) => {
  const { first, second } = await surfaceBreakPair(request);
  const [n, m] = [await diveNumber(request, first), await diveNumber(request, second)];
  try {
    const main = page.locator('#main');
    await page.goto(`/#/dives/${second}`);
    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('menuitem', { name: 'Append to the previous dive…' }).click();

    // The earlier dive stays, the later one goes, and the dialog says how long the surface break was.
    const dialog = page.getByRole('dialog', { name: 'Append this dive to the previous one?' });
    await expect(dialog.getByText(new RegExp(`^Stays: Dive ${n} · `))).toBeVisible();
    await expect(dialog.getByText(new RegExp(`^Goes to “Deleted dives”: Dive ${m} · `))).toBeVisible();
    await expect(dialog).toContainText('at the surface for 4 min');
    await dialog.getByRole('button', { name: 'Append', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // One Dive with one profile; the break in it and with the duration; the two recordings as its parts.
    await expect(page).toHaveURL(new RegExp(`#/dives/${first}`));
    await expect(page.getByRole('heading', { name: `Dive ${n}`, level: 1 })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Depth profile' })).toHaveCount(1);
    await expect(main.getByText('Surface break 4 min')).toBeVisible();
    await expect(main.getByText('4 min at the surface', { exact: true })).toBeVisible();
    const parts = page.getByRole('list', { name: 'Parts of this recording' });
    await expect(parts.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Recording actions/ })).toHaveCount(0);

    await openLine(page, 'History');
    await expect(main.getByText('Later dive appended').first()).toBeVisible();
    await expect(main.getByText('A later dive was appended to this one as its continuation')).toBeVisible();
  } finally {
    await surfaceBreakPair(request); // two dives again, so other specs find no deleted one
  }
});

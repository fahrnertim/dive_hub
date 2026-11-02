// Appending a Continuation in a real browser (ADR 0063): a dive cut in two by a surface break becomes one Dive, asked
// first, from the later one's page; its profile shows the time at the surface, and the two recordings are its parts.
// Fixtures: e2e/fixtures/surface-break-first.fit and surface-break-second.fit, the owner's dive 85/86 with a surface
// break of 241 s (apps/server/test/fixtures/write-continuation-fixture.ts).
import { expect, test } from '@playwright/test';
import { diveNumber, headers, openLine, setPreferences, surfaceBreakPair } from './support.ts';

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

test('suggests the pair in Needs your decision and appends on Anhängen', { tag: ['@dives'] }, async ({ page, request }) => {
  const { first, second } = await surfaceBreakPair(request);
  const [n, m] = [await diveNumber(request, first), await diveNumber(request, second)];
  // surfaceBreakPair answered "two dives" for the other specs: asked about again.
  await request.put('/api/logbook-checks/answer', { data: { diveIds: [first, second], answer: null }, headers });
  try {
    await page.goto('/#/review');
    // The card lists both dives and the surface break between them, and says what appending does.
    const card = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Append…: / }) });
    await expect(card.getByRole('link', { name: `Dive ${n}`, exact: true })).toBeVisible();
    await expect(card.getByRole('link', { name: `Dive ${m}`, exact: true })).toBeVisible();
    await expect(card.getByText('Surface break 4 min')).toBeVisible();
    await expect(page.getByText(/they are one dive with one profile/)).toBeVisible();
    // Never among the clear pairs merged in one go.
    await expect(page.getByRole('button', { name: /^Merge the \d+ clear pairs/ })).toHaveCount(0);

    await card.getByRole('button', { name: `Append…: Dive ${n} and Dive ${m}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Append the later dive to the earlier one?' });
    await expect(dialog.getByText(new RegExp(`^Stays: Dive ${n} · `))).toBeVisible();
    await expect(dialog.getByText(new RegExp(`^Goes to “Deleted dives”: Dive ${m} · `))).toBeVisible();
    await dialog.getByRole('button', { name: 'Append', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // One dive, on the Review page still; the check is gone.
    await expect(page).toHaveURL(/#\/review$/);
    await expect(page.getByRole('button', { name: /^Append…: / })).toHaveCount(0);
    expect((await request.get(`/api/dives/${second}`)).status()).toBe(404);
  } finally {
    await surfaceBreakPair(request); // two dives again, so other specs find no deleted one
  }
});

test('restoring the appended dive separates them again', { tag: ['@dives'] }, async ({ page, request }) => {
  const { first, second } = await surfaceBreakPair(request);
  const [n, m] = [await diveNumber(request, first), await diveNumber(request, second)];
  const version = async (id: string) => ((await (await request.get(`/api/dives/${id}`)).json()) as { version: number }).version;
  await request.post(`/api/dives/${first}/continuation`, { data: { version: await version(first), dives: [{ id: second, version: await version(second) }] }, headers });
  try {
    await page.goto('/#/review?tab=deleted');
    // Appended, the later dive has no number of its own: it is named by its time.
    const row = page.getByRole('listitem').filter({ hasText: `Appended to Dive ${n}.` });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('link', { name: 'Open that dive' })).toHaveAttribute('href', `#/dives/${first}`);

    // Asked first, naming every dive that comes back.
    await row.getByRole('button', { name: /^Restore: Oct 26, 2026/ }).click();
    const dialog = page.getByRole('dialog', { name: /^Restore Oct 26, 2026, .*\?$/ });
    await expect(dialog).toContainText(/Oct 26, 2026, .+ comes back as a dive of its own, with its recording\./);
    await expect(dialog).toContainText(`Dive ${n} keeps what it took over from it:`);
    await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveCount(0);

    // Two dives in the logbook again, each with its profile.
    for (const [id, number] of [[first, n], [second, m]] as const) {
      await page.goto(`/#/dives/${id}`);
      await expect(page.getByRole('heading', { name: `Dive ${number}`, level: 1 })).toBeVisible();
      await expect(page.getByRole('img', { name: 'Depth profile' })).toHaveCount(1);
      await expect(page.getByText(/^Surface break /)).toHaveCount(0);
    }
    // The check doesn't come back: restoring said "two dives".
    const open = await (await request.get('/api/logbook-checks?status=open')).json() as { rule: string; dive: { id: string } }[];
    expect(open.filter((c) => c.rule === 'surface_break' && c.dive.id === first)).toHaveLength(0);
    await page.goto('/#/review?tab=decided');
    await expect(page.getByRole('button', { name: `Ask again: Dive ${n} and Dive ${m}` })).toBeVisible();
  } finally {
    await surfaceBreakPair(request);
  }
});

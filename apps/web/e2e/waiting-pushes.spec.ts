// Sending by itself (ADR 0056) as the User sees it: a Dive that waits to go to SSI, is held for something the User has
// to do, or stopped (Retry), in the logbook and on the Dive's page; and the delete that SSI's Connection does by itself.
// The e2e server's worker settles real entries within a minute, so the states that must stay are put into the queue
// by test-only routes (apps/server/test/e2e-server.ts); the saves and the delete are real.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clearQueue, connectSsi, deletableDive, diveNumber, diveRows, editElsewhere, fetchState, headers, leaveConflict, leaveSsi, openLine, queueEntry, readyForSsi, sendToSsi, setPreferences, ssiConnectionOf } from './support.ts';

test.describe.configure({ mode: 'serial' });

type Status = { connection: { id: string } | null; waiting: { state: string; reason: string | null; action: string } | null; deletesItself: boolean };
const status = async (api: APIRequestContext, id: string) => await (await api.get(`/api/dives/${id}/providers/ssi`)).json() as Status;
const settings = (api: APIRequestContext, connectionId: string, data: Record<string, boolean | number | null>) =>
  api.patch(`/api/connections/${connectionId}`, { data, headers });
/** The logbook row of the Dive, found by its number. */
const rowOf = (page: Page, n: number) => diveRows(page).filter({ hasText: new RegExp(`Number ${n}(?!\\d)`) });
const deletedPanel = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Deleted dives' }) });

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

/** Dive 9 is out of SSI and in the logbook, the queue is empty and the Connection sends nothing by itself. */
async function leave(request: APIRequestContext) {
  await clearQueue(request);
  await connectSsi(request);
  const id = await deletableDive(request);
  const connectionId = await ssiConnectionOf(request, id);
  await settings(request, connectionId, { sendChanges: false, sendNewDives: false, deleteAtProvider: false, fetchEveryMinutes: null });
  await fetchState(request, connectionId, { clear: true });
  await leaveConflict(request);
  await leaveSsi(request, id);
}

test('a saved Dive shows waiting in the logbook and on its page', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  try {
    await sendToSsi(request, id);
    await settings(request, await ssiConnectionOf(request, id), { sendChanges: true });
    await editElsewhere(request, id, 'A turtle at the drop-off');
    expect((await status(request, id)).waiting).toMatchObject({ state: 'waiting', action: 'send' });
    const n = await diveNumber(request, id);

    await page.goto('/#/');
    await expect(rowOf(page, n).getByText('Waiting to send to SSI')).toBeVisible();

    await page.goto(`/#/dives/${id}`);
    await openLine(page, 'SSI');
    const line = page.getByRole('group', { name: 'SSI' });
    await expect(line.getByText('Waiting to send to SSI')).toBeVisible();
    // The manual Send stays, and sends at once: the entry is gone.
    await line.getByRole('button', { name: 'Update in SSI' }).click();
    await expect(page.locator('#main').getByText('Up to date')).toBeVisible();
    await expect(line.getByText('Waiting to send to SSI')).toBeHidden();
    expect((await status(request, id)).waiting).toBeNull();
  } finally {
    await leave(request);
  }
});

test('a stopped Dive shows the error and Retry puts it back', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  try {
    await leaveSsi(request, id);
    await queueEntry(request, id, { state: 'stopped', reason: 'provider_unavailable' });
    const n = await diveNumber(request, id);

    await page.goto('/#/');
    await expect(rowOf(page, n).getByText(/^Couldn’t send to SSI: SSI didn’t answer as expected/)).toBeVisible();

    await page.goto(`/#/dives/${id}`);
    await openLine(page, 'SSI');
    const line = page.getByRole('group', { name: 'SSI' });
    await expect(line.getByText(/^Couldn’t send to SSI: SSI didn’t answer as expected/)).toBeVisible();
    await line.getByRole('button', { name: 'Retry' }).click();
    // The stopped state is gone, and focus went from the button that left to the words that replace it. What the
    // worker makes of the entry afterwards (it acts on minute ticks) is for the server tests.
    await expect(line.getByText(/^Couldn’t send to SSI/)).toBeHidden();
    await expect(line.locator('.waiting-push-text')).toBeFocused();
    await expect(line.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  } finally {
    await leave(request);
  }
});

test('a stopped Dive in the logbook has its own Retry, and focus stays in the row', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  try {
    await leaveSsi(request, id);
    await queueEntry(request, id, { state: 'stopped', reason: 'provider_unavailable' });
    const n = await diveNumber(request, id);
    await page.goto('/#/');
    const row = rowOf(page, n);
    await expect(row.getByText(/^Couldn’t send to SSI/)).toBeVisible();
    await row.getByRole('button', { name: `Retry: Number ${n}` }).click();
    // Retry doesn't open the Dive; the stopped words are gone and focus is on what replaced them.
    await expect(row.getByText(/^Couldn’t send to SSI/)).toBeHidden();
    await expect(page).toHaveURL(/#\/$/);
    await expect(row.locator('.waiting-push-text')).toBeFocused();
  } finally {
    await leave(request);
  }
});

test('a Dive without a site says it needs one', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  try {
    await queueEntry(request, id, { state: 'held', reason: 'requirements' });
    const n = await diveNumber(request, id);
    await page.goto('/#/');
    const row = rowOf(page, n);
    await expect(row.getByText('Needs a site with a position before it can go to SSI')).toBeVisible();
    // The row links to the Dive, where it is fixed.
    await row.getByRole('link', { name: 'See what is needed' }).click();
    await expect(page).toHaveURL(new RegExp(`#/dives/${id}`));
    // A held Dive opens its line by itself.
    const line = page.getByRole('group', { name: 'SSI' });
    await expect(line.getByText('Needs a site with a position before it can go to SSI')).toBeVisible();
    // Next to the words, a button takes you to what the Dive lacks.
    await line.getByRole('button', { name: 'See what is needed' }).click();
    await expect(line.locator('.provider-needs')).toBeFocused();
  } finally {
    await leave(request);
  }
});

test('saving while the Connection needs a sign-in says so at once', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  try {
    await sendToSsi(request, id);
    const connectionId = await ssiConnectionOf(request, id);
    await settings(request, connectionId, { sendChanges: true });
    await request.post('/e2e/connection/needs-sign-in', { data: { id: connectionId }, headers });
    await editElsewhere(request, id, 'Seen from the boat');
    await page.goto(`/#/dives/${id}`);
    await expect(page.getByRole('group', { name: 'SSI' }).getByText('Won’t be sent to SSI until you sign in')).toBeVisible();
    const n = await diveNumber(request, id);
    await page.goto('/#/');
    await expect(rowOf(page, n).getByText('Won’t be sent to SSI until you sign in')).toBeVisible();
  } finally {
    await leave(request);
  }
});

test('the delete dialog doesn\'t ask for a Provider that deletes by itself, and the deleted dives list says when', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  try {
    await sendToSsi(request, id);
    await settings(request, await ssiConnectionOf(request, id), { deleteAtProvider: true });
    expect((await status(request, id)).deletesItself).toBe(true);
    const n = await diveNumber(request, id);

    await page.goto(`/#/dives/${id}`);
    await page.getByRole('button', { name: `More: Dive ${n}` }).click();
    await page.getByRole('menuitem', { name: 'Delete dive…' }).click();
    const dialog = page.getByRole('dialog', { name: `Delete Dive ${n}?` });
    await expect(dialog).toContainText('will be deleted there in 5 minutes. Undo cancels it.');
    await expect(dialog.getByRole('button', { name: 'Delete here and in SSI' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Delete only here' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Delete dive' }).click();
    await expect(page.locator('#main').getByText(`Dive ${n} deleted.`)).toBeVisible();
    // The notice says the delete in the Provider waits, and that Undo cancels it.
    await expect(page.locator('#main').getByText('It will be deleted in SSI in 5 minutes. Undo cancels that.')).toBeVisible();

    await page.goto('/#/review?tab=deleted');
    const panel = deletedPanel(page);
    await expect(panel.getByText('Will be deleted in SSI in 5 min')).toBeVisible();
    // Restoring cancels it.
    await panel.getByRole('button', { name: /^Restore: Mar 5, 2026/ }).click();
    // Other specs may leave deleted dives, so the list itself can stay; this dive's wait is what goes.
    await expect(panel.getByText('Will be deleted in SSI in 5 min')).toHaveCount(0);
    expect((await status(request, id)).waiting).toBeNull();
  } finally {
    await leave(request);
  }
});

test('a delete that stopped shows the error in the deleted dives and Retry puts it back', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await deletableDive(request);
  try {
    await sendToSsi(request, id);
    const connectionId = await ssiConnectionOf(request, id);
    await settings(request, connectionId, { deleteAtProvider: true });
    const { version } = await (await request.get(`/api/dives/${id}`)).json() as { version: number };
    await request.delete(`/api/dives/${id}`, { data: { version }, headers });
    await queueEntry(request, id, { action: 'delete', state: 'stopped', reason: 'provider_unavailable', connectionId });

    await page.goto('/#/review?tab=deleted');
    const panel = deletedPanel(page);
    await expect(panel.getByText(/^Couldn’t delete it in SSI: SSI didn’t answer as expected/)).toBeVisible();
    await panel.getByRole('button', { name: /^Retry/ }).click();
    // Due at once, so the worker may have deleted it by the time the list refreshes: either way the error is gone.
    await expect(panel.getByText(/^Couldn’t delete it in SSI/)).toBeHidden();
    await expect.poll(async () => {
      const { dives } = await (await request.get('/api/dives/deleted')).json() as { dives: { id: string; waiting: { state: string }[] }[] };
      return dives.find((d) => d.id === id)?.waiting.find((w) => w.state === 'stopped');
    }).toBeUndefined();
  } finally {
    await leave(request);
  }
});

/** The Connection's automatic settings on the account page. */
const automatic = (page: Page) => page.getByRole('region', { name: 'Automatic: Erika' });
const openConnections = async (page: Page) => { await page.goto('/#/account?tab=connections'); await expect(automatic(page)).toBeVisible(); };
const connectionRow = async (api: APIRequestContext, connectionId: string) =>
  ((await (await api.get('/api/connections')).json()) as { id: string; sendChanges: boolean; fetchEveryMinutes: number | null; unsentDives: string[] }[]).find((c) => c.id === connectionId);

test('the settings show only what the Provider offers and 6 hours is preselected', { tag: ['@account'] }, async ({ page, request }) => {
  await connectSsi(request);
  const id = await deletableDive(request);
  try {
    // A Provider that can't delete and fetches every 6 hours at the soonest: the page shows what `offers` lists.
    const narrowed = (row: { offers: Record<string, unknown> }) => ({ ...row, offers: { ...row.offers, deleteAtProvider: false, fetchEvery: [360, 1440] } });
    await page.route('**/api/connections', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ status: response.status(), json: ((await response.json()) as { offers: Record<string, unknown> }[]).map(narrowed) });
    });
    await page.route('**/api/connections/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const response = await route.fetch();
      return route.fulfill({ status: response.status(), json: narrowed(await response.json() as { offers: Record<string, unknown> }) });
    });
    await openConnections(page);
    const settingsOf = automatic(page);
    await expect(settingsOf.getByRole('switch', { name: 'Send changes automatically' })).toBeVisible();
    await expect(settingsOf.getByRole('switch', { name: 'Send new dives automatically' })).toBeVisible();
    await expect(settingsOf.getByRole('switch', { name: 'Delete at SSI when I delete here' })).toHaveCount(0);
    await expect(settingsOf.getByRole('radio')).toHaveCount(0);

    const connectionId = await ssiConnectionOf(request, id);
    await settingsOf.getByText('Send changes automatically', { exact: true }).click();
    await expect(settingsOf.getByRole('switch', { name: 'Send changes automatically' })).toBeChecked();
    await expect.poll(async () => (await connectionRow(request, connectionId))?.sendChanges).toBe(true);

    await settingsOf.getByText('Fetch from SSI', { exact: true }).click();
    const every = settingsOf.getByRole('radiogroup', { name: 'How often' });
    await expect(every.getByRole('radio', { name: 'every 6 hours' })).toBeChecked();
    await expect(every.getByRole('radio', { name: 'once a day' })).toBeVisible();
    // The interval 60 is not offered here, and what is chosen is kept.
    await expect(every.getByRole('radio', { name: 'every hour' })).toHaveCount(0);
    await expect.poll(async () => (await connectionRow(request, connectionId))?.fetchEveryMinutes).toBe(360);
    await every.getByText('once a day').click();
    await expect.poll(async () => (await connectionRow(request, connectionId))?.fetchEveryMinutes).toBe(1440);
    // Off again: the choice goes.
    await settingsOf.getByText('Fetch from SSI', { exact: true }).click();
    await expect(every).toHaveCount(0);
  } finally {
    await leave(request);
  }
});

test('the delete setting\'s help text says what restoring does', { tag: ['@account'] }, async ({ page, request }) => {
  try {
    await connectSsi(request);
    await openConnections(page);
    const toggle = automatic(page).getByRole('switch', { name: 'Delete at SSI when I delete here' });
    await expect(toggle).toBeVisible();
    const help = 'Restoring the dive later creates it at SSI again as a new entry, and a verification it had there is lost. Dive Hub can’t see whether a dive there is verified.';
    await expect(automatic(page).getByText(help)).toBeVisible();
    await expect(toggle).toHaveAccessibleDescription(help);
  } finally {
    await leave(request);
  }
});

test('the Connection shows the last fetch and how many wait', { tag: ['@account'] }, async ({ page, request }) => {
  await connectSsi(request);
  const id = await deletableDive(request);
  try {
    const connectionId = await ssiConnectionOf(request, id);
    await fetchState(request, connectionId, { clear: true });
    await openConnections(page);
    await expect(automatic(page).getByText(/^Last fetched/)).toHaveCount(0);

    await fetchState(request, connectionId, { created: 2, updated: 1, skipped: 3 });
    await queueEntry(request, id, { state: 'held', reason: 'requirements' });
    await page.reload();
    await expect(automatic(page).getByText(/^Last fetched .+: 2 new, 1 updated, 3 wait for you$/)).toBeVisible();
    await expect(automatic(page).getByText('1 held')).toBeVisible();

    // The ones that wait lead to the import that asks.
    await automatic(page).getByRole('button', { name: 'Decide them in an import' }).click();
    await expect(page.locator('h3[id^="import-"]')).toBeFocused();
  } finally {
    await leave(request);
  }
});

test('the offer of unsent new dives opens a Push run', { tag: ['@account'] }, async ({ page, request }) => {
  await connectSsi(request);
  const id = await deletableDive(request);
  try {
    await readyForSsi(request, id);
    const connectionId = await ssiConnectionOf(request, id);
    await fetchState(request, connectionId, { created: 1, unsent: [id] });
    await openConnections(page);
    const offer = automatic(page).getByRole('group', { name: '1 new dive wasn’t sent automatically' });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Send them to SSI' }).click();
    // The run's own dialog, for exactly these dives: no choice of scope.
    const dialog = page.getByRole('dialog', { name: 'Send dives to SSI' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radiogroup')).toHaveCount(0);
    await expect(dialog.getByText('1 new dive')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Send 1 dive' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(dialog).toBeHidden();
    await expect(offer).toBeVisible();

    await offer.getByRole('button', { name: 'Dismiss' }).click();
    await expect(offer).toBeHidden();
    expect((await connectionRow(request, connectionId))?.unsentDives).toEqual([]);
  } finally {
    await leave(request);
  }
});

test("an Import's result says its new dives weren't sent and leads to the Connection's settings", { tag: ['@account', '@dives'] }, async ({ page, request }) => {
  await connectSsi(request);
  const id = await deletableDive(request);
  try {
    const connectionId = await ssiConnectionOf(request, id);
    await fetchState(request, connectionId, { created: 1, unsent: [id] });
    await page.goto('/#/review?tab=imports');
    const line = page.getByText('1 new dive wasn’t sent to SSI by itself.');
    await expect(line).toBeVisible();
    await page.getByRole('link', { name: 'Open the SSI settings to send them' }).first().click();
    await expect(page.getByRole('heading', { name: 'Automatic: Erika' })).toBeFocused();
    await expect(automatic(page).getByRole('group', { name: '1 new dive wasn’t sent automatically' })).toBeVisible();
  } finally {
    await leave(request);
  }
});

test('a dive already at the Provider is decided under Needs your decision', { tag: ['@account'] }, async ({ page, request }) => {
  await connectSsi(request);
  const id = await deletableDive(request);
  try {
    await queueEntry(request, id, { state: 'held', reason: 'exists', detail: { remoteId: '555', remoteNumber: 12, startsAt: '2026-03-05 08:00' } });
    const n = await diveNumber(request, id);
    await page.goto('/#/review');
    await expect(page.getByText(/^SSI already has a dive at this time/)).toBeVisible();
    // The dive at SSI is named, and both ways out are buttons of this dive.
    await expect(page.getByText(/It is dive 12 in SSI/)).toBeVisible();
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/dives/${id}/providers/ssi/decision`));
    await page.getByRole('button', { name: `Link to it: Dive ${n}` }).click();
    expect((await sent).postDataJSON()).toEqual({ onExisting: 'link' });
    // Queued: the choice is told and can't be made twice.
    await expect(page.locator('#main').getByText(`Dive ${n} will be linked with the dive in SSI.`)).toBeVisible();
    await expect(page.getByRole('button', { name: `Link to it: Dive ${n}` })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Create a new one: Dive ${n}` })).toHaveCount(0);
  } finally {
    await leave(request);
  }
});

test('opening Dive Hub asks for a fetch once', { tag: ['@account'] }, async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/connections/fetch-due')) asked.push(r.url()); });
  await page.goto('/#/');
  await expect.poll(() => asked.length).toBe(1);
  // Moving around the app doesn't ask again.
  await page.goto('/#/review');
  await page.goto('/#/account?tab=connections');
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: 'Logbook' }).first()).toBeVisible();
  expect(asked).toHaveLength(1);
});

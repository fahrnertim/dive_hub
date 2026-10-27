// Sending by itself (ADR 0056) as the User sees it: a Dive that waits to go to SSI, is held for something the User has
// to do, or stopped (Retry), in the logbook and on the Dive's page; and the delete that SSI's Connection does by itself.
// The e2e server's worker settles real entries within a minute, so the states that must stay are put into the queue
// by test-only routes (apps/server/test/e2e-server.ts); the saves and the delete are real.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clearQueue, connectSsi, deletableDive, diveNumber, diveRows, editElsewhere, headers, leaveConflict, leaveSsi, openLine, queueEntry, sendToSsi, setPreferences, ssiConnectionOf } from './support.ts';

test.describe.configure({ mode: 'serial' });

type Status = { connection: { id: string } | null; waiting: { state: string; reason: string | null; action: string } | null; deletesItself: boolean };
const status = async (api: APIRequestContext, id: string) => await (await api.get(`/api/dives/${id}/providers/ssi`)).json() as Status;
const settings = (api: APIRequestContext, connectionId: string, data: Record<string, boolean>) =>
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
  await settings(request, await ssiConnectionOf(request, id), { sendChanges: false, sendNewDives: false, deleteAtProvider: false });
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
    // The Dive has no site, so the worker holds it for that: the stopped state is gone.
    await expect(line.getByText(/^Couldn’t send to SSI/)).toBeHidden();
    await expect(line.getByText('Needs a site with a position before it can go to SSI')).toBeVisible({ timeout: 20_000 });
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
    await expect(rowOf(page, n).getByText('Needs a site with a position before it can go to SSI')).toBeVisible();
    await page.goto(`/#/dives/${id}`);
    // A held Dive opens its line by itself.
    await expect(page.getByRole('group', { name: 'SSI' }).getByText('Needs a site with a position before it can go to SSI')).toBeVisible();
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

    await page.goto('/#/review?tab=deleted');
    const panel = deletedPanel(page);
    await expect(panel.getByText('Will be deleted in SSI in 5 min')).toBeVisible();
    // Restoring cancels it.
    await panel.getByRole('button', { name: /^Restore: Mar 5, 2026/ }).click();
    await expect(panel).toHaveCount(0);
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

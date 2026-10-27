// Conflicts with SSI (ADR 0056) in a real browser, against the e2e server's fake SSI: an update is three-way. A note
// changed only in SSI's app comes back, notes changed in both places are asked on the dive's page (nothing is sent
// until the User chooses), and a run leaves such a dive waiting on the Review page, where the same choice sends it.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  clearPushRuns, conflictAtSsi, diveNumber, editAtSsi, headers, leaveConflict, openLine, sentWithNotes,
} from './support.ts';

test.describe.configure({ mode: 'serial' });

type Status = { connection: { id: string } | null; pushes: unknown[]; conflicts: unknown[] | null };
const status = async (api: APIRequestContext, id: string) => await (await api.get(`/api/dives/${id}/providers/ssi`)).json() as Status;
const notesOf = async (api: APIRequestContext, id: string) => ((await (await api.get(`/api/dives/${id}`)).json()) as { notes: string | null }).notes;

test('on the dive\'s page, notes changed in both places are asked, nothing is sent until chosen, and the choice is sent', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await conflictAtSsi(request);
  try {
    const pushes = (await status(request, id)).pushes.length;
    await page.goto(`/#/dives/${id}`);
    await openLine(page, 'SSI');
    await page.getByRole('button', { name: 'Update in SSI' }).click();

    const choice = page.getByRole('region', { name: 'Changed in both places' });
    await expect(choice.getByText('SSI has a different value for these since the last exchange. Choose which to keep; nothing was sent yet.')).toBeVisible();
    const notes = choice.getByRole('radiogroup', { name: 'Notes' });
    // Both values, Dive Hub's kept unless the User takes SSI's (as in the import preview).
    await expect(notes.getByRole('radio', { name: /^Keep Dive Hub’s/ })).toBeChecked();
    await expect(notes.getByText('Reef here')).toBeVisible();
    await expect(notes.getByText('Reef in SSI')).toBeVisible();
    // The choice takes the send button's place, and nothing went to SSI.
    await expect(page.getByRole('button', { name: 'Update in SSI' })).toBeHidden();
    expect((await status(request, id)).pushes).toHaveLength(pushes);

    // Cancelled, the send button is back; asked again, SSI's notes are taken.
    await choice.getByRole('button', { name: 'Cancel' }).click();
    await expect(choice).toBeHidden();
    await page.getByRole('button', { name: 'Update in SSI' }).click();
    await notes.getByText('Take SSI’s', { exact: true }).click();
    await choice.getByRole('button', { name: 'Send with these choices' }).click();
    await expect(page.locator('#main').getByText('Taken from SSI: notes.')).toBeVisible();
    await expect(page.locator('#main').getByText('Up to date')).toBeVisible();
    await expect(choice).toBeHidden();
    expect(await notesOf(request, id)).toBe('Reef in SSI');
    expect((await status(request, id)).pushes).toHaveLength(pushes + 1);
  } finally {
    await leaveConflict(request);
  }
});

test('a note changed only in SSI comes back on update and the page says so', { tag: ['@dives'] }, async ({ page, request }) => {
  const id = await sentWithNotes(request, 'Reef');
  try {
    await editAtSsi(request, id, { odin_user_log_comment: 'Reef, a turtle' });
    // Changed here too, in another field, so there is something to update.
    const dive = await (await request.get(`/api/dives/${id}`)).json() as { version: number };
    await request.patch(`/api/dives/${id}`, { data: { version: dive.version, lead: [{ amountKg: 8, placement: 'belt' }] }, headers });

    await page.goto(`/#/dives/${id}`);
    await openLine(page, 'SSI');
    // An update sends a removal too, and the line says so where the User updates.
    await expect(page.getByText('A value removed here is removed in SSI too (not the dive site).')).toBeVisible();
    await page.getByRole('button', { name: 'Update in SSI' }).click();
    await expect(page.locator('#main').getByText('Taken from SSI: notes.')).toBeVisible();
    // The notice can be closed.
    await page.getByRole('group', { name: 'SSI' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('#main').getByText('Taken from SSI: notes.')).toBeHidden();
    await expect(page.locator('#main').getByText('Up to date')).toBeVisible();
    // The Dive shows the note from SSI without a reload.
    await expect(page.locator('#main').getByText('Reef, a turtle')).toBeVisible();
    expect(await notesOf(request, id)).toBe('Reef, a turtle');
  } finally {
    await leaveConflict(request);
  }
});

test('a run\'s conflict waits under Needs your decision; Take SSI\'s sends and the entry is gone; the strip counts it', { tag: ['@dives'] }, async ({ page, request }) => {
  test.setTimeout(240_000);
  const id = await conflictAtSsi(request);
  const n = await diveNumber(request, id);
  try {
    const connectionId = (await status(request, id)).connection!.id;
    const started = await request.post(`/api/connections/${connectionId}/push-runs`, { data: { dives: { ids: [id] }, updates: true }, headers });
    expect(started.status(), await started.text()).toBe(202);
    const run = await started.json() as { id: string };
    await expect.poll(async () => ((await (await request.get(`/api/push-runs/${run.id}`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('done');

    // On the dive's page the run's entry is asked as well: part of the dive was sent already, so there is nothing to cancel.
    await page.goto(`/#/dives/${id}`);
    await openLine(page, 'SSI');
    const waiting = page.getByRole('region', { name: 'Changed in both places' });
    await expect(waiting.getByText('A run sent this dive to SSI without these values: they were changed in both places. Choose which to keep.')).toBeVisible();
    await expect(waiting.getByRole('radiogroup', { name: 'Notes' })).toBeVisible();
    await expect(waiting.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Update in SSI' })).toBeHidden();

    // The run's report says how many wait, and the logbook's strip counts them with what else waits.
    await page.goto('/#/');
    await expect(page.getByText('1 dive has values changed in both places: it waits in Needs your decision.')).toBeVisible();
    await expect(page.getByText(/1 dive with values changed in both places/)).toBeVisible();

    await page.goto('/#/review');
    const heading = page.getByRole('heading', { name: 'Changed in both places (1)', level: 2 });
    await expect(heading).toBeVisible();
    await expect(page.getByRole('link', { name: `Dive ${n}` })).toBeVisible();
    const notes = page.getByRole('radiogroup', { name: 'Notes' });
    await expect(notes.getByRole('radio', { name: /^Keep Dive Hub’s/ })).toBeChecked();
    await notes.getByText('Take SSI’s', { exact: true }).click();
    await page.getByRole('button', { name: `Send with these choices: Dive ${n}` }).click();

    // The choice is queued, not sent: the dive says so and can't be chosen for twice while it waits.
    await expect(page.locator('#main').getByText(`Dive ${n} will be sent to SSI with your choices.`)).toBeVisible();
    await expect(page.getByRole('button', { name: `Send with these choices: Dive ${n}` })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Notes' })).toHaveCount(0);
    // The server says it is queued: a reload still shows the wait, not the choices.
    await page.reload();
    await expect(page.getByText('Waiting to send to SSI')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Notes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Send with these choices: Dive ${n}` })).toHaveCount(0);
    // The worker sends it within a minute; the entry then leaves the page by itself, and SSI's notes are taken.
    await expect.poll(async () => (await status(request, id)).conflicts, { timeout: 120_000 }).toBeNull();
    expect(await notesOf(request, id)).toBe('Reef in SSI');
    await expect(heading).toBeHidden({ timeout: 30_000 });
  } finally {
    await clearPushRuns(request);
    await leaveConflict(request);
  }
});

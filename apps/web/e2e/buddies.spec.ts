// Buddies (ADR 0028, 0029) in a real browser, against the e2e server's fake SSI with Erika's buddy list (Kai Lund,
// Mia Stone): adding Kai from the list on the account page, putting him and a new diver on a dive, finding the new
// one in the SSI buddy list from the dive's SSI panel, and sending the dive with both as buddies.
import { expect, test } from '@playwright/test';
import { clearParticipants, connectSsi, forgetDivers, importSsiBuddies, leaveSsi, openLine, readyForSsi, resetDive } from './support.ts';

test('adds a buddy from the SSI buddy list on the account page', { tag: ['@account', '@divers'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  await clearParticipants(request, dive.id);
  await forgetDivers(request, 'Kai Lund');
  await connectSsi(request);
  await page.goto('/#/account');
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await panel.getByRole('button', { name: /^Show your SSI buddy list/ }).click();
  const list = panel.locator('section', { has: page.getByRole('heading', { name: 'Your SSI buddy list' }) });
  await expect(list.getByText('Dive Hub keeps only each person’s name and SSI account')).toBeVisible();
  const kai = list.getByRole('row', { name: /Kai Lund/ });
  await expect(kai.getByRole('cell', { name: 'Not yet' })).toBeVisible();
  // Nothing SSI keeps about them besides the name is shown.
  await expect(list.getByText('kai@example.com')).toHaveCount(0);

  await kai.getByRole('button', { name: 'Add to Dive Hub: Kai Lund' }).click();
  await expect(kai.getByRole('cell', { name: 'Kai Lund' }).nth(1)).toBeVisible();
  await expect(kai.getByRole('button', { name: /Add to Dive Hub/ })).toHaveCount(0);

  await page.goto('/#/divers');
  const others = page.locator('section', { has: page.getByRole('heading', { name: 'Other divers' }) });
  await expect(others.getByRole('listitem').filter({ hasText: 'Kai Lund' })).toContainText('SSI account known');
});

test('puts buddies on a dive, finds one in the SSI buddy list, and sends both to SSI', { tag: ['@dives'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  await clearParticipants(request, dive.id);
  await forgetDivers(request, 'Mia');
  await connectSsi(request);
  await readyForSsi(request, dive.id);
  // Kai is in Dive Hub with his SSI account (as the account page adds him).
  await importSsiBuddies(request, ['4989164']);

  await page.goto(`/#/dives/${dive.id}`);
  // Who dived along is one of the dive's facts: with nobody yet, it is the way to add someone.
  const people = page.getByRole('group', { name: 'Buddies and guides' });
  await expect(people.getByRole('listitem')).toHaveCount(0);

  await people.getByRole('button', { name: 'Add someone' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: 'Buddy' })).toBeChecked();
  await dialog.getByRole('searchbox', { name: 'Find a diver' }).fill('kai');
  await dialog.getByRole('option', { name: /Kai Lund/ }).click();
  await expect(dialog).toBeHidden();
  await expect(people.getByRole('listitem')).toHaveText(['Kai Lund (Buddy)']);

  await people.getByRole('button', { name: 'Add someone' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByText('Guide', { exact: true }).click();
  await dialog.getByRole('searchbox', { name: 'Find a diver' }).fill('Mia');
  await dialog.getByRole('option', { name: /Add “Mia” as a new diver/ }).click();
  await expect(dialog).toBeHidden();
  await expect(people.getByRole('listitem')).toHaveText(['Kai Lund (Buddy)', 'Mia (Guide)']);

  // Roles change, and people leave, in a dialog from the fact. Edits within ten minutes are one history entry with
  // the net change (lib/history.ts).
  const change = people.getByRole('button', { name: 'Change: Buddies and guides' });
  await change.click();
  dialog = page.getByRole('dialog', { name: 'Buddies and guides' });
  await dialog.getByRole('button', { name: /Role of Kai Lund/ }).click();
  await page.getByRole('option', { name: 'Instructor' }).click();
  await expect(dialog.getByRole('button', { name: /Role of Kai Lund/ })).toContainText('Instructor');
  await dialog.getByRole('button', { name: 'Done' }).click();
  // In the order the server lists them: by role.
  await expect(people.getByRole('listitem')).toHaveText(['Mia (Guide)', 'Kai Lund (Instructor)']);
  await expect(change).toBeFocused();
  await openLine(page, 'History');
  await expect(page.getByText('Kai Lund added as Instructor')).toBeVisible();

  // SSI doesn't know who Mia is yet: the panel says so and finds her in the SSI buddy list.
  const ssi = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await openLine(page, 'SSI');
  await expect(ssi.getByText('SSI gets this dive without Mia')).toBeVisible();
  await ssi.getByRole('button', { name: 'Find Mia in your SSI buddy list' }).click();
  dialog = page.getByRole('dialog');
  // Kai is somebody here already, so only Mia Stone can be picked.
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await dialog.getByRole('option', { name: 'Mia Stone' }).click();
  await expect(dialog).toBeHidden();
  await expect(ssi.getByText('SSI gets this dive without Mia')).toHaveCount(0);

  await ssi.getByRole('button', { name: 'Choose the SSI site' }).click();
  await page.getByRole('dialog').getByRole('option', { name: /Attersee – Schwarzenbach/ }).click();
  await ssi.getByRole('button', { name: 'Send to SSI' }).click();
  await expect(ssi.getByText(/In SSI as dive \d+, sent/)).toBeVisible();
  await expect(ssi.getByText('Up to date')).toBeVisible();
  await expect(ssi.getByText(/Sent without/)).toHaveCount(0);

  // Taking Mia off changes what SSI would get.
  await change.click();
  await dialog.getByRole('button', { name: 'Remove: Mia' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(people.getByRole('listitem')).toHaveText(['Kai Lund (Instructor)']);
  await expect(ssi.getByText('Changed since sent')).toBeVisible();

});

// Other specs expect the seeded Dive with nobody on it, at no site and not in SSI; this runs even when a test failed.
test.afterEach(async ({ request }) => {
  const dive = await resetDive(request);
  await clearParticipants(request, dive.id);
  await connectSsi(request);
  await readyForSsi(request, dive.id);
  await leaveSsi(request, dive.id);
});

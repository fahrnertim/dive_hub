// Buddies (ADR 0028, 0029) in a real browser, against the e2e server's fake SSI with Erika's buddy list (Kai Lund,
// Mia Stone): adding Kai from the list on the account page, putting him and a new diver on a dive, finding the new
// one in the SSI buddy list from the dive's SSI panel, and sending the dive with both as buddies.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { picture } from './qr-picture.ts';
import {
  clearParticipants, clearPushRuns, connectSsi, externalDiver, forgetDivers, importSsiBuddies, leaveSsi, openLine, pushRunSetup, readyForSsi,
  resetDive, resetSsiBuddies, setBuddies,
} from './support.ts';

// The diver made here is taken off the dive and deleted again: another spec on the same server adds a Diver of the
// same name, and two of them make buttons with the same name on the Divers page.
test.afterAll(async ({ request }) => {
  const dive = await resetDive(request);
  await clearParticipants(request, dive.id);
  await forgetDivers(request, 'Mia');
  await resetSsiBuddies(request);
});

test('adds a buddy from the SSI buddy list on the account page', { tag: ['@account', '@divers'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  await clearParticipants(request, dive.id);
  await forgetDivers(request, 'Kai Lund');
  await connectSsi(request);
  await page.goto('/#/account?tab=connections');
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await panel.getByRole('button', { name: /^Show your SSI buddy list/ }).click();
  const list = panel.locator('section', { has: page.getByRole('heading', { name: 'Your SSI buddy list' }) });
  await expect(list.getByText('Dive Hub keeps each person’s name and SSI account and what their code there says')).toBeVisible();
  const kai = list.getByRole('row', { name: /Kai Lund/ });
  await expect(kai.getByRole('cell', { name: 'Not yet' })).toBeVisible();
  // The list shows only the name; what the code says is kept with the Diver (ADR 0043).
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
  await resetSsiBuddies(request);
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
  await expect(people.locator('li > :not(.avatar)')).toHaveText(['Kai Lund (Buddy)']);

  await people.getByRole('button', { name: 'Add someone' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByText('Guide', { exact: true }).click();
  await dialog.getByRole('searchbox', { name: 'Find a diver' }).fill('Mia');
  await dialog.getByRole('option', { name: /Add “Mia” as a new diver/ }).click();
  await expect(dialog).toBeHidden();
  await expect(people.locator('li > :not(.avatar)')).toHaveText(['Kai Lund (Buddy)', 'Mia (Guide)']);

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
  await expect(people.locator('li > :not(.avatar)')).toHaveText(['Mia (Guide)', 'Kai Lund (Instructor)']);
  await expect(change).toBeFocused();
  await openLine(page, 'History');
  await expect(page.getByText('Kai Lund added as Instructor')).toBeVisible();

  // SSI doesn't know who Mia is yet: the panel says so and finds her in the SSI buddy list.
  const ssi = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await openLine(page, 'SSI');
  await expect(ssi.getByText('SSI gets this dive without Mia')).toBeVisible();
  await ssi.getByRole('button', { name: 'Link or add Mia' }).click();
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
  await expect(people.locator('li > :not(.avatar)')).toHaveText(['Kai Lund (Instructor)']);
  await expect(ssi.getByText('Changed since sent')).toBeVisible();

});

/** The Dive with this person on it, who is in no SSI list and has no SSI account: the SSI line open on it. */
async function diveWith(page: Page, request: APIRequestContext, name: string) {
  const dive = await resetDive(request);
  await clearParticipants(request, dive.id);
  await forgetDivers(request, name);
  // After resetSsiBuddies, which removed the Connection.
  await connectSsi(request);
  await readyForSsi(request, dive.id);
  await setBuddies(request, dive.id, [await externalDiver(request, name)]);
  await page.goto(`/#/dives/${dive.id}`);
  await openLine(page, 'SSI');
  return { dive, ssi: page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) }) };
}

test('links a Participant to an entry without an account and sends the dive with them', { tag: ['@dives'] }, async ({ page, request }) => {
  await resetSsiBuddies(request, { entries: [{ firstname: 'Nora', lastname: 'Berg' }] });
  const { dive, ssi } = await diveWith(page, request, 'Nora');
  await expect(ssi.getByText('SSI gets this dive without Nora')).toBeVisible();
  await ssi.getByRole('button', { name: 'Link or add Nora' }).click();
  const dialog = page.getByRole('dialog', { name: 'Who is Nora at SSI?' });
  // An entry SSI has no account for is as good as one with an account.
  await expect(dialog.getByRole('option', { name: /Nora Berg/ })).toBeVisible();
  await dialog.getByRole('option', { name: /Nora Berg/ }).click();
  await expect(dialog).toBeHidden();
  await expect(ssi.getByText('SSI gets this dive without Nora')).toHaveCount(0);

  await ssi.getByRole('button', { name: 'Send to SSI' }).click();
  await expect(ssi.getByText(/In SSI as dive \d+, sent/)).toBeVisible();
  await expect(ssi.getByText(/Sent without/)).toHaveCount(0);
  await clearParticipants(request, dive.id);
  await forgetDivers(request, 'Nora');
});

test('adds a typed person to the SSI list from the dive page and shows the add message', { tag: ['@dives'] }, async ({ page, request }) => {
  await resetSsiBuddies(request);
  const { dive, ssi } = await diveWith(page, request, 'Dive Hub test');
  await ssi.getByRole('button', { name: 'Link or add Dive Hub test' }).click();
  const dialog = page.getByRole('dialog', { name: 'Who is Dive Hub test at SSI?' });
  // Both names are needed; the e-mail is optional and says so.
  await expect(dialog.getByRole('textbox', { name: 'E-mail' })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'First name' }).fill('Dive Hub');
  await dialog.getByRole('button', { name: 'Add to your SSI list' }).click();
  await expect(dialog.getByText('Fill in this field.')).toBeVisible();
  // Leaving the field clears the error and the form shifts up; the click comes after that.
  await dialog.getByRole('textbox', { name: 'Last name' }).fill('test');
  await dialog.getByRole('textbox', { name: 'Last name' }).blur();
  await expect(dialog.getByText('Fill in this field.')).toBeHidden();
  await dialog.getByRole('button', { name: 'Add to your SSI list' }).click();
  await expect(dialog).toBeHidden();
  await expect(ssi.getByText('Added Dive Hub test to your SSI list. It might take some time until they show up in SSI’s app.')).toBeVisible();
  // A name typed gives no account, so nothing is said about whom SSI knows.
  await expect(ssi.getByText(/SSI knows this account as/)).toHaveCount(0);
  await expect(ssi.getByText('SSI gets this dive without Dive Hub test')).toHaveCount(0);
  await clearParticipants(request, dive.id);
  await forgetDivers(request, 'Dive Hub test');
});

test('shows whom SSI knows the account as', { tag: ['@dives'] }, async ({ page, request }) => {
  // The code says Nora Keller; SSI's profile for the account says Nora Berg.
  await resetSsiBuddies(request, { profiles: [{ account: 4_700_001, firstname: 'Nora', lastname: 'Berg' }] });
  const { dive, ssi } = await diveWith(page, request, 'Nora Keller');
  await ssi.getByRole('button', { name: 'Link or add Nora Keller' }).click();
  const dialog = page.getByRole('dialog', { name: 'Who is Nora Keller at SSI?' });
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Read from image' }).click();
  await (await chooser).setFiles(picture('buddy;4700001;firstName:Nora;lastName:Keller;email:nora@example.com'));
  // The code's parts fill the form; the person is added by their account.
  await expect(dialog.getByRole('textbox', { name: 'First name' })).toHaveValue('Nora');
  await expect(dialog.getByRole('textbox', { name: 'Last name' })).toHaveValue('Keller');
  await expect(dialog.getByRole('textbox', { name: 'E-mail' })).toHaveValue('nora@example.com');
  await dialog.getByRole('button', { name: 'Add to your SSI list' }).click();
  await expect(dialog).toBeHidden();
  await expect(ssi.getByText('Added Nora Berg to your SSI list.')).toBeVisible();
  await expect(ssi.getByText('SSI knows this account as Nora Berg')).toBeVisible();
  await expect(ssi.getByRole('link', { name: 'Nora Keller' })).toHaveAttribute('href', '#/divers');
  await clearParticipants(request, dive.id);
  await forgetDivers(request, 'Nora Keller');
  await resetSsiBuddies(request);
});

test('imports an entry without an account from the buddy list page', { tag: ['@account', '@divers'] }, async ({ page, request }) => {
  await resetSsiBuddies(request, { entries: [{ firstname: 'Nora', lastname: 'Berg' }] });
  await forgetDivers(request, 'Nora Berg');
  await connectSsi(request);
  await page.goto('/#/account?tab=connections');
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
  await panel.getByRole('button', { name: /^Show your SSI buddy list/ }).click();
  const list = panel.locator('section', { has: page.getByRole('heading', { name: 'Your SSI buddy list' }) });
  const nora = list.getByRole('row', { name: /Nora Berg/ });
  await expect(nora.getByRole('cell', { name: 'No SSI account yet' })).toBeVisible();
  await expect(nora.getByRole('button', { name: 'Is someone here: Nora Berg' })).toBeVisible();
  await nora.getByRole('button', { name: 'Add to Dive Hub: Nora Berg' }).click();
  await expect(nora.getByRole('cell', { name: 'Nora Berg' }).nth(1)).toBeVisible();
  await expect(nora.getByRole('button', { name: /Add to Dive Hub/ })).toHaveCount(0);

  await page.goto('/#/divers');
  const others = page.locator('section', { has: page.getByRole('heading', { name: 'Other divers' }) });
  await expect(others.getByRole('listitem').filter({ hasText: 'Nora Berg' })).toBeVisible();
  await forgetDivers(request, 'Nora Berg');
  await resetSsiBuddies(request);
});

test('the run report lists dives sent without someone', { tag: ['@dives'] }, async ({ page, request }) => {
  await resetSsiBuddies(request);
  const dive = await resetDive(request);
  await clearParticipants(request, dive.id);
  await forgetDivers(request, 'Nora');
  const { siteId } = await pushRunSetup(request, dive.id, { keepSignedIn: true, siteExternalId: '7099' });
  await setBuddies(request, dive.id, [await externalDiver(request, 'Nora')]);
  try {
    await page.goto(`/#/?site=${siteId}`);
    await page.getByRole('button', { name: 'Send to SSI…' }).click();
    await page.getByRole('dialog', { name: 'Send dives to SSI' }).getByRole('button', { name: 'Send 1 dive' }).click();
    const main = page.locator('#main');
    await expect(main.getByText(/Sent 1 of 1 dives to SSI\./)).toBeVisible();
    await expect(main.getByText('Sent without someone')).toBeVisible();
    const row = main.getByRole('list', { name: 'Sent without someone' }).getByRole('listitem');
    await expect(row).toContainText('Nora');
    await expect(row.getByRole('link')).toHaveAttribute('href', `#/dives/${dive.id}`);
  } finally {
    await clearPushRuns(request);
    await forgetDivers(request, 'Nora');
    await clearParticipants(request, dive.id);
  }
});

// Other specs expect the seeded Dive with nobody on it, at no site and not in SSI; this runs even when a test failed.
test.afterEach(async ({ request }) => {
  const dive = await resetDive(request);
  await clearParticipants(request, dive.id);
  await connectSsi(request);
  await readyForSsi(request, dive.id);
  await leaveSsi(request, dive.id);
});

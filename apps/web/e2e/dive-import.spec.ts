// Importing dives from SSI (ADR 0030) in a real browser, against the e2e server's fake SSI: Lena's logbook has dives
// typed by hand, one from a Mares, and entries between two of her dives here. What the import may do, the window, the
// preview with the computer and a decision, the outcome, and the dives it made or linked.
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, LENA_SSI, conflictForLena, externalDiver, leaveLena, lenaClaimable, lenaReady, uniqueWord } from './support.ts';

const headers = { origin: E2E_BASE_URL };

test('imports Lena\'s SSI dives from her Connection: the setting, the preview, a decision, the outcome', { tag: ['@account', '@dives'] }, async ({ page, request }) => {
  const { connectionId, diverId } = await lenaReady(request);
  // As for a new Connection: the import is off.
  await request.patch(`/api/connections/${connectionId}`, { data: { diveImport: { mode: 'off', windowMinutes: 15 } }, headers });
  try {
    await page.goto('/#/account');
    const section = page.getByRole('region', { name: 'Dives of Lena from SSI' });
    await expect(section.getByRole('radio', { name: /^Nothing/ })).toBeChecked();
    await expect(section.getByRole('button', { name: 'Show what the import would do' })).toHaveCount(0);

    await section.getByText('Also create dives', { exact: true }).click();
    await expect(section.getByRole('radio', { name: /^Also create dives/ })).toBeChecked();
    await section.getByRole('button', { name: /Same dive if the start is within/ }).click();
    await page.getByRole('option', { name: '30 minutes' }).click();
    await expect(section.getByRole('button', { name: /Same dive if the start is within/ })).toContainText('30 minutes');

    await section.getByRole('button', { name: 'Show what the import would do' }).click();
    await expect(section.getByRole('heading', { name: '5 dives in SSI' })).toBeVisible();
    const mares = section.getByRole('radiogroup', { name: 'Mares Puck 4 (4711), 1 dive' });
    await expect(mares.getByRole('radio', { name: /^As recordings/ })).toBeChecked();
    // The entry at 10:20 on 12 August lies between Lena's dives 501 (10:00) and 502 (10:40): she picks 501.
    const between = section.getByRole('radiogroup', { name: /^SSI dive 14: / });
    await expect(between.getByRole('radio', { name: /^Leave it out/ })).toBeChecked();
    await between.getByText(/^Dive 501 · /).click();
    await expect(between.getByRole('radio', { name: /^Dive 501 · / })).toBeChecked();

    await section.getByRole('button', { name: 'Import from SSI' }).click();
    await expect(section.getByRole('link', { name: 'Go to the logbook' })).toBeVisible({ timeout: 30_000 });
    await expect(section.getByText('done', { exact: true })).toBeVisible();
    await expect(section.getByText('linked to a dive here: 1')).toBeVisible();
    // The other entry between two dives stayed with "Leave it out".
    await expect(section.getByText('skipped (left out by you): 1')).toBeVisible();

    // Dive 501 is linked to SSI's dive 14: sending it updates that dive.
    const { dives } = await (await request.get(`/api/dives?diverId=${diverId}&q=501`)).json() as { dives: { id: string }[] };
    await page.goto(`/#/dives/${dives[0]!.id}`);
    await expect(page.getByText(/^In SSI as dive 14, /)).toBeVisible();

    // The first dive typed by hand became a dive without a recording; its time zone is Hausreef's.
    const all = await (await request.get(`/api/dives?diverId=${diverId}&sort=startsAt&order=asc`)).json() as { dives: { id: string }[] };
    await page.goto(`/#/dives/${all.dives[0]!.id}`);
    await expect(page.getByText('No recording yet: this dive comes from your SSI logbook, typed in by hand.')).toBeVisible();
    await expect(page.getByText('Time zone from where the dive was')).toBeVisible();
    await expect(page.getByText('Napoleon at the drop-off')).toBeVisible();
    // 10:00 at Hausreef in August is UTC+3 (the date's format follows the language another spec may have chosen).
    await expect(page.getByText(/2025, 10:00( AM)? \(UTC\+3\)/)).toBeVisible();
  } finally {
    await leaveLena(request);
  }
});

test('shows when each of Lena\'s SSI dives was made, whatever the import setting is, and changes nothing', { tag: ['@account'] }, async ({ page, request }) => {
  const { connectionId } = await lenaReady(request);
  await request.patch(`/api/connections/${connectionId}`, { data: { diveImport: { mode: 'off', windowMinutes: 15 } }, headers });
  try {
    await page.goto('/#/account');
    const section = page.getByRole('region', { name: 'Dives of Lena from SSI' });
    await section.getByRole('button', { name: 'Show when each dive was made' }).click();
    const table = section.getByRole('region', { name: 'Dives in SSI with start and origin' });
    await expect(table.getByRole('columnheader', { name: 'Start (local time)' })).toBeVisible();
    // Lena's computer dive and her hand-typed ones, oldest first; the import is still off.
    await expect(table.getByRole('row', { name: /dive computer/ })).toHaveCount(1);
    await expect(table.getByRole('row', { name: /typed by hand/ }).first()).toBeVisible();
    await expect(section.getByRole('radio', { name: /^Nothing/ })).toBeChecked();
    await section.getByRole('button', { name: 'Close' }).click();
    await expect(section.getByRole('button', { name: 'Show when each dive was made' })).toBeVisible();
  } finally {
    await leaveLena(request);
  }
});

test('an admin allows making dive sites from SSI logbooks, after confirming, and stops it again', { tag: ['@admin'] }, async ({ page, request }) => {
  await request.put('/api/admin/provider-site-data/ssi', { data: { allowed: false }, headers });
  await page.goto('/#/admin');
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Dive sites from SSI logbooks' }) });
  await expect(panel.getByText('SSI gives no licence for its dive site data.')).toBeVisible();
  const allow = panel.getByRole('button', { name: 'Allow', exact: true });
  await expect(allow).toBeDisabled();
  await panel.getByText(/^I understand and allow making dive sites/).click();
  await allow.click();
  await expect(panel.getByText('Allowed', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Allowed by Erika, /)).toBeVisible();
  await panel.getByRole('button', { name: 'Stop making sites' }).click();
  await expect(panel.getByRole('button', { name: 'Allow', exact: true })).toBeDisabled();
});

test('takes back a change made in SSI\'s app when asked, where the dive was changed here too', { tag: ['@account', '@dives'] }, async ({ page, request }) => {
  try {
    const stamp = uniqueWord();
    const diveId = await conflictForLena(request, stamp);
    await page.goto('/#/account');
    const section = page.getByRole('region', { name: 'Dives of Lena from SSI' });
    await section.getByRole('button', { name: 'Show what the import would do' }).click();
    const conflict = section.getByRole('radiogroup', { name: /: notes$/ });
    await expect(conflict.getByRole('radio', { name: `Keep Dive Hub’s: Changed in Dive Hub ${stamp}` })).toBeChecked();
    await conflict.getByText(`Take SSI’s: Changed in SSI ${stamp}`).click();
    await section.getByRole('button', { name: 'Import from SSI' }).click();
    await expect(section.getByRole('link', { name: 'Go to the logbook' })).toBeVisible({ timeout: 30_000 });
    await expect(section.getByText(/^updated: 1$/)).toBeVisible();
    await page.goto(`/#/dives/${diveId}`);
    await expect(page.getByText(`Changed in SSI ${stamp}`)).toBeVisible();
    await expect(page.locator('.history > li').first()).toContainText('Updated from its source');
  } finally {
    await leaveLena(request);
  }
});

test('a buddy imported earlier is claimed by connecting their own SSI account, after a question', { tag: ['@account'] }, async ({ page, request }) => {
  await lenaClaimable(request);
  try {
    await page.goto('/#/account');
    const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
    await panel.getByRole('button', { name: /Diver$/ }).click();
    await page.getByRole('option', { name: 'Lena', exact: true }).click();
    await panel.getByRole('textbox', { name: 'SSI e-mail' }).fill(LENA_SSI.login);
    await panel.getByRole('textbox', { name: 'SSI password' }).fill(LENA_SSI.password);
    await panel.getByRole('button', { name: 'Connect to SSI' }).click();
    await expect(panel.getByText(/^This SSI account is Lena Berger \d+ here, a buddy on 0 dives\. Is that you\?$/)).toBeVisible();
    await panel.getByRole('button', { name: /^Yes, I am Lena Berger/ }).click();
    await expect(panel.getByRole('cell', { name: LENA_SSI.login, exact: true })).toBeVisible();
    await page.goto('/#/divers');
    await expect(page.getByText(/^Lena Berger/)).toHaveCount(0);
  } finally {
    await leaveLena(request);
  }
});

test('an admin merges an external diver into another one', { tag: ['@divers'] }, async ({ page, request }) => {
  const name = `Merge me ${Date.now()}`;
  await externalDiver(request, name);
  await page.goto('/#/divers');
  await page.getByRole('button', { name: `Merge into…: ${name}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill('Lena');
  await dialog.getByRole('option', { name: /^Lena/ }).first().click();
  await expect(dialog).toBeHidden();
  // Gone from Other divers (the announcement still names it).
  await expect(page.getByRole('button', { name: `Merge into…: ${name}` })).toHaveCount(0);
});

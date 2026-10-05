// Importing dives from SSI (ADR 0030) in a real browser, against the e2e server's fake SSI: Lena's logbook has dives
// typed by hand, one from a Mares, and entries between two of her dives here. What the import may do, the window, the
// preview with the computer and a decision, the outcome, and the dives it made or linked.
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, leaveLena, lenaReady } from './support.ts';

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

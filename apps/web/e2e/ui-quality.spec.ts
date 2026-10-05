// Every page against the UI review's rules (docs/research/2026-10-03-ui-review.md), in English on a
// light desktop and in German on a dark phone, plus the narrowest phone (320 px, WCAG 1.4.10 reflow)
// and a German tablet in between (responsiveness, 2026-10-04): see expectGoodPage. Plus the behaviour the review
// asked for: focus after navigation, a quick "not found", field names with units, admin safeguards.
// Its tests run spread over all workers (ADR 0023); e2e/prepare.ts crowds each server first.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { dataFile, type PreparedData } from './prepare.ts';
import {
  E2E_BASE_URL, E2E_SERVERS, E2E_SESSION, clearParticipants, connectSsi, deletableDive, diveWithoutRecording, expectGoodPage, externalDiver,
  forgetDivers, leaveLena, leaveSsi, lenaReady, readyForSsi, resetDive, sendToSsi, setBuddies, setPreferences,
} from './support.ts';

// Spread over all workers (ADR 0023): every test stands alone; beforeAll prepares each worker's server.
test.describe.configure({ mode: 'parallel' });

const headers = { origin: E2E_BASE_URL };
let diveId: string;
let invitationToken: string;
let resetToken: string;
let siteId: string;
let importedSiteId: string;
let offerSiteId: string;

// Prepared once per server before any test (e2e/prepare.ts): a crowd, links to pass on, an imported site.
// Read here, not when the file loads: Playwright may load spec files before the global setup wrote it.
// Other specs on this server may have changed the language; these tests let the browser decide.
test.beforeAll(async ({ playwright }) => {
  ({ diveId, invitationToken, resetToken, siteId, importedSiteId, offerSiteId } =
    JSON.parse(readFileSync(dataFile(Number(process.env.TEST_PARALLEL_INDEX ?? 0) % E2E_SERVERS), 'utf8')) as PreparedData);
  const api = await playwright.request.newContext({ baseURL: E2E_BASE_URL, storageState: E2E_SESSION, extraHTTPHeaders: headers });
  await setPreferences(api, { language: null, units: null });
  await api.dispose();
});

const variants = [
  // axe in both colour schemes and both languages; the other two widths check layout, titles and names only
  // (axe's rules don't change with the width, and it is the slowest check, ADR 0023).
  { name: 'English, light, desktop', locale: 'en-GB', colorScheme: 'light' as const, viewport: { width: 1280, height: 900 }, english: true, axe: true },
  { name: 'German, dark, phone', locale: 'de-DE', colorScheme: 'dark' as const, viewport: { width: 390, height: 844 }, english: false, axe: true },
  { name: 'English, light, small phone', locale: 'en-GB', colorScheme: 'light' as const, viewport: { width: 320, height: 640 }, english: true, axe: false },
  { name: 'German, light, tablet', locale: 'de-DE', colorScheme: 'light' as const, viewport: { width: 768, height: 1024 }, english: false, axe: false },
];

for (const v of variants) {
  test.describe(v.name, () => {
    test.use({ locale: v.locale, colorScheme: v.colorScheme, viewport: v.viewport });
    const title = (english: string) => (v.english ? english : undefined);

    test('logbook', { tag: ['@dives'] }, async ({ page, request }) => {
      await resetDive(request);
      await page.goto('/');
      await expect(page.getByRole('table')).toBeVisible();
      await expectGoodPage(page, title('Logbook'), v);
    });

    test('dive, reading and editing', { tag: ['@dives'] }, async ({ page }) => {
      await page.goto(`/#/dives/${diveId}`);
      await expect(page.locator('canvas').first()).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
      await page.getByRole('button', { name: v.english ? 'Edit dive' : 'Tauchgang bearbeiten' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Save' : 'Speichern' })).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
    });

    test('unknown dive', { tag: ['@dives'] }, async ({ page }) => {
      await page.goto('/#/dives/00000000-0000-7000-8000-000000000000');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectGoodPage(page, title('Dive not found'), v);
    });

    test('Dive sites', { tag: ['@sites'] }, async ({ page }) => {
      await page.goto('/#/sites');
      await expect(page.getByRole('table')).toBeVisible();
      await expectGoodPage(page, title('Dive sites'), v);
      await page.getByRole('button', { name: v.english ? 'New dive site' : 'Neuer Tauchplatz' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Create dive site' : 'Tauchplatz anlegen' })).toBeVisible();
      await expectGoodPage(page, title('Dive sites'), v);
    });

    test('a dive site, reading and editing', { tag: ['@sites'] }, async ({ page }) => {
      await page.goto(`/#/sites/${siteId}`);
      await expect(page.getByRole('link', { name: v.english ? 'Open in maps' : 'In Karte öffnen' })).toBeVisible();
      await expectGoodPage(page, undefined, v);
      await page.getByRole('button', { name: v.english ? 'Edit dive site' : 'Tauchplatz bearbeiten' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Save dive site' : 'Tauchplatz speichern' })).toBeVisible();
      await expectGoodPage(page, undefined, v);
    });

    test('merging a dive site close by', { tag: ['@sites'] }, async ({ page }) => {
      await page.goto(`/#/sites/${siteId}`);
      await page.getByRole('button', { name: v.english ? /^Merge into this site:/ : /^Mit diesem Platz zusammenführen:/ }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectGoodPage(page, undefined, v);
    });

    test('an imported dive site, with its source and history', { tag: ['@sites'] }, async ({ page }) => {
      await page.goto(`/#/sites/${importedSiteId}`);
      await expect(page.getByRole('link', { name: 'way/644356549' })).toBeVisible();
      await expect(page.locator('.history > li').first()).toBeVisible();
      await expectGoodPage(page, title('Elphinstone Reef'), v);
    });

    test('importing dive sites, by country and by area', { tag: ['@admin', '@sites'] }, async ({ page }) => {
      await page.goto('/#/admin/site-imports');
      await expect(page.locator('.site-imports > li').first()).toBeVisible();
      await expectGoodPage(page, title('Import dive sites'), v);
      await page.getByText(v.english ? 'An area by coordinates' : 'Ein Gebiet nach Koordinaten').click();
      await expect(page.getByRole('textbox', { name: v.english ? 'South edge' : 'Südrand' })).toBeVisible();
      await page.getByRole('button', { name: v.english ? 'Start import' : 'Import starten' }).click();
      await expect(page.getByText(v.english ? 'Enter all four edges' : 'Gib alle vier Ränder an', { exact: false })).toBeVisible();
      await expectGoodPage(page, title('Import dive sites'), v);
    });

    test('importing dive sites from SSI, with its explanation and only filling', { tag: ['@admin', '@sites'] }, async ({ page }) => {
      await page.goto('/#/admin/site-imports');
      await page.getByText(v.english ? 'SSI (no licence, see below)' : 'SSI (ohne Lizenz, siehe unten)').click();
      await page.getByText(v.english ? 'Only fill dive sites that are already here' : 'Nur Tauchplätze ergänzen, die schon hier sind').click();
      await expect(page.getByText(v.english ? 'SSI gives no licence for its list of dive sites.' : 'SSI gibt für seine Liste der Tauchplätze keine Lizenz.')).toBeVisible();
      // The prepared import filled a site made here: the list names it.
      await expect(page.locator('.site-imports').getByRole('link', { name: 'Ouchy – Seeufer (club notes)' })).toBeVisible();
      await expectGoodPage(page, title('Import dive sites'), v);
    });

    test('a dive site offering a source\'s data', { tag: ['@sites'] }, async ({ page }) => {
      await page.goto(`/#/sites/${offerSiteId}`);
      await page.getByRole('button', { name: v.english ? 'Use SSI’s data' : 'Daten von SSI übernehmen' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectGoodPage(page, undefined, v);
    });

    test('a dive whose computer was set to other water than its site', { tag: ['@dives', '@sites'] }, async ({ page, request }) => {
      const name = 'Gosausee (fresh water)';
      const { sites } = await (await request.get(`/api/dive-sites?q=${encodeURIComponent(name)}`, { headers })).json() as { sites: { id: string; name: string }[] };
      const lake = sites.find((s) => s.name === name)
        ?? await (await request.post('/api/dive-sites', { headers, data: { name, waterType: 'fresh' } })).json() as { id: string };
      const dive = await (await request.get(`/api/dives/${diveId}`, { headers })).json() as { version: number };
      await request.patch(`/api/dives/${diveId}`, { headers, data: { version: dive.version, siteId: lake.id } });
      try {
        await page.goto(`/#/dives/${diveId}`);
        await expect(page.getByText(v.english ? /this site is fresh water/ : /dieser Platz ist Süßwasser/)).toBeVisible();
        await expectGoodPage(page, title('Dive 42'), v);
      } finally {
        await leaveSsi(request, diveId);
      }
    });

    test('unknown dive site', { tag: ['@dives'] }, async ({ page }) => {
      await page.goto('/#/sites/00000000-0000-7000-8000-000000000000');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectGoodPage(page, title('Dive site not found'), v);
    });

    test('choosing a dive site on a dive', { tag: ['@sites', '@dives'] }, async ({ page }) => {
      await page.goto(`/#/dives/${diveId}`);
      await page.getByRole('button', { name: v.english ? 'Choose dive site' : 'Tauchplatz wählen' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
      // Results while typing, and the way on when nothing matches.
      // Checked once the results for what was typed are in (the status names the query).
      await page.getByRole('dialog').getByRole('searchbox').fill('Ras Mohammed');
      await expect(page.getByRole('dialog').getByRole('status')).toContainText('Ras Mohammed');
      await expectGoodPage(page, title('Dive 42'), v);
      await page.getByRole('dialog').getByRole('searchbox').fill('Nowhere at all');
      await expect(page.getByRole('dialog').getByRole('option', { name: v.english ? /Create/ : /anlegen/ })).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('status')).toContainText('Nowhere at all');
      // React Aria points the field at the new active result one render after the list changes; wait for it.
      await expect.poll(() => page.getByRole('dialog').getByRole('searchbox').evaluate((el) => {
        const active = el.getAttribute('aria-activedescendant');
        return !active || !!document.getElementById(active);
      })).toBe(true);
      await expectGoodPage(page, title('Dive 42'), v);
      await page.getByRole('button', { name: v.english ? 'New dive site' : 'Neuer Tauchplatz' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Create and choose' : 'Anlegen und auswählen' })).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
    });

    test('Divers and Devices', { tag: ['@divers'] }, async ({ page, request }) => {
      // Someone without a logbook here (ADR 0028), listed under "Other divers".
      await externalDiver(request, 'Ulla Berg');
      await page.goto('/#/divers');
      await expect(page.getByText('Ulla Berg')).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();
      await expectGoodPage(page, title('Divers'), v);
    });

    test('my account', { tag: ['@account'] }, async ({ page }) => {
      await page.goto('/#/account');
      await expect(page.getByRole('table').first()).toBeVisible();
      await expectGoodPage(page, title('My account'), v);
    });

    test('my account, connected to SSI, signing in again', { tag: ['@account'] }, async ({ page, request }) => {
      await connectSsi(request);
      await page.goto('/#/account');
      await page.getByRole('button', { name: v.english ? /^Sign in again: / : /^Neu anmelden: / }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectGoodPage(page, title('My account'), v);
    });

    test('a dive at SSI, choosing the SSI site', { tag: ['@dives'] }, async ({ page, request }) => {
      await connectSsi(request);
      await readyForSsi(request, diveId);
      await page.goto(`/#/dives/${diveId}`);
      const choose = page.getByRole('button', { name: v.english ? 'Choose the SSI site' : 'SSI-Tauchplatz wählen' });
      await expect(choose).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
      await choose.click();
      await expect(page.getByRole('dialog').getByRole('option').first()).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
      await leaveSsi(request, diveId);
    });

    test('a dive with buddies: adding someone, and one SSI doesn’t know yet', { tag: ['@dives'] }, async ({ page, request }) => {
      await connectSsi(request);
      await readyForSsi(request, diveId);
      // Mia Stone in the SSI list stays free to pick: buddies.spec.ts may have linked her to a "Mia" on this server.
      await clearParticipants(request, diveId);
      await forgetDivers(request, 'Mia');
      await setBuddies(request, diveId, [await externalDiver(request, 'Kai Lund', '4989164'), await externalDiver(request, 'Ulla Berg')]);
      await page.goto(`/#/dives/${diveId}`);
      const find = page.getByRole('button', { name: v.english ? 'Find Ulla Berg in your SSI buddy list' : 'Ulla Berg in deiner SSI-Buddyliste suchen' });
      await expect(find).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
      await page.getByRole('button', { name: v.english ? 'Add someone' : 'Jemanden hinzufügen' }).click();
      await expect(page.getByRole('dialog').getByRole('radio').first()).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
      await page.keyboard.press('Escape');
      await find.click();
      await expect(page.getByRole('dialog').getByRole('option').first()).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
      await clearParticipants(request, diveId);
      await leaveSsi(request, diveId);
    });

    test('my account, the SSI buddy list', { tag: ['@account'] }, async ({ page, request }) => {
      await connectSsi(request);
      await page.goto('/#/account');
      await page.getByRole('button', { name: v.english ? /^Show your SSI buddy list/ : /^Deine SSI-Buddyliste zeigen/ }).click();
      await expect(page.getByRole('row', { name: /Mia Stone/ })).toBeVisible();
      await expectGoodPage(page, title('My account'), v);
    });

    // Importing dives from SSI (ADR 0030), with Lena's logbook: the setting, the preview with a computer and a decision
    // (the entry on 13 August always has two dives to choose from), the outcome, and a dive without a recording.
    test('my account, importing dives from SSI: the preview, then the outcome', { tag: ['@account'] }, async ({ page, request }) => {
      await lenaReady(request);
      try {
        await page.goto('/#/account');
        const section = page.getByRole('region', { name: v.english ? 'Dives of Lena from SSI' : 'Tauchgänge von Lena aus SSI' });
        await section.getByRole('button', { name: v.english ? 'Show what the import would do' : 'Zeigen, was der Import tun würde' }).click();
        await expect(section.getByRole('radiogroup', { name: v.english ? /^SSI dive 15: / : /^SSI-Tauchgang 15: / })).toBeVisible();
        await expectGoodPage(page, title('My account'), v);
        await section.getByRole('button', { name: v.english ? 'Import from SSI' : 'Aus SSI importieren' }).click();
        await expect(section.getByRole('link', { name: v.english ? 'Go to the logbook' : 'Zum Logbuch' })).toBeVisible({ timeout: 30_000 });
        await expectGoodPage(page, title('My account'), v);
      } finally {
        await leaveLena(request);
      }
    });

    test('a dive from SSI without a recording, and where its time zone came from', { tag: ['@dives'] }, async ({ page, request }) => {
      try {
        await page.goto(`/#/dives/${await diveWithoutRecording(request)}`);
        await expect(page.getByText(v.english ? /^No recording yet/ : /^Noch keine Aufzeichnung/)).toBeVisible();
        await expectGoodPage(page, title('Dive'), v);
      } finally {
        await leaveLena(request);
      }
    });

    // Deleting a Dive (ADR 0026): the shared dive 42 only gets the dialog opened; dive 9 is deleted and comes back.
    const openDelete = async (page: Page, id: string, number: number) => {
      await page.goto(`/#/dives/${id}`);
      await page.getByRole('button', { name: v.english ? `More: Dive ${number}` : `Mehr: Tauchgang ${number}` }).click();
      await page.getByRole('menuitem', { name: v.english ? /^Delete dive/ : /^Tauchgang löschen/ }).click();
      return page.getByRole('dialog');
    };

    test('deleting a dive, asked first', { tag: ['@dives'] }, async ({ page }) => {
      const dialog = await openDelete(page, diveId, 42);
      await expect(dialog.getByRole('button', { name: v.english ? 'Cancel' : 'Abbrechen' })).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
    });

    test('deleting a dive in SSI, then the logbook with Undo and the deleted dives', { tag: ['@dives'] }, async ({ page, request }) => {
      const id = await deletableDive(request);
      await sendToSsi(request, id);
      try {
        const dialog = await openDelete(page, id, 9);
        await expect(dialog.getByRole('button', { name: v.english ? 'Delete here and in SSI' : 'Hier und in SSI löschen' })).toBeVisible();
        await expectGoodPage(page, title('Dive 9'), v);
        await dialog.getByRole('button', { name: v.english ? 'Delete only here' : 'Nur hier löschen' }).click();
        await expect(page.getByRole('button', { name: v.english ? 'Undo' : 'Rückgängig' })).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
        await page.reload();
        await page.getByRole('button', { name: v.english ? 'Show deleted dives' : 'Gelöschte Tauchgänge zeigen', exact: true }).click();
        await expect(page.getByRole('button', { name: v.english ? 'Delete in SSI: Dive 9' : 'In SSI löschen: Tauchgang 9' })).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
      } finally {
        await deletableDive(request);
      }
    });

    test('admin, with a link to pass on', { tag: ['@admin'] }, async ({ page }) => {
      await page.goto('/#/admin');
      await page.getByRole('textbox', { name: v.english ? 'E-mail' : 'E-Mail' }).fill(`shown-${v.locale}@example.com`);
      await page.getByRole('button', { name: v.english ? 'Create invitation link' : 'Einladungslink erstellen' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Copy' : 'Kopieren' })).toBeVisible();
      await expectGoodPage(page, title('Admin'), v);
      // On a phone the rows are cards: the actions stay in sight instead of scrolling away sideways.
      // (Below the fold is fine on a short screen; off to the right is not.)
      const revoke = await page.getByRole('button', { name: v.english ? /^Revoke:/ : /^Zurückziehen:/ }).first().boundingBox();
      expect(revoke!.x + revoke!.width).toBeLessThanOrEqual(v.viewport.width);
    });

    test.describe('signed out', () => {
      test.use({ storageState: { cookies: [], origins: [] } });

      test('sign-in, with errors', { tag: ['@account'] }, async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: v.english ? 'Sign in' : 'Anmelden' }).click();
        await expect(page.getByRole('textbox').first()).toHaveAttribute('aria-invalid', 'true');
        await expectGoodPage(page, title('Sign in'), v);
      });

      test('setup', { tag: ['@account'] }, async ({ page }) => {
        await page.goto('/#/setup');
        await expectGoodPage(page, title('Set up Dive Hub'), v);
      });

      test('invitation', { tag: ['@account'] }, async ({ page }) => {
        await page.goto(`/#/invite/${invitationToken}`);
        await expect(page.getByRole('textbox').first()).toBeVisible();
        await expectGoodPage(page, title('Join Dive Hub'), v);
      });

      test('password reset link', { tag: ['@account'] }, async ({ page }) => {
        await page.goto(`/#/reset/${resetToken}`);
        await expect(page.getByRole('textbox').first()).toBeVisible();
        await expectGoodPage(page, title('Reset password'), v);
      });
    });
  });
}

test.describe('behaviour', () => {
  test.use({ locale: 'en-GB' });

  // The variants above check four widths in depth; this sweeps the widths in between (tablets, split
  // screens), where tables switch layouts by the room they have (container queries). One test per page,
  // so the pages spread over the workers (ADR 0023).
  const sweep: [string, () => string, string[]][] = [
    ['logbook', () => '/', ['@dives']], ['dive', () => `/#/dives/${diveId}`, ['@dives']], ['Divers', () => '/#/divers', ['@divers']],
    ['Dive sites', () => '/#/sites', ['@sites']], ['a dive site', () => `/#/sites/${siteId}`, ['@sites']],
    ['an imported dive site', () => `/#/sites/${importedSiteId}`, ['@sites']], ['account', () => '/#/account', ['@account']],
    ['admin', () => '/#/admin', ['@admin']], ['site import', () => '/#/admin/site-imports', ['@admin', '@sites']],
  ];
  for (const [name, path, tag] of sweep) {
    test(`${name} fits every width from 320 to 1440 px: no page or table scrolls sideways`, { tag: [...tag, '@layout'] }, async ({ page }) => {
      for (const width of [320, 480, 640, 800, 960, 1120, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path());
        await page.getByRole('heading', { level: 1 }).waitFor();
        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          tables: [...document.querySelectorAll('.table-scroll')].map((t) => t.scrollWidth - t.clientWidth).filter((o) => o > 0),
        }));
        expect(overflow, `${path()} at ${width} px`).toEqual({ page: 0, tables: [] });
      }
    });
  }

  test('text at 200 % still fits: nothing scrolls sideways (WCAG 1.4.4)', { tag: ['@layout'] }, async ({ page }) => {
    for (const path of ['/', `/#/dives/${diveId}`, '/#/divers', '/#/sites', `/#/sites/${siteId}`, `/#/sites/${importedSiteId}`, '/#/account', '/#/admin', '/#/admin/site-imports']) {
      await page.goto(path);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tables: [...document.querySelectorAll('.table-scroll')].map((t) => t.scrollWidth - t.clientWidth).filter((o) => o > 0),
      }));
      expect(overflow, path).toEqual({ page: 0, tables: [] });
    }
  });

  test('moving to another page puts focus on its heading', { tag: ['@layout'] }, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('navigation').getByRole('link', { name: 'Divers' }).click();
    await expect(page.getByRole('heading', { name: 'Divers', level: 1 })).toBeFocused();
    await expect(page).toHaveTitle('Divers – Dive Hub');
  });

  for (const [where, url] of [['Dive sites', '/#/sites'], ['logbook', '/']] as const) {
    test(`searching the ${where} keeps the field focused and the page in place while the results update`, { tag: ['@layout', '@sites', '@dives'] }, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole('table')).toBeVisible();
      // Marks the page as it is now: a rebuilt page would lose the mark.
      await page.locator('#main h1').evaluate((h) => { (h as HTMLElement).dataset.before = 'search'; });
      // Sorting changes the address too: the pressed header keeps the focus, the page stays.
      const sort = page.getByRole('columnheader').getByRole('button').first();
      await sort.click();
      await expect(page).toHaveURL(/sort=|order=/);
      await expect(sort).toBeFocused();
      const search = page.getByRole('searchbox', { name: 'Search' });
      await search.click();
      await page.keyboard.type('Ras');
      await expect(page).toHaveURL(/q=Ras/);
      await page.keyboard.type(' Moh');
      await expect(page).toHaveURL(/q=Ras(\+|%20)Moh/);
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('Ras Moh');
      await expect(page.locator('#main h1')).toHaveAttribute('data-before', 'search');
      // A link elsewhere that drops the search empties the field, and the words don't come back.
      await page.getByRole('navigation').getByRole('link', { name: where === 'logbook' ? 'Logbook' : 'Dive sites' }).click();
      await expect(search).toHaveValue('');
      await page.waitForTimeout(500);
      await expect(page).not.toHaveURL(/q=/);
    });
  }

  test('an unknown dive says so at once, without retrying first', { tag: ['@dives'] }, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('table')).toBeVisible();
    // Counted, not timed: a retry would ask a second time before saying so (a time limit failed on a busy machine).
    const asked: string[] = [];
    page.on('request', (r) => { if (/\/api\/dives\/00000000-0000-7000-8000-000000000000$/.test(r.url())) asked.push(r.url()); });
    await page.evaluate(() => { location.hash = '/dives/00000000-0000-7000-8000-000000000000'; });
    await expect(page.getByRole('heading', { name: 'Dive not found' })).toBeVisible();
    expect(asked).toHaveLength(1);
    await expect(page.getByRole('link', { name: 'Logbook' }).last()).toBeVisible();
  });

  test('number fields name their unit and say what the recording has', { tag: ['@dives'] }, async ({ page, request }) => {
    await resetDive(request);
    await page.goto(`/#/dives/${diveId}`);
    await page.getByRole('button', { name: 'Edit dive' }).click();
    const maxDepth = page.getByRole('textbox', { name: 'Max depth (m)' });
    await expect(maxDepth).toHaveAccessibleDescription('Recording: 18.5 m');
    await maxDepth.fill('20');
    await page.getByRole('button', { name: 'Save' }).click();
    // The value set by hand shows the recording's value as text, not in a tooltip.
    await expect(page.locator('dl.facts').first()).toContainText('Recording: 18.5 m');
    await resetDive(request);
  });

  test('editing a dive: focus goes into the form and back to "Edit dive"', { tag: ['@dives'] }, async ({ page, request }) => {
    await resetDive(request);
    await page.goto(`/#/dives/${diveId}`);
    await page.getByRole('button', { name: 'Edit dive' }).click();
    await expect(page.getByRole('textbox', { name: 'Dive number' })).toBeFocused();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Edit dive' })).toBeFocused();
  });

  test('unsaved changes: leaving or cancelling asks first, and saving is announced', { tag: ['@dives'] }, async ({ page, request }) => {
    await resetDive(request);
    await page.goto(`/#/dives/${diveId}`);
    await page.getByRole('button', { name: 'Edit dive' }).click();
    await page.getByRole('textbox', { name: 'Notes' }).fill('Not saved yet');

    page.once('dialog', (dialog) => void dialog.dismiss()); // stay
    await page.getByRole('navigation').getByRole('link', { name: 'Divers' }).click();
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('Not saved yet');
    expect(page.url()).toContain(`/dives/${diveId}`);

    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('textbox', { name: 'Notes' })).toBeVisible();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-announcer]')).toHaveText('Dive saved.');
    await page.getByRole('navigation').getByRole('link', { name: 'Divers' }).click(); // no question now
    await expect(page.getByRole('heading', { name: 'Divers', level: 1 })).toBeVisible();
    await resetDive(request);
  });

  test('the depth profile is described in text and as a table', { tag: ['@dives'] }, async ({ page, request }) => {
    await resetDive(request);
    await page.goto(`/#/dives/${diveId}`);
    const chart = page.getByRole('img', { name: 'Depth profile' });
    await expect(chart).toHaveAccessibleDescription(/^Deepest point 18\.5 m after \d+ min; 30 min in total\. Water 25°C – 26°C\.$/);
    await page.getByText('Profile as a table').click();
    await expect(page.getByRole('region', { name: 'Profile as a table' }).getByRole('row')).toHaveCount(32); // header + minutes 0–30
  });

  test('the logbook comes first; files dropped anywhere on the page are imported', { tag: ['@dives'] }, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
    await expect(page.getByText('Drop Garmin FIT files or zips here')).toHaveCount(0); // the first-run panel
    await expect(page.getByRole('button', { name: 'Import files' })).toBeVisible();

    await dropFiles(page, [
      { name: 'notes.txt', bytes: [...Buffer.from('not a dive')] },
      { name: 'main-computer.fit', bytes: [...readFileSync('e2e/fixtures/main-computer.fit')] },
    ]);
    await expect(page.getByText('Skipped notes.txt')).toBeVisible();
    const imports = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Imports' }) });
    await expect(imports.getByText('main-computer.fit').first()).toBeVisible();
    await expect(imports.getByText('already imported').first()).toBeVisible();
    await expect(page.locator('[data-announcer]')).toHaveText('main-computer.fit: already imported');
  });

  test('the chosen recording is in the address, so a reload keeps it', { tag: ['@dives'] }, async ({ page, request }) => {
    await resetDive(request);
    await page.goto(`/#/dives/${diveId}`);
    await page.getByRole('tab', { name: /\(999\)/ }).click();
    await expect(page).toHaveURL(/\?recording=/);
    await page.reload();
    await expect(page.getByRole('tab', { name: /\(999\)/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('edits in a row are one history entry', { tag: ['@dives'] }, async ({ page, request }) => {
    await resetDive(request);
    await page.goto(`/#/dives/${diveId}`);
    for (const notes of ['First thought', 'Second thought']) {
      await page.getByRole('button', { name: 'Edit dive' }).click();
      await page.getByRole('textbox', { name: 'Notes' }).fill(notes);
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText(notes)).toBeVisible();
    }
    // One entry for both saves (and the test's own resets just before, by the same User).
    const latest = page.locator('.history > li').first();
    await expect(latest).toContainText(/\d+ edits/);
    await expect(latest).toContainText('Notes changed');
    // At most the latest three show; more hide behind "Show the whole history" (how many there are depends on
    // what other specs did on this server, ADR 0023).
    expect(await page.locator('.history > li').count()).toBeLessThanOrEqual(3);
    await resetDive(request);
  });

  test('the account is a labelled menu with "My account" and "Sign out"', { tag: ['@account'] }, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Erika\s*, account$/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'My account' }).click();
    await expect(page.getByRole('heading', { name: 'My account', level: 1 })).toBeVisible();
  });

  test('a second Diver with the same name is allowed, with a warning', { tag: ['@divers'] }, async ({ page }) => {
    await page.goto('/#/divers');
    const field = page.getByRole('textbox', { name: 'Add a Diver' });
    await field.fill('erika');
    await expect(field).toHaveAccessibleDescription(/You already have a Diver called Erika/);
    await field.fill('');
  });

  test('the logbook sorts by a column and searches; the address keeps both', { tag: ['@dives'] }, async ({ page }) => {
    await page.goto('/');
    const depthHeader = page.getByRole('columnheader', { name: 'Max depth' });
    await depthHeader.getByRole('button').click();
    await expect(page).toHaveURL(/sort=maxDepth/);
    await expect(depthHeader).toHaveAttribute('aria-sort', 'descending');
    await depthHeader.getByRole('button').click();
    await expect(depthHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'none');

    const search = page.getByRole('searchbox', { name: 'Search' });
    await search.fill('42');
    await expect(page).toHaveURL(/q=42/);
    await expect(page.getByRole('row')).toHaveCount(2); // header + dive 42
    await page.reload();
    await expect(search).toHaveValue('42');
    await search.fill('no such words');
    await expect(page.getByText('No dives match “no such words”.')).toBeVisible();
  });

  test('menus grow from their trigger; with reduced motion nothing moves (ADR 0018)', { tag: ['@layout'] }, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('table')).toBeVisible();
    const menu = page.getByRole('button', { name: /^Erika\s*, account$/ });
    // Opens the menu and lists the animations running a frame later, with their durations.
    const open = () => menu.evaluate(async (button) => {
      (button as HTMLElement).click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return document.getAnimations().map((a) => ({
        name: (a as CSSAnimation).animationName, duration: Number(a.effect?.getComputedTiming().duration ?? 0),
      }));
    });
    expect(await open()).toContainEqual({ name: 'enter-pop', duration: 150 });
    await page.getByRole('menu').press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await open()).filter((a) => a.duration > 0)).toEqual([]);
    await expect(page.getByRole('menuitem', { name: 'My account' })).toBeVisible();
  });

  test('the only admin is not offered to remove their own admin role', { tag: ['@admin'] }, async ({ page }) => {
    await page.goto('/#/admin');
    const me = page.getByRole('row').filter({ hasText: 'erika@example.com' });
    await expect(me.getByRole('button', { name: /Password reset link/ })).toBeVisible();
    await expect(me.getByRole('button', { name: /Remove admin role/ })).toHaveCount(0);
  });
});

/** Drops files on the page the way a browser does when they're dragged from the desktop. */
async function dropFiles(page: Page, files: { name: string; bytes: number[] }[]) {
  await page.evaluate((list) => {
    const data = new DataTransfer();
    for (const f of list) data.items.add(new File([new Uint8Array(f.bytes)], f.name));
    const target = document.querySelector('main')!;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
    }
  }, files);
}

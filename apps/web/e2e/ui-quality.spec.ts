// Every page against the UI review's rules (docs/research/2026-10-03-ui-review.md), in English on a
// light desktop and in German on a dark phone, plus the narrowest phone (320 px, WCAG 1.4.10 reflow)
// and a German tablet in between (responsiveness, 2026-10-04): see expectGoodPage. Plus the behaviour the review
// asked for: focus after navigation, a quick "not found", field names with units, admin safeguards.
// Its tests run spread over all workers (ADR 0023); e2e/prepare.ts crowds each server first.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { dataFile, type PreparedData } from './prepare.ts';
import {
  cancelWaitingImports, waitingImport,
  E2E_BASE_URL, E2E_SERVERS, E2E_SESSION, LENA_SSI, activeResultShown, aiAccessReady, askMcp, assessedDive, createAiAccess, putAside, uniqueWord, clearParticipants, conflictForLena, connectSsi, deletableDive, lenaClaimable, diveRows, diveWithoutRecording, expectGoodPage, externalDiver, openLine,
  forgetDivers, leaveLena, leaveSsi, lenaReady, mergePair, mergeablePair, readyForSsi, resetDive, sendToSsi, setBuddies, setPreferences, falseStart, keepFalseStart, tankPodDive
} from './support.ts';

// Spread over all workers (ADR 0023): every test stands alone; beforeAll prepares each worker's server.
test.describe.configure({ mode: 'parallel' });

const headers = { origin: E2E_BASE_URL };
let diveId: string;
let invitationToken: string;
let resetToken: string;
let siteId: string;
let importedSiteId: string;
let centreId: string;

/** Circles stay round and on screen, also at twice the text size (WCAG 1.4.4). Whole pages at 200 % are the layout test's. */
async function expectCirclesFit(page: Page) {
  const zoom = await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const bad = await page.locator('.avatar-inline').evaluateAll((els) => els
    .filter((e) => e.checkVisibility())
    .map((e) => ({ box: e.getBoundingClientRect(), text: e.textContent }))
    .filter(({ box }) => Math.abs(box.width - box.height) > 1 || box.right > document.documentElement.clientWidth)
    .map((c) => c.text));
  await zoom.evaluate((el) => (el as Element).remove());
  expect(bad, 'circles that are not round or stick out').toEqual([]);
}
let offerSiteId: string;

// Prepared once per server before any test (e2e/prepare.ts): a crowd, links to pass on, an imported site.
// Read here, not when the file loads: Playwright may load spec files before the global setup wrote it.
// Other specs on this server may have changed the language; these tests let the browser decide.
test.beforeAll(async ({ playwright }) => {
  ({ diveId, invitationToken, resetToken, siteId, importedSiteId, offerSiteId, centreId } =
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
  // The variants without axe run only in the full check (@full, ADR 0023): the two with axe cover both languages
  // and colour schemes, and the width sweep covers the widths.
  test.describe(v.name, { tag: v.axe ? [] : ['@full'] }, () => {
    test.use({ locale: v.locale, colorScheme: v.colorScheme, viewport: v.viewport });
    const title = (english: string) => (v.english ? english : undefined);

    test('logbook', { tag: ['@dives'] }, async ({ page, request }) => {
      await resetDive(request);
      // Rows with everything a row can say (ADR 0040): buddies as circles, a dive without a recording from SSI.
      // More people than circles fit, one of them with a long name (e2e/prepare.ts).
      const own = (await (await request.get(`/api/dives/${diveId}`)).json() as { diverId: string }).diverId;
      const divers = await (await request.get('/api/divers')).json() as { id: string; name: string }[];
      await setBuddies(request, diveId, [
        await externalDiver(request, 'Kai Lund'), await externalDiver(request, 'Ulla Berg'), await externalDiver(request, 'Mia Stone'),
        ...divers.filter((d) => d.id !== own && d.name.startsWith('Konstantin')).map((d) => d.id),
      ]);
      await diveWithoutRecording(request);
      try {
        await page.goto('/');
        await expect(diveRows(page).first()).toBeVisible();
        await expect(page.getByRole('group', { name: v.english ? 'Show only' : 'Nur anzeigen' })).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
        // A filter pressed, and sorted by depth: no month headings, the day with its year.
        await page.goto('/#/?sort=maxDepth&only=no-recording');
        await expect(page.getByRole('button', { name: v.english ? /^No recording \d+$/ : /^Keine Aufzeichnung \d+$/ })).toHaveAttribute('aria-pressed', 'true');
        await expect(diveRows(page).first()).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
        // Nothing fits: the filters are named, and all dives are one press away.
        await page.goto('/#/?q=zzzz&only=no-recording,with-findings');
        await expect(page.getByRole('button', { name: v.english ? 'Show all dives' : 'Alle Tauchgänge zeigen' })).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
      } finally {
        await clearParticipants(request, diveId);
        await leaveLena(request);
      }
    });

    test('dive, reading and editing', { tag: ['@dives'] }, async ({ page }) => {
      await page.goto(`/#/dives/${diveId}`);
      await expect(page.locator('canvas').first()).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
      await page.getByRole('button', { name: v.english ? 'Edit dive' : 'Tauchgang bearbeiten' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Save' : 'Speichern' })).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
    });

    test("a dive's assessment: several findings, one shown on the profile", { tag: ['@dives'] }, async ({ page, request }) => {
      const id = await assessedDive(request);
      await page.goto(`/#/dives/${id}`);
      const lane = page.getByRole('group', { name: v.english ? 'Findings along the dive' : 'Hinweise im Verlauf des Tauchgangs' });
      // Selecting a bar opens its finding: the page is checked with one finding open and the others one row each.
      await lane.getByRole('button', { name: v.english ? /^Fast ascent/ : /^Schneller Aufstieg/ }).click();
      await expect(page.getByText(v.english ? /Not medical advice/ : /Kein medizinischer Rat/)).toBeVisible();
      await expect(page.getByRole('button', { name: v.english ? /^Put aside on this dive: Fast ascent/ : /: Schneller Aufstieg$/ }).first()).toBeVisible();
      await expectGoodPage(page, title('Dive 77'), v);
      // The fixed note's full text, one step away.
      await page.getByRole('button', { name: v.english ? /^What the assessment can/ : /^Was die Auswertung sagen kann/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectGoodPage(page, title('Dive 77'), v);
      await page.keyboard.press('Escape');
      // The lane stays inside the page on a phone.
      const box = await lane.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(v.viewport.width);
    });

    test("a dive's assessment: a finding put aside and a rule muted", { tag: ['@dives'] }, async ({ page, request }) => {
      const id = await assessedDive(request);
      try {
        await putAside(request, id, { dismiss: ['ppo2'], mute: ['ascent_rate'] });
        await page.goto(`/#/dives/${id}`);
        await page.getByText(v.english ? '2 findings put aside' : '2 Hinweise beiseitegelegt').click();
        await expect(page.getByRole('button', { name: v.english ? 'Show again: Fast ascent' : 'Wieder zeigen: Schneller Aufstieg' })).toBeVisible();
        await expectGoodPage(page, title('Dive 77'), v);
      } finally {
        await assessedDive(request);
      }
    });

    test("a dive's assessment: nothing stands out", { tag: ['@dives'] }, async ({ page, request }) => {
      const id = await assessedDive(request);
      try {
        await putAside(request, id, { dismiss: 'all' });
        await page.goto(`/#/dives/${id}`);
        await expect(page.getByText(v.english ? 'Nothing stands out on this dive.' : 'An diesem Tauchgang fällt nichts auf.')).toBeVisible();
        await expectGoodPage(page, title('Dive 77'), v);
      } finally {
        await assessedDive(request);
      }
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

    test('Dive centres, and creating one', { tag: ['@sites'] }, async ({ page }) => {
      await page.goto('/#/centres');
      await expect(page.getByRole('link', { name: /^Tauchsportzentrum Beispielhausen/ })).toBeVisible();
      await expectGoodPage(page, title('Dive centres'), v);
      await page.getByRole('button', { name: v.english ? 'New dive centre' : 'Neue Tauchbasis' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Create dive centre' : 'Tauchbasis anlegen' })).toBeVisible();
      await expectGoodPage(page, title('Dive centres'), v);
    });

    test('the code scanner, without a camera', { tag: ['@sites'] }, async ({ page }) => {
      // The same answer in every browser the tests run in: no camera.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new DOMException('', 'NotFoundError'); } } });
      });
      await page.goto('/#/centres');
      await page.getByRole('button', { name: v.english ? 'New dive centre' : 'Neue Tauchbasis' }).click();
      await page.getByRole('button', { name: v.english ? 'Scan with camera' : 'Mit Kamera scannen' }).click();
      const dialog = page.getByRole('dialog', { name: v.english ? 'Scan code' : 'Code scannen' });
      await expect(dialog.getByRole('button', { name: v.english ? 'Try again' : 'Erneut versuchen' })).toBeVisible();
      await expectGoodPage(page, title('Dive centres'), v);
    });

    test('a dive centre with its code, changing its number and adding a dive site', { tag: ['@sites'] }, async ({ page }) => {
      await page.goto(`/#/centres/${centreId}`);
      const code = page.getByRole('img', { name: /Tauchsportzentrum Beispielhausen/ });
      await expect(code).toBeVisible();
      // The code is a square that fits the page, dark on white in both colour schemes: a scanner needs that.
      const box = (await code.boundingBox())!;
      expect(Math.abs(box.width - box.height)).toBeLessThan(1);
      expect(box.width).toBeGreaterThanOrEqual(200);
      expect(await code.locator('.qr-code-paper').evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(255, 255, 255)');
      expect(await code.locator('.qr-code-ink').evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(0, 0, 0)');
      await expectGoodPage(page, undefined, v);
      await page.getByRole('button', { name: v.english ? 'Change: SSI centre number' : 'Ändern: SSI-Centernummer' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Save' : 'Speichern' })).toBeVisible();
      await expectGoodPage(page, undefined, v);
      await page.getByRole('button', { name: v.english ? 'Cancel' : 'Abbrechen' }).click();
      await page.getByRole('button', { name: v.english ? 'Add dive site' : 'Tauchplatz hinzufügen' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectGoodPage(page, undefined, v);
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
      await activeResultShown(page.getByRole('dialog').getByRole('searchbox'));
      await expectGoodPage(page, title('Dive 42'), v);
      await page.getByRole('button', { name: v.english ? 'New dive site' : 'Neuer Tauchplatz' }).click();
      await expect(page.getByRole('button', { name: v.english ? 'Create and choose' : 'Anlegen und auswählen' })).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
    });

    test('Divers, with a rule of the assessment muted', { tag: ['@divers', '@dives'] }, async ({ page, request }) => {
      const id = await assessedDive(request);
      try {
        await putAside(request, id, { mute: ['ascent_rate', 'safety_stop'] });
        await page.goto('/#/divers');
        await expect(page.getByRole('button', { name: v.english ? /^Show again: Fast ascent, / : /^Wieder zeigen: Schneller Aufstieg, / })).toBeVisible();
        await expectGoodPage(page, title('Divers'), v);
      } finally {
        await assessedDive(request);
      }
    });

    test('Divers and Devices', { tag: ['@divers'] }, async ({ page, request }) => {
      // Someone without a logbook here (ADR 0028), listed under "Other divers".
      await externalDiver(request, 'Ulla Berg');
      await page.goto('/#/divers');
      await expect(page.getByText('Ulla Berg')).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();
      // A circle beside each name: decoration (the name is the text), the same two letters as in the logbook row.
      const ulla = page.getByRole('listitem').filter({ hasText: 'Ulla Berg' }).first();
      await expect(ulla.locator('.avatar[aria-hidden="true"]')).toHaveText('UB');
      await expectGoodPage(page, title('Divers'), v);
      await expectCirclesFit(page);
    });

    test('my account', { tag: ['@account'] }, async ({ page }) => {
      await page.goto('/#/account');
      await expect(page.getByRole('table').first()).toBeVisible();
      await expectGoodPage(page, title('My account'), v);
    });

    test('my account, AI access: none yet, then a new key shown once', { tag: ['@account'] }, async ({ page, request }) => {
      await aiAccessReady(request);
      try {
        await page.goto('/#/account');
        await expect(page.getByText(v.english ? 'You have no AI access yet.' : 'Du hast noch keinen KI-Zugang.')).toBeVisible();
        await expectGoodPage(page, title('My account'), v);
        // A long name, as someone might type it.
        await page.getByRole('textbox', { name: 'Name' }).fill(`Claude Code on the old laptop in the dive shop ${v.locale}`);
        await page.getByRole('button', { name: v.english ? 'Create AI access' : 'KI-Zugang erstellen' }).click();
        await expect(page.getByRole('button', { name: v.english ? 'Copy: Key' : 'Kopieren: Schlüssel' })).toBeVisible();
        await expectGoodPage(page, title('My account'), v);
      } finally {
        await aiAccessReady(request);
      }
    });

    test('my account, AI access: what was read', { tag: ['@account'] }, async ({ page, request }) => {
      await aiAccessReady(request);
      try {
        const access = await createAiAccess(request, `Editor on the desk ${v.locale}`, true);
        await askMcp(request, access.key, 'logbook_search_dives', { query: 'wreck', limit: 5, sort: 'depth' });
        await askMcp(request, access.key, 'logbook_get_dive', { dive_id: '00000000-0000-7000-8000-000000000000' });
        await page.goto('/#/account');
        await expect(page.getByRole('region', { name: v.english ? 'What was read' : 'Was gelesen wurde' }).getByText('logbook_get_dive').first()).toBeVisible();
        await expectGoodPage(page, title('My account'), v);
      } finally {
        await aiAccessReady(request);
      }
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
      // Closed, the dive at SSI is one line; that page is checked by the other dive cases. Here it is open.
      await openLine(page, 'SSI');
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
      await openLine(page, 'SSI');
      await openLine(page, v.english ? 'History' : 'Verlauf');
      const find = page.getByRole('button', { name: v.english ? 'Find Ulla Berg in your SSI buddy list' : 'Ulla Berg in deiner SSI-Buddyliste suchen' });
      await expect(find).toBeVisible();
      const people = page.getByRole('group', { name: v.english ? 'Buddies and guides' : 'Buddys und Guides' }).getByRole('listitem');
      await expect(people.locator('.avatar[aria-hidden="true"]')).toHaveText(['KL', 'UB']);
      await expectGoodPage(page, title('Dive 42'), v);
      await expectCirclesFit(page);
      // Roles and taking someone off, in the dialog from the fact.
      await page.getByRole('button', { name: v.english ? 'Change: Buddies and guides' : 'Ändern: Buddys und Guides' }).click();
      await expect(page.getByRole('dialog').getByRole('listitem').first()).toBeVisible();
      await expectGoodPage(page, title('Dive 42'), v);
      await page.keyboard.press('Escape');
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

    test('my account, the times of the dives at SSI', { tag: ['@account'] }, async ({ page, request }) => {
      await lenaReady(request);
      try {
        await page.goto('/#/account');
        const section = page.getByRole('region', { name: v.english ? 'Dives of Lena from SSI' : 'Tauchgänge von Lena aus SSI' });
        await section.getByRole('button', { name: v.english ? 'Show when each dive was made' : 'Zeigen, wann jeder Tauchgang angelegt wurde' }).click();
        await expect(section.getByRole('region', { name: v.english ? 'Dives in SSI with start and origin' : 'Tauchgänge in SSI mit Beginn und Herkunft' })).toBeVisible();
        await expectGoodPage(page, title('My account'), v);
      } finally {
        await leaveLena(request);
      }
    });

    test('my account, importing from SSI: a dive changed both here and in SSI', { tag: ['@account'] }, async ({ page, request }) => {
      try {
        await conflictForLena(request, `${v.locale}-${uniqueWord()}`);
        await page.goto('/#/account');
        const section = page.getByRole('region', { name: v.english ? 'Dives of Lena from SSI' : 'Tauchgänge von Lena aus SSI' });
        await section.getByRole('button', { name: v.english ? 'Show what the import would do' : 'Zeigen, was der Import tun würde' }).click();
        await expect(section.getByRole('heading', { name: v.english ? 'Changed in both places' : 'An beiden Stellen geändert' })).toBeVisible();
        await expectGoodPage(page, title('My account'), v);
      } finally {
        await leaveLena(request);
      }
    });

    test('my account, connecting an SSI account a buddy here already has', { tag: ['@account'] }, async ({ page, request }) => {
      await lenaClaimable(request);
      try {
        await page.goto('/#/account');
        const panel = page.locator('section', { has: page.getByRole('heading', { name: 'SSI', exact: true }) });
        await panel.getByRole('button', { name: v.english ? /Diver$/ : /Taucher$/ }).click();
        await page.getByRole('option', { name: 'Lena', exact: true }).click();
        await panel.getByRole('textbox', { name: v.english ? 'SSI e-mail' : 'SSI-E-Mail' }).fill(LENA_SSI.login);
        await panel.getByRole('textbox', { name: v.english ? 'SSI password' : 'SSI-Passwort' }).fill(LENA_SSI.password);
        await panel.getByRole('button', { name: v.english ? 'Connect to SSI' : 'Mit SSI verbinden' }).click();
        await expect(panel.getByRole('button', { name: v.english ? /^Yes, I am Lena Berger/ : /^Ja, ich bin Lena Berger/ })).toBeVisible();
        await expectGoodPage(page, title('My account'), v);
      } finally {
        await leaveLena(request);
        // The question was left open: Lena's account stays with the external Diver; give it back to her.
        const divers = await (await request.get('/api/divers')).json() as { id: string; name: string }[];
        const others = await (await request.get('/api/external-divers?q=Lena%20Berger')).json() as { divers: { id: string }[] };
        for (const o of others.divers) await request.delete(`/api/external-divers/${o.id}`, { headers });
        await request.put(`/api/divers/${divers.find((d) => d.name === 'Lena')!.id}/external-ids/ssi`, { data: { externalId: '6100200' }, headers });
      }
    });

    test('Divers, a diver’s codes and a code being taken', { tag: ['@divers'] }, async ({ page, request }) => {
      // Made up: no real person's code is in this repository (ADR 0043).
      const account = String(4_610_000 + variants.indexOf(v));
      const name = `Annabelle-Sophie Probe ${account}`;
      const code = (to: string) => `buddy;${to};firstName:Annabelle-Sophie;lastName:Probe ${to};email:annabelle-sophie.probe@example.com;leaderNr:70002`;
      await forgetDivers(request, name);
      await request.post('/api/divers/from-code', { data: { text: code(account), create: true }, headers });
      try {
        await page.goto('/#/divers');
        await page.getByRole('button', { name: `Codes: ${name}` }).click();
        await expect(page.getByRole('dialog').getByRole('img')).toHaveCount(2);
        await expectGoodPage(page, title('Divers'), v);
        await page.getByRole('button', { name: v.english ? 'Edit details' : 'Angaben bearbeiten' }).click();
        await expect(page.getByRole('textbox', { name: v.english ? 'First name' : 'Vorname' })).toBeFocused();
        await expectGoodPage(page, title('Divers'), v);
        await page.keyboard.press('Escape');
        // A code nobody here has the account of: the question who it is.
        await page.getByRole('button', { name: v.english ? 'Add from a code' : 'Aus Code hinzufügen' }).click();
        await page.getByRole('textbox', { name: v.english ? 'Text of the code (optional)' : 'Text des Codes (optional)' }).fill(code(`9${account}`));
        await page.getByRole('button', { name: v.english ? 'Read code' : 'Code lesen' }).click();
        await expect(page.getByRole('radiogroup')).toBeVisible();
        await expectGoodPage(page, title('Divers'), v);
        // And the code of someone already here, with nothing new in it.
        await page.getByRole('textbox', { name: v.english ? 'Text of the code (optional)' : 'Text des Codes (optional)' }).fill(code(account));
        await page.getByRole('button', { name: v.english ? 'Read code' : 'Code lesen' }).click();
        await expect(page.getByRole('button', { name: v.english ? 'Show codes' : 'Codes zeigen' })).toBeVisible();
        await expectGoodPage(page, title('Divers'), v);
      } finally {
        await forgetDivers(request, name);
      }
    });

    test('Divers, an admin merging an external diver', { tag: ['@divers'] }, async ({ page, request }) => {
      const name = `Merge me ${v.locale} ${Date.now()}`;
      const id = await externalDiver(request, name);
      try {
        await page.goto('/#/divers');
        await page.getByRole('button', { name: v.english ? `Merge into…: ${name}` : `Zusammenführen mit\u00a0…: ${name}` }).click();
        await expect(page.getByRole('dialog').getByRole('searchbox')).toBeFocused();
        await expectGoodPage(page, title('Divers'), v);
      } finally {
        await request.delete(`/api/external-divers/${id}`, { headers });
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
        await page.getByRole('link', { name: v.english ? 'Show deleted dives' : 'Gelöschte Tauchgänge zeigen', exact: true }).click();
        await expect(page.getByRole('button', { name: v.english ? 'Delete in SSI: Dive 9' : 'In SSI löschen: Tauchgang 9' })).toBeVisible();
        await expectGoodPage(page, title('Review'), v);
      } finally {
        await deletableDive(request);
      }
    });

    test('a dive with another at the same time, merging them asked first, and the pair on the logbook', { tag: ['@dives'] }, async ({ page, request }) => {
      const { kept } = await mergeablePair(request);
      try {
        await page.goto(`/#/dives/${kept}`);
        const open = page.getByRole('button', { name: v.english ? 'Merge the two…' : /^Beide zusammenführen/ });
        await expect(open).toBeVisible();
        await expectGoodPage(page, title('Dive 31'), v);
        // Merging by hand: the dives nearby to choose from.
        await page.getByRole('button', { name: /^(More|Mehr)/ }).click();
        await page.getByRole('menuitem', { name: v.english ? 'Merge with another dive…' : /^Mit einem anderen Tauchgang zusammenführen/ }).click();
        const picker = page.getByRole('dialog');
        await expect(picker.getByRole('button', { name: v.english ? /^Merge with this dive…/ : /^Mit diesem zusammenführen/ })).toBeVisible();
        await expectGoodPage(page, title('Dive 31'), v);
        await picker.getByRole('button', { name: v.english ? 'Cancel' : 'Abbrechen' }).click();
        await open.click();
        await expect(page.getByRole('dialog').getByRole('button', { name: v.english ? 'Merge' : 'Zusammenführen', exact: true })).toBeVisible();
        await expectGoodPage(page, title('Dive 31'), v);
        // The same pair waits as a logbook check, with its decisions on the Review page and a line on the logbook.
        await page.goto('/');
        await page.getByRole('link', { name: v.english ? 'Review them' : 'Durchsehen' }).click();
        await expect(page.getByRole('button', { name: v.english ? /^They are two dives: / : /^Es sind zwei Tauchgänge: / })).toBeVisible();
        await expectGoodPage(page, title('Review'), v);
        await page.goto('/');
        await expect(page.getByRole('link', { name: v.english ? 'Review them' : 'Durchsehen' })).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
      } finally {
        await mergePair(request);
      }
    });

    test('an upload that waits for the choice of what to import', { tag: ['@dives'] }, async ({ page, request }) => {
      await waitingImport(request);
      try {
        await page.goto('/');
        const choice = page.getByRole('group', { name: /account-export\.zip/ });
        await expect(choice.getByRole('checkbox', { name: v.english ? 'Apnea sessions (1)' : 'Apnoe-Sessions (1)' })).toBeChecked();
        await expectGoodPage(page, title('Logbook'), v);
        // Nothing chosen: nothing to import.
        for (const box of await choice.getByRole('checkbox').all()) await box.uncheck({ force: true });
        await expect(choice.getByRole('button', { name: v.english ? 'Import' : 'Importieren', exact: true })).toBeDisabled();
        await expectGoodPage(page, title('Logbook'), v);
        await page.goto('/#/review?tab=imports');
        await expect(page.getByRole('group', { name: /account-export\.zip/ })).toBeVisible();
        await expectGoodPage(page, title('Review'), v);
      } finally {
        await cancelWaitingImports(request);
      }
    });

    test('a dive that is probably no dive, offered for deleting on the Review page', { tag: ['@dives'] }, async ({ page, request }) => {
      await falseStart(request);
      try {
        await page.goto('/#/review');
        await expect(page.getByRole('heading', { name: v.english ? 'Probably not dives' : 'Wahrscheinlich keine Tauchgänge', level: 2 })).toBeVisible();
        await expectGoodPage(page, title('Review'), v);
        await page.getByRole('button', { name: v.english ? /^Delete…: / : /^Löschen.…: / }).click();
        await expect(page.getByRole('dialog').getByRole('button', { name: v.english ? 'Cancel' : 'Abbrechen' })).toBeVisible();
        await expectGoodPage(page, title('Review'), v);
      } finally {
        await keepFalseStart(request);
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

    test('admin, AI access switched on with accesses to revoke', { tag: ['@admin'] }, async ({ page, request }) => {
      await aiAccessReady(request);
      try {
        await createAiAccess(request, 'Claude Code');
        await page.goto('/#/admin');
        await expect(page.getByRole('button', { name: v.english ? 'Revoke all AI accesses…' : 'Alle KI-Zugänge zurückziehen…' })).toBeVisible();
        await page.getByRole('button', { name: v.english ? 'Switch AI access off…' : 'KI-Zugang ausschalten…' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectGoodPage(page, title('Admin'), v);
      } finally {
        await aiAccessReady(request);
      }
    });

    test('admin, dive sites from SSI logbooks allowed', { tag: ['@admin'] }, async ({ page, request }) => {
      await request.put('/api/admin/provider-site-data/ssi', { data: { allowed: true, confirm: true }, headers });
      try {
        await page.goto('/#/admin');
        await expect(page.getByRole('button', { name: v.english ? 'Stop making sites' : 'Keine Tauchplätze mehr anlegen' })).toBeVisible();
        await expectGoodPage(page, title('Admin'), v);
      } finally {
        await request.put('/api/admin/provider-site-data/ssi', { data: { allowed: false }, headers });
      }
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
    ['an imported dive site', () => `/#/sites/${importedSiteId}`, ['@sites']],
    ['Dive centres', () => '/#/centres', ['@sites']], ['a dive centre', () => `/#/centres/${centreId}`, ['@sites']], ['account', () => '/#/account', ['@account']],
    ['Review', () => '/#/review', ['@dives']], ['admin', () => '/#/admin', ['@admin']], ['site import', () => '/#/admin/site-imports', ['@admin', '@sites']],
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
    for (const path of ['/', `/#/dives/${diveId}`, '/#/divers', '/#/sites', `/#/sites/${siteId}`, `/#/sites/${importedSiteId}`, '/#/centres', `/#/centres/${centreId}`, '/#/review', '/#/account', '/#/admin', '/#/admin/site-imports']) {
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
    await expect(diveRows(page).first()).toBeVisible();
    await page.getByRole('navigation').getByRole('link', { name: 'Divers' }).click();
    await expect(page.getByRole('heading', { name: 'Divers', level: 1 })).toBeFocused();
    await expect(page).toHaveTitle('Divers – Dive Hub');
  });

  for (const [where, url] of [['Dive sites', '/#/sites'], ['logbook', '/']] as const) {
    test(`searching the ${where} keeps the field focused and the page in place while the results update`, { tag: ['@layout', '@sites', '@dives'] }, async ({ page }) => {
      await page.goto(url);
      await expect(where === 'logbook' ? diveRows(page).first() : page.getByRole('table')).toBeVisible();
      // Marks the page as it is now: a rebuilt page would lose the mark.
      await page.locator('#main h1').evaluate((h) => { (h as HTMLElement).dataset.before = 'search'; });
      // Sorting changes the address too: the control used keeps the focus, the page stays. The logbook's rows have no
      // column headers, so it sorts by a choice.
      const sort = where === 'logbook' ? page.getByRole('button', { name: /Sort by$/ }) : page.getByRole('columnheader').getByRole('button').first();
      await sort.click();
      if (where === 'logbook') await page.getByRole('option', { name: 'Oldest first' }).click();
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
    await expect(diveRows(page).first()).toBeVisible();
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
    // No tank pod: no strip and no column for it.
    await expect(page.getByRole('img', { name: 'Tank pressure' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Tank pressure' })).toHaveCount(0);
  });

  test('a tank pod\'s pressure has its own strip, said in words and in the profile\'s table', { tag: ['@dives'] }, async ({ page, request }) => {
    await page.goto(`/#/dives/${await tankPodDive(request)}`);
    const strip = page.getByRole('img', { name: 'Tank pressure' });
    await expect(strip).toHaveAccessibleDescription('EAN32, 12 L: 200 bar at the start, 50 bar at the end, 150 bar used. Surface consumption (SAC) as the tank pod measured it: 17.5 L/min.');
    await expect(page.getByText('200 bar at the start, 50 bar at the end, 150 bar used.')).toBeVisible();
    await page.getByText('Profile as a table').click();
    const table = page.getByRole('region', { name: 'Profile as a table' });
    await expect(table.getByRole('columnheader', { name: 'Tank pressure' })).toBeVisible();
    await expect(table.getByRole('row').nth(1).getByRole('cell').last()).toHaveText('200 bar');
    await expectGoodPage(page);

    await setPreferences(request, { units: 'imperial' });
    await page.reload();
    await expect(page.getByText('2,907 psi at the start, 727 psi at the end, 2,180 psi used.')).toBeVisible();
    await setPreferences(request, { units: null });
  });

  test('the logbook comes first; files dropped anywhere on the page are imported', { tag: ['@dives'] }, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
    await expect(page.getByText('Drop Garmin or Suunto dive files or zips here')).toHaveCount(0); // the first-run panel
    await expect(page.getByRole('button', { name: 'Import files' })).toBeVisible();

    await dropFiles(page, [
      { name: 'notes.txt', bytes: [...Buffer.from('not a dive')] },
      { name: 'main-computer.fit', bytes: [...readFileSync('e2e/fixtures/main-computer.fit')] },
    ]);
    await expect(page.getByText('Skipped notes.txt')).toBeVisible();
    await expect(page.locator('[data-announcer]')).toHaveText('main-computer.fit: already imported');
    // The Imports are on the Review page, one link away from the logbook.
    await page.getByRole('link', { name: 'Imports', exact: true }).click();
    const imports = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Imports' }) });
    await expect(imports.getByText('main-computer.fit').first()).toBeVisible();
    await expect(imports.getByText('already imported').first()).toBeVisible();
  });

  test('an upload with several kinds of dive says how many of each it holds and imports the chosen ones', { tag: ['@dives'] }, async ({ page, request }) => {
    await cancelWaitingImports(request);
    try {
      await page.goto('/');
      await dropFiles(page, [{ name: 'account-export.zip', bytes: [...readFileSync('e2e/fixtures/account-export.zip')] }]);
      const choice = page.getByRole('group', { name: 'What to import from account-export.zip' });
      await expect(choice.getByRole('checkbox', { name: 'Scuba dives (1)' })).toBeChecked();
      await expect(choice.getByRole('checkbox', { name: 'Apnea sessions (1)' })).toBeChecked();
      await expect(choice.getByText('2 other files are no dives and are not kept.')).toBeVisible();
      await expect(page.locator('[data-announcer]')).toHaveText('account-export.zip: choose what to import');
      // It waits: a reload later it still asks.
      await page.reload();
      await choice.getByRole('checkbox', { name: 'Apnea sessions (1)' }).uncheck({ force: true });
      await choice.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(choice).toHaveCount(0);
      // The scuba dive is the seeded one, so it is recognised; the rest is named as left out.
      await page.getByRole('link', { name: 'Imports', exact: true }).click();
      const row = page.getByRole('listitem').filter({ hasText: 'account-export.zip' }).first();
      await expect(row.getByText('already imported')).toBeVisible();
      await expect(row.getByText('1 apnea session was left out by you. 2 other files are no dives and are not kept.')).toBeVisible();

      // Cancelling removes the upload; nothing was imported.
      await page.goto('/');
      await dropFiles(page, [{ name: 'account-export.zip', bytes: [...readFileSync('e2e/fixtures/account-export.zip')] }]);
      await choice.getByRole('button', { name: 'Cancel the import' }).click();
      await expect(choice).toHaveCount(0);
      await expect(page.locator('[data-announcer]')).toHaveText('account-export.zip: import cancelled, the upload is removed.');
    } finally {
      await cancelWaitingImports(request);
    }
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
    // Administration is for admins only and lives here, not in the bar (the test User is the admin).
    await expect(page.getByRole('menuitem', { name: 'Administration' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' })).toHaveCount(0);
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

  test('the logbook sorts by a choice and searches; the address keeps both', { tag: ['@dives'] }, async ({ page, request }) => {
    await page.goto('/');
    const list = page.getByRole('region', { name: 'Dives' });
    // Newest first: the rows stand under their months.
    await expect(list.getByRole('heading', { level: 2 }).first()).toBeVisible();
    const sort = page.getByRole('button', { name: /Sort by$/ });
    await expect(sort).toContainText('Newest first');
    await sort.click();
    await page.getByRole('option', { name: 'Deepest first' }).click();
    await expect(page).toHaveURL(/sort=maxDepth$/);
    await expect(sort).toContainText('Deepest first');
    // Months say nothing about a list sorted by depth; the deepest dive leads it.
    await expect(list.getByRole('heading')).toHaveCount(0);
    const { dives } = await (await request.get('/api/dives?sort=maxDepth&limit=1')).json() as { dives: { id: string }[] };
    await expect(diveRows(page).first().getByRole('link')).toHaveAttribute('href', `#/dives/${dives[0]!.id}?list=sort%3DmaxDepth`);
    await sort.click();
    await page.getByRole('option', { name: 'Shallowest first' }).click();
    await expect(page).toHaveURL(/sort=maxDepth&order=asc$/);
    await page.reload();
    await expect(sort).toContainText('Shallowest first');

    const search = page.getByRole('searchbox', { name: 'Search' });
    await search.fill('42');
    await expect(page).toHaveURL(/q=42/);
    await expect(diveRows(page)).toHaveCount(1); // dive 42
    await page.reload();
    await expect(search).toHaveValue('42');
    await search.fill('no such words');
    await expect(page.getByText('No dives match “no such words”.')).toBeVisible();
  });

  test('menus grow from their trigger; with reduced motion nothing moves (ADR 0018)', { tag: ['@layout'] }, async ({ page }) => {
    await page.goto('/');
    await expect(diveRows(page).first()).toBeVisible();
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

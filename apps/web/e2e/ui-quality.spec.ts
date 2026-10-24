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
  E2E_BASE_URL, E2E_SERVERS, E2E_SESSION, LENA_SSI, activeResultShown, aiAccessReady, askMcp, assessedDive, diveNumber, seededDiveId, createAiAccess, putAside, uniqueWord, clearParticipants, conflictForLena, connectSsi, deletableDive, lenaClaimable, diveRows, diveWithoutRecording, expectGoodPage, externalDiver, openLine,
  clearPushRuns, conflictAtSsi, expireSsiTokens, leaveConflict, forgetDivers, goneAtSsi, leaveLena, leaveSsi, lenaReady, mergePair, mergeablePair, pushRunSetup, readyForSsi, resetDive, sendToSsi, setBuddies, setPreferences, signInSsi, falseStart, keepFalseStart, tankPodDive
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
    /** On a phone the logbook's choices sit behind "Filter and sort" (slice 25f): open it where it is shut. */
    const openChoices = async (page: Page) => {
      if (v.viewport.width > 640) return;
      const trigger = page.getByRole('button', { name: v.english ? /Filter and sort/ : /Filtern und sortieren/ });
      await expect(trigger).toBeVisible();
      if (await trigger.getAttribute('aria-expanded') === 'false') await trigger.click();
    };

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
        await openChoices(page);
        await expect(page.getByRole('group', { name: v.english ? 'Show only' : 'Nur anzeigen' })).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
        // A filter pressed, and sorted by depth: no month headings, the day with its year.
        await page.goto('/#/?sort=maxDepth&only=no-recording');
        await openChoices(page);
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

    test('sending many dives to SSI: the dialog and a stopped run', { tag: ['@dives'] }, async ({ page, request }) => {
      await resetDive(request);
      let connectionId: string | undefined;
      try {
        // The test reef has no SSI site ID: the dialog names what is held back and links to the site.
        const setup = await pushRunSetup(request, diveId, { keepSignedIn: false, siteExternalId: null });
        connectionId = setup.connectionId;
        const { siteId } = setup;
        await page.goto(`/#/?site=${siteId}`);
        await openChoices(page);
        await page.getByRole('button', { name: v.english ? 'Send to SSI…' : 'An SSI senden…' }).click();
        await expect(page.getByRole('dialog').getByRole('link', { name: /SSI test reef/ })).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
        await page.keyboard.press('Escape');
        // The site has its SSI ID now: the dialog asks which dives, and lists the ones that go with a checkbox each (slice 25b).
        await request.put(`/api/dive-sites/${siteId}/external-ids/ssi`, { data: { externalId: '7099' }, headers });
        await page.getByRole('button', { name: v.english ? 'Send to SSI…' : 'An SSI senden…' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('radiogroup')).toBeVisible();
        await dialog.getByRole('button', { name: v.english ? 'Show the dive' : 'Den Tauchgang zeigen' }).click();
        await expect(dialog.getByRole('group', { name: v.english ? 'Dives to send' : 'Zu sendende Tauchgänge' }).getByRole('checkbox')).toHaveCount(1);
        await expectGoodPage(page, title('Logbook'), v);
        await page.keyboard.press('Escape');
        // A run that stopped for a sign-in need: the reason and the way on stay in the strip.
        await expireSsiTokens(request);
        const started = await request.post(`/api/connections/${connectionId}/push-runs`, { data: { dives: { list: { siteId } } }, headers });
        expect(started.status(), await started.text()).toBe(202);
        await page.goto('/#/');
        await page.reload();
        await expect(page.getByRole('button', { name: v.english ? 'Continue' : 'Fortsetzen' })).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
      } finally {
        await clearPushRuns(request);
        // Signed in again: the Connection would otherwise wait for a sign-in, and later tests on this server would say so.
        if (connectionId) await signInSsi(request, connectionId);
        await leaveSsi(request, diveId);
      }
    });

    test('a run going in the navigation, and earlier runs listed (slice 25d)', { tag: ['@dives'] }, async ({ page }) => {
      const now = new Date().toISOString();
      const base = {
        connectionId: '00000000-0000-4000-8000-000000000002', provider: 'ssi', diverId: '00000000-0000-4000-8000-000000000003',
        stopCode: null, updates: false, updatesRemovingVerification: false, numbers: false, cancelRequested: false, leftOut: {}, pauseMs: 0,
        createdAt: now, startedAt: now, dismissedAt: null,
      };
      const runs = [
        { ...base, id: '00000000-0000-4000-8000-000000000001', status: 'running', counts: { total: 10, waiting: 7, sent: 3, skipped: 0, failed: 0 }, finishedAt: null },
        { ...base, id: '00000000-0000-4000-8000-000000000004', status: 'done', counts: { total: 2, waiting: 0, sent: 2, skipped: 0, failed: 0 }, finishedAt: now },
      ];
      await page.route('**/api/push-runs', (route) => route.fulfill({ json: runs }));
      await page.goto('/#/');
      await expect(page.locator('.run-mark')).toBeVisible();
      await page.getByRole('button', { name: v.english ? 'Earlier runs (1)' : 'Frühere Sendungen (1)' }).click();
      await expect(page.locator('.push-run-earlier').getByRole('listitem')).toHaveCount(1);
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

    test("a dive's assessment: several findings, one shown on the profile", { tag: ['@dives'] }, async ({ page, request }) => {
      const id = await assessedDive(request);
      const n = await diveNumber(request, id);
      await page.goto(`/#/dives/${id}`);
      const lane = page.getByRole('group', { name: v.english ? 'Findings along the dive' : 'Hinweise im Verlauf des Tauchgangs' });
      // Selecting a bar opens its finding: the page is checked with one finding open and the others one row each.
      await lane.getByRole('button', { name: v.english ? /^Fast ascent/ : /^Schneller Aufstieg/ }).click();
      await expect(page.getByText(v.english ? /Not medical advice/ : /Kein medizinischer Rat/)).toBeVisible();
      await expect(page.getByRole('button', { name: v.english ? /^Put aside on this dive: Fast ascent/ : /: Schneller Aufstieg$/ }).first()).toBeVisible();
      await expectGoodPage(page, title(`Dive ${n}`), v);
      // The fixed note's full text, one step away.
      await page.getByRole('button', { name: v.english ? /^What the assessment can/ : /^Was die Auswertung sagen kann/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectGoodPage(page, title(`Dive ${n}`), v);
      await page.keyboard.press('Escape');
      // The lane stays inside the page on a phone.
      const box = await lane.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(v.viewport.width);
    });

    test("a dive's assessment: a finding put aside and a rule muted", { tag: ['@dives'] }, async ({ page, request }) => {
      const id = await assessedDive(request);
      const n = await diveNumber(request, id);
      try {
        await putAside(request, id, { dismiss: ['ppo2'], mute: ['ascent_rate'] });
        await page.goto(`/#/dives/${id}`);
        await page.getByText(v.english ? '2 findings put aside' : '2 Hinweise beiseitegelegt').click();
        await expect(page.getByRole('button', { name: v.english ? 'Show again: Fast ascent' : 'Wieder zeigen: Schneller Aufstieg' })).toBeVisible();
        await expectGoodPage(page, title(`Dive ${n}`), v);
      } finally {
        await assessedDive(request);
      }
    });

    test("a dive's assessment: nothing stands out", { tag: ['@dives'] }, async ({ page, request }) => {
      const id = await assessedDive(request);
      const n = await diveNumber(request, id);
      try {
        await putAside(request, id, { dismiss: 'all' });
        await page.goto(`/#/dives/${id}`);
        await expect(page.getByText(v.english ? 'Nothing stands out on this dive.' : 'An diesem Tauchgang fällt nichts auf.')).toBeVisible();
        await expectGoodPage(page, title(`Dive ${n}`), v);
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

    test('Tools: empty, with a bottom time and every limit, and outside the limits', { tag: ['@tools'] }, async ({ page }) => {
      await page.goto('/#/tools');
      await expectGoodPage(page, title('Tools'), v);
      // 30 m on EAN32 with a 11.1 L cylinder at 200 bar; the three limits and what was assumed.
      await page.goto('/#/tools?o2=32&depth=30&volume=11.1&pressure=200');
      await expect(page.getByTestId('bottom-time')).toBeVisible();
      await expectGoodPage(page, title('Tools'), v);
      // With the settings open (a setting in the address keeps them open).
      await page.goto('/#/tools?o2=32&depth=30&volume=11.1&pressure=200&rule=reserve&bar=60');
      await page.reload();
      await expect(page.getByRole('textbox', { name: /^(Reserve at the end|Reserve am Ende)/ })).toBeVisible();
      await expect(page.getByTestId('bottom-time')).toBeVisible();
      await expectGoodPage(page, title('Tools'), v);
      // A gas plan of two Divers with a turn rule, and one that does not fit.
      await page.goto('/#/tools/plan?water=fresh&rule=thirds&lv=20x20&dv=Tim~12~200~20~&dv=Ann~10~200~15~');
      await expect(page.getByTestId('plan-briefing')).toBeVisible();
      await expectGoodPage(page, title('Tools'), v);
      await page.goto('/#/tools/plan?water=fresh&lv=20x40&dv=Tim~12~200~20~');
      await expect(page.getByTestId('plan-briefing')).toBeVisible();
      await expectGoodPage(page, title('Tools'), v);
      // Beyond the MOD: the reason, no number.
      await page.goto('/#/tools?o2=40&depth=36&he=0');
      await expect(page.getByTestId('bottom-time')).toHaveCount(0);
      await expect(page.locator('#tools-bottom ~ .notice, .tools-answer .notice').first()).toBeVisible();
      await expectGoodPage(page, title('Tools'), v);
    });

    test('Tools: the lead calculator with no history, a rule of thumb only, and based on dives', { tag: ['@tools'] }, async ({ page }) => {
      // The answers are the server's (lead-estimate-routes.test.ts); here the page in each state, so the data stays untouched.
      const base = {
        unit: 'kg', confidence: 'low', missing: [], reserve: { bar: 50, fromDives: false }, leftOut: { noWaterType: 0 },
        weightCheck: { steps: ['eye_level_empty_bc', 'neutral_at_5m_at_reserve'], reserveBar: 50 },
      };
      const rule = {
        ...base, total: 6.5, range: { low: 5, high: 8 }, basis: { kind: 'rule_of_thumb', rule: 6, personalOffset: 1, offsetFromSuits: 2 },
        adjustments: [{ kind: 'personal_offset', amount: 1 }, { kind: 'cylinder', amount: 1.5 }, { kind: 'water', amount: -2, water: 'fresh' }],
        missing: [{ kind: 'body_weight' }, { kind: 'cylinder_material', diveIds: [], planned: true }, { kind: 'suit_thickness' }],
      };
      const dives = {
        ...base, total: 8, range: { low: 7, high: 9.5 }, confidence: 'high', reserve: { bar: 55, fromDives: true },
        basis: { kind: 'dives', personal: 7, dives: [{ diveId, startsAt: '2026-03-01T09:00:00Z', number: 12, carried: 8, needed: 9, weight: 2 }, { diveId, startsAt: '2025-03-01T09:00:00Z', number: null, carried: 7, needed: 7, weight: 1 }] },
        adjustments: [{ kind: 'cylinder', amount: 1 }, { kind: 'water', amount: 0.5, water: 'salt' }],
        missing: [{ kind: 'cylinder', diveIds: [diveId] }], leftOut: { noWaterType: 2 },
      };
      const none = { ...base, total: null, range: null, basis: null, adjustments: [], missing: [{ kind: 'body_weight' }] };
      const answer = async (body: object) => {
        await page.route('**/api/divers/*/lead-estimate*', (route) => route.fulfill({ json: body }));
      };
      const url = '/#/tools/lead?lw=salt&suit=wetsuit&mm=5&hood=0&cyl=11.1%7Ealuminium';
      await page.goto('/#/tools/lead');
      await expect(page.getByRole('heading', { level: 2, name: /^(Weight check|Gewichtscheck)$/ })).toBeVisible();
      await expectGoodPage(page, title('Tools'), v);
      await answer(none);
      await page.goto(url);
      await expect(page.getByRole('link', { name: /^(Add body weight on the Divers page|Körpergewicht auf der Taucherseite eintragen)$/ })).toBeVisible();
      await expectGoodPage(page, title('Tools'), v);
      await page.unroute('**/api/divers/*/lead-estimate*');
      await answer(rule);
      await page.reload();
      await expect(page.getByTestId('lead-total')).toBeVisible();
      await expectGoodPage(page, title('Tools'), v);
      await page.unroute('**/api/divers/*/lead-estimate*');
      await answer(dives);
      await page.reload();
      await expect(page.getByTestId('lead-total')).toBeVisible();
      await expect(page.getByRole('link', { name: /^(Dive 12|Tauchgang 12)/ })).toBeVisible();
      await expectGoodPage(page, title('Tools'), v);
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
      const n = await diveNumber(request, id);
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
        await page.goto('/#/account?tab=ai');
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
        await page.goto('/#/account?tab=ai');
        await expect(page.getByRole('region', { name: v.english ? 'What was read' : 'Was gelesen wurde' }).getByText('logbook_get_dive').first()).toBeVisible();
        await expectGoodPage(page, title('My account'), v);
      } finally {
        await aiAccessReady(request);
      }
    });

    test('my account, connected to SSI, signing in again', { tag: ['@account'] }, async ({ page, request }) => {
      await connectSsi(request);
      await page.goto('/#/account?tab=connections');
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
      await page.goto('/#/account?tab=connections');
      await page.getByRole('button', { name: v.english ? /^Show your SSI buddy list/ : /^Deine SSI-Buddyliste zeigen/ }).click();
      await expect(page.getByRole('row', { name: /Mia Stone/ })).toBeVisible();
      await expectGoodPage(page, title('My account'), v);
    });

    // Importing dives from SSI (ADR 0030), with Lena's logbook: the setting, the preview with a computer and a decision
    // (the entry on 13 August always has two dives to choose from), the outcome, and a dive without a recording.
    test('my account, importing dives from SSI: the preview, then the outcome', { tag: ['@account'] }, async ({ page, request }) => {
      await lenaReady(request);
      try {
        await page.goto('/#/account?tab=connections');
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
        await page.goto('/#/account?tab=connections');
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
        await page.goto('/#/account?tab=connections');
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
        await page.goto('/#/account?tab=connections');
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
        await page.getByRole('textbox', { name: v.english ? 'Text of the code' : 'Text des Codes' }).fill(code(`9${account}`));
        await page.getByRole('button', { name: v.english ? 'Read code' : 'Code lesen' }).click();
        await expect(page.getByRole('radiogroup')).toBeVisible();
        await expectGoodPage(page, title('Divers'), v);
        // And the code of someone already here, with nothing new in it.
        await page.getByRole('textbox', { name: v.english ? 'Text of the code' : 'Text des Codes' }).fill(code(account));
        await page.getByRole('button', { name: v.english ? 'Read code' : 'Code lesen' }).click();
        await expect(page.getByRole('button', { name: v.english ? 'Show codes' : 'Codes zeigen' })).toBeVisible();
        await expectGoodPage(page, title('Divers'), v);
      } finally {
        await forgetDivers(request, name);
      }
    });

    test('Divers, a diver’s body weight, empty and with a value', { tag: ['@divers'] }, async ({ page, request }) => {
      const name = `Gewicht Probe ${v.locale} ${Date.now()}`;
      const created = await (await request.post('/api/divers', { data: { name }, headers })).json() as { id: string };
      try {
        await page.goto('/#/divers');
        await page.getByRole('button', { name: `${v.english ? 'Body weight' : 'Körpergewicht'}: ${name}` }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectGoodPage(page, title('Divers'), v);
        await page.getByRole('dialog').getByRole('textbox', { name: v.english ? /^Weight/ : /^Gewicht/ }).fill('78');
        await page.getByRole('dialog').getByRole('button', { name: v.english ? 'Add weight' : 'Gewicht hinzufügen' }).click();
        await expect(page.getByRole('dialog').getByRole('listitem')).toHaveCount(1);
        await expectGoodPage(page, title('Divers'), v);
      } finally {
        await request.delete(`/api/divers/${created.id}`, { headers });
      }
    });

    test('Divers, a diver’s certifications, empty, typed, expired and imported', { tag: ['@divers', '@account'] }, async ({ page, request }) => {
      const name = `Karte Probe ${v.locale} ${Date.now()}`;
      const created = await (await request.post('/api/divers', { data: { name }, headers })).json() as { id: string };
      try {
        await page.goto('/#/divers');
        const row = page.getByRole('listitem').filter({ hasText: name });
        await expect(row.getByText(v.english ? 'No cards yet' : 'Noch keine Karten')).toBeVisible();
        await row.getByRole('button', { name: v.english ? /^Certifications: / : /^Zertifizierungen: / }).click();
        await expect(row.getByText(v.english ? 'No certifications yet.' : 'Noch keine Zertifizierungen.')).toBeVisible();
        await expectGoodPage(page, title('Divers'), v);
        await row.getByRole('button', { name: v.english ? 'Add certification' : 'Zertifizierung hinzufügen' }).click();
        const dialog = page.getByRole('dialog');
        await expectGoodPage(page, title('Divers'), v);
        await dialog.getByRole('textbox', { name: v.english ? /^Agency/ : /^Organisation/ }).fill('PADI');
        await dialog.getByRole('textbox', { name: v.english ? /^Course or level/ : /^Kurs oder Stufe/ }).fill('Open Water Diver');
        await dialog.getByRole('button', { name: v.english ? 'Save certification' : 'Zertifizierung speichern' }).click();
        await expect(row.getByRole('list', { name: v.english ? 'Certification cards' : 'Zertifizierungskarten' }).getByRole('listitem')).toHaveCount(1);
        await expectGoodPage(page, title('Divers'), v);
        // An expired card, in words (C21), and the line counting it.
        await request.post(`/api/divers/${created.id}/certifications`, {
          data: { agency: 'DAN', level: 'First Aid', issuedOn: '2020-01-01', expiresOn: '2021-01-01' }, headers,
        });
        await page.reload();
        await expect(row.getByText(v.english ? '1 expired' : '1 abgelaufen')).toBeVisible();
        // The address says the section is open, so it is still open after the reload.
        await expect(row.getByRole('button', { name: v.english ? /^Certifications: / : /^Zertifizierungen: / })).toHaveAttribute('aria-expanded', 'true');
        await expect(row.getByRole('listitem').filter({ hasText: 'First Aid' })).toContainText(v.english ? 'Expired' : 'Abgelaufen');
        await expectGoodPage(page, title('Divers'), v);
      } finally {
        await request.delete(`/api/divers/${created.id}`, { headers });
      }
    });

    // UI/UX pass C1: no dialog is a trap; its close button is in the title row, and the keyboard reaches it.
    test('every dialog has a close button the keyboard reaches', { tag: ['@divers'] }, async ({ page, request }) => {
      const name = `Schließen Probe ${v.locale} ${Date.now()}`;
      const created = await (await request.post('/api/divers', { data: { name }, headers })).json() as { id: string };
      try {
        await page.goto('/#/divers');
        const dialog = page.getByRole('dialog');
        const close = dialog.getByRole('button', { name: v.english ? 'Close dialog' : 'Dialog schließen' });
        const openers = [
          `Codes: ${name}`, `${v.english ? 'Body weight' : 'Körpergewicht'}: ${name}`,
        ];
        for (const opener of openers) {
          const trigger = page.getByRole('button', { name: opener });
          await trigger.click();
          await expect(close).toBeVisible();
          for (let i = 0; i < 12 && !(await close.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
          await expect(close).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(dialog).toHaveCount(0);
          await expect(trigger).toBeFocused();
        }
        // A question before something is lost (C8), and the confirmation also has a close button.
        await page.getByRole('button', { name: `${v.english ? 'Delete' : 'Löschen'}: ${name}` }).click();
        await expect(dialog.getByRole('heading', { name: v.english ? `Delete ${name}?` : `${name} löschen?` })).toBeVisible();
        await expect(close).toBeVisible();
        await expectGoodPage(page, title('Divers'), v);
      } finally {
        await request.delete(`/api/divers/${created.id}`, { headers });
      }
    });

    test('Divers, deleting a diver asks first', { tag: ['@divers'] }, async ({ page, request }) => {
      const name = `Löschen Probe ${v.locale} ${Date.now()}`;
      const created = await (await request.post('/api/divers', { data: { name }, headers })).json() as { id: string };
      try {
        await page.goto('/#/divers');
        const row = page.getByRole('listitem').filter({ hasText: name });
        const dialog = page.getByRole('dialog');
        await page.getByRole('button', { name: `${v.english ? 'Delete' : 'Löschen'}: ${name}` }).click();
        // Cancel leaves the diver where it is.
        await dialog.getByRole('button', { name: v.english ? 'Cancel' : 'Abbrechen' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(row).toHaveCount(1);
        // The main action comes before Cancel (C14).
        await page.getByRole('button', { name: `${v.english ? 'Delete' : 'Löschen'}: ${name}` }).click();
        const actions = dialog.locator('.form-actions').getByRole('button');
        await expect(actions.nth(0)).toHaveText(v.english ? 'Delete' : 'Löschen');
        await actions.nth(0).click();
        await expect(row).toHaveCount(0);
      } finally {
        await request.delete(`/api/divers/${created.id}`, { headers });
      }
    });

    test('Divers, an admin merging an external diver',{ tag: ['@divers'] }, async ({ page, request }) => {
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
        const id = await diveWithoutRecording(request);
        await page.goto(`/#/dives/${id}`);
        await expect(page.getByText(v.english ? /^No recording yet/ : /^Noch keine Aufzeichnung/)).toBeVisible();
        await expectGoodPage(page, title(`Dive ${await diveNumber(request, id)}`), v);
      } finally {
        await leaveLena(request);
      }
    });

    // Deleting a Dive (ADR 0026): the shared seeded dive only gets the dialog opened; dive 9 is deleted and comes back.
    const openDelete = async (page: Page, id: string, number: number) => {
      await page.goto(`/#/dives/${id}`);
      await page.getByRole('button', { name: v.english ? `More: Dive ${number}` : `Mehr: Tauchgang ${number}` }).click();
      await page.getByRole('menuitem', { name: v.english ? /^Delete dive/ : /^Tauchgang löschen/ }).click();
      return page.getByRole('dialog');
    };

    test('deleting a dive, asked first', { tag: ['@dives'] }, async ({ page, request }) => {
      const n = await diveNumber(request, diveId);
      const dialog = await openDelete(page, diveId, n);
      await expect(dialog.getByRole('button', { name: v.english ? 'Cancel' : 'Abbrechen' })).toBeVisible();
      await expectGoodPage(page, title(`Dive ${n}`), v);
    });

    test('deleting a dive in SSI, then the logbook with Undo and the deleted dives', { tag: ['@dives'] }, async ({ page, request }) => {
      const id = await deletableDive(request);
      await sendToSsi(request, id);
      try {
        const n = await diveNumber(request, id);
        const dialog = await openDelete(page, id, n);
        await expect(dialog.getByRole('button', { name: v.english ? 'Delete here and in SSI' : 'Hier und in SSI löschen' })).toBeVisible();
        await expectGoodPage(page, title(`Dive ${n}`), v);
        await dialog.getByRole('button', { name: v.english ? 'Delete only here' : 'Nur hier löschen' }).click();
        await expect(page.getByRole('button', { name: v.english ? 'Undo' : 'Rückgängig' })).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
        await page.reload();
        await page.getByRole('link', { name: v.english ? 'Show deleted dives' : 'Gelöschte Tauchgänge zeigen', exact: true }).click();
        await expect(page.getByRole('button', { name: v.english ? /^Delete in SSI: .*2026/ : /^In SSI löschen: .*2026/ })).toBeVisible();
        await expectGoodPage(page, title('Review'), v);
      } finally {
        await deletableDive(request);
      }
    });

    test('a dive with another at the same time, merging them asked first, and the pair on the logbook', { tag: ['@dives'] }, async ({ page, request }) => {
      const { kept } = await mergeablePair(request);
      const n = await diveNumber(request, kept);
      try {
        await page.goto(`/#/dives/${kept}`);
        const open = page.getByRole('button', { name: v.english ? 'Merge the two…' : /^Beide zusammenführen/ });
        await expect(open).toBeVisible();
        await expectGoodPage(page, title(`Dive ${n}`), v);
        // Merging by hand: the dives nearby to choose from.
        await page.getByRole('button', { name: /^(More|Mehr)/ }).click();
        await page.getByRole('menuitem', { name: v.english ? 'Merge with another dive…' : /^Mit einem anderen Tauchgang zusammenführen/ }).click();
        const picker = page.getByRole('dialog');
        await expect(picker.getByRole('button', { name: v.english ? /^Merge with this dive…/ : /^Mit diesem zusammenführen/ })).toBeVisible();
        await expectGoodPage(page, title(`Dive ${n}`), v);
        await picker.getByRole('button', { name: v.english ? 'Cancel' : 'Abbrechen' }).click();
        await open.click();
        await expect(page.getByRole('dialog').getByRole('button', { name: v.english ? 'Merge' : 'Zusammenführen', exact: true })).toBeVisible();
        await expectGoodPage(page, title(`Dive ${n}`), v);
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

    test('a dive deleted in SSI, waiting on the Review page with its two choices and on the Connection', { tag: ['@dives', '@account'] }, async ({ page, request }) => {
      const id = await deletableDive(request);
      await readyForSsi(request, id);
      const n = await diveNumber(request, id);
      try {
        await goneAtSsi(request, id);
        await page.goto('/#/review');
        await expect(page.getByRole('heading', { name: v.english ? 'Dives no longer in SSI' : 'Tauchgänge nicht mehr in SSI', level: 2 })).toBeVisible();
        await expect(page.getByRole('button', { name: v.english ? `Keep here: Dive ${n}` : `Hier behalten: Tauchgang ${n}` })).toBeVisible();
        await expectGoodPage(page, title('Review'), v);
        await page.goto('/');
        await expect(page.getByText(v.english ? /1 dive no longer in SSI/ : /1 Tauchgang nicht mehr in SSI/)).toBeVisible();
        await expectGoodPage(page, title('Logbook'), v);
        await page.goto('/#/account?tab=connections');
        await page.getByRole('button', { name: v.english ? /^Check for dives deleted in SSI/ : /^Nach in SSI gelöschten Tauchgängen suchen/ }).click();
        await expect(page.locator('#main').getByText(v.english ? /dive is no longer in your SSI logbook/ : /Tauchgang ist nicht mehr in deinem SSI-Logbuch/)).toBeVisible();
        await expectGoodPage(page, title('My account'), v);
      } finally {
        await deletableDive(request);
        await request.post('/e2e/fake-ssi/clear-dives', { data: { email: 'erika@example.com' }, headers });
      }
    });

    test('notes changed both here and in SSI, asked on the dive\'s page and waiting on the Review page after a run', { tag: ['@dives'] }, async ({ page, request }) => {
      const id = await conflictAtSsi(request);
      const n = await diveNumber(request, id);
      const conflictsTitle = v.english ? 'Changed in both places' : 'An beiden Stellen geändert';
      try {
        await page.goto(`/#/dives/${id}`);
        await openLine(page, 'SSI');
        await page.getByRole('button', { name: v.english ? 'Update in SSI' : 'In SSI aktualisieren' }).click();
        await expect(page.getByRole('region', { name: conflictsTitle }).getByRole('radiogroup')).toBeVisible();
        await expectGoodPage(page, title(`Dive ${n}`), v);

        // A run leaves the dive waiting on the Review page.
        const status = await (await request.get(`/api/dives/${id}/providers/ssi`)).json() as { connection: { id: string } };
        const run = await (await request.post(`/api/connections/${status.connection.id}/push-runs`, { data: { dives: { ids: [id] }, updates: true }, headers })).json() as { id: string };
        await expect.poll(async () => ((await (await request.get(`/api/push-runs/${run.id}`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('done');
        // Loaded afresh: the run ended at the server, unseen by the page.
        await page.goto('/#/review');
        await page.reload();
        await expect(page.getByRole('heading', { name: `${conflictsTitle} (1)`, level: 2 })).toBeVisible();
        await expect(page.getByRole('button', { name: v.english ? `Send with these choices: Dive ${n}` : `Mit dieser Wahl senden: Tauchgang ${n}` })).toBeVisible();
        await expectGoodPage(page, title('Review'), v);
      } finally {
        await clearPushRuns(request);
        await leaveConflict(request);
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
    ['Dive centres', () => '/#/centres', ['@sites']], ['Tools', () => '/#/tools?o2=32&depth=30&volume=11.1&pressure=200', ['@tools']], ['a gas plan', () => '/#/tools/plan?water=fresh&lv=20x15,12x10&dv=Tim~12~200~20~&dv=Ann~10~200~15~', ['@tools']], ['the lead calculator', () => '/#/tools/lead?lw=salt&suit=wetsuit&mm=5&hood=0&cyl=11.1%7Ealuminium', ['@tools']], ['a dive centre', () => `/#/centres/${centreId}`, ['@sites']], ['account', () => '/#/account', ['@account']], ['account connections', () => '/#/account?tab=connections', ['@account']], ['account AI access', () => '/#/account?tab=ai', ['@account']],
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
    for (const path of ['/', `/#/dives/${diveId}`, '/#/divers', '/#/sites', `/#/sites/${siteId}`, `/#/sites/${importedSiteId}`, '/#/centres', `/#/centres/${centreId}`, '/#/tools?o2=32&depth=30&volume=11.1&pressure=200', '/#/tools/lead?lw=salt&suit=wetsuit&mm=5&hood=0&cyl=11.1%7Ealuminium', '/#/review', '/#/account', '/#/account?tab=connections', '/#/account?tab=ai', '/#/admin', '/#/admin/site-imports']) {
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
    await expect(page.getByRole('group', { name: 'Start' }).getByRole('spinbutton').first()).toBeFocused();
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
    // The hash changes first and is put back once the question is dismissed: wait for it.
    await expect(page).toHaveURL(new RegExp(`/dives/${diveId}`));

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
    // The pod's Cylinder in the Dive's form: a group of fields with its own name (ADR 0045, slice 2).
    await page.getByRole('button', { name: 'Edit dive' }).click();
    await expect(page.getByRole('group', { name: /Cylinder 1/ }).getByRole('textbox', { name: 'Pressure at the start (bar)' })).toHaveValue('200');
    await expectGoodPage(page);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await setPreferences(request, { units: 'imperial' });
    await page.reload();
    await expect(page.getByText('2,907 psi at the start, 727 psi at the end, 2,180 psi used.')).toBeVisible();
    await setPreferences(request, { units: null });
  });

  test('suit, lead and how the weighting felt are facts of a dive, and fields with their units in its form', { tag: ['@dives'] }, async ({ page, request }) => {
    const id = await tankPodDive(request);
    const set = async (values: object) => {
      const { version } = (await (await request.get(`/api/dives/${id}`)).json()) as { version: number };
      expect((await request.patch(`/api/dives/${id}`, { data: { version, ...values }, headers: { origin: E2E_BASE_URL } })).status()).toBe(200);
    };
    await set({
      lead: [{ amountKg: 6, placement: 'belt' }, { amountKg: 2, placement: 'trim' }], weightingFeedback: { felt: 'too_heavy', amountKg: 1 },
      suit: { type: 'wetsuit', thicknessMm: 7, hood: true },
    });
    try {
      await page.goto(`/#/dives/${id}`);
      await expect(page.getByRole('definition').filter({ hasText: '8 kg (6 kg on a belt, 2 kg trim)' })).toBeVisible();
      await expectGoodPage(page);
      await page.getByRole('button', { name: 'Edit dive' }).click();
      await expect(page.getByRole('textbox', { name: 'Lead 1 (kg)' })).toHaveValue('6');
      await expect(page.getByRole('textbox', { name: 'Thickness (mm)' })).toHaveValue('7');
      await expect(page.getByRole('textbox', { name: 'By how much (kg)' })).toHaveValue('1');
      await expectGoodPage(page);
      await page.getByRole('button', { name: 'Cancel' }).click();
    } finally {
      await set({ lead: [], weightingFeedback: null, suit: null });
    }
  });

  test('the lead hint sits between the suit and the lead, and fills nothing in', { tag: ['@dives'] }, async ({ page, request }) => {
    const earlier = await tankPodDive(request);
    const diveId = await seededDiveId(request);
    const send = { headers: { origin: E2E_BASE_URL } };
    const set = async (id: string, values: object) => {
      const { version } = (await (await request.get(`/api/dives/${id}`)).json()) as { version: number };
      expect((await request.patch(`/api/dives/${id}`, { data: { version, ...values }, ...send })).status()).toBe(200);
    };
    const site = (await (await request.post('/api/dive-sites', { data: { name: 'Hint reef', waterType: 'salt' }, ...send })).json()) as { id: string };
    const nothing = { lead: [], weightingFeedback: null, suit: null, siteId: null };
    await set(earlier, { siteId: site.id, suit: { type: 'wetsuit', thicknessMm: 5, hood: false }, lead: [{ amountKg: 8 }], weightingFeedback: { felt: 'right' } });
    await set(diveId, { siteId: site.id, cylinders: [{ volumeL: 12, material: 'steel', gas: { o2: 21, he: 0 } }] });
    try {
      await page.goto(`/#/dives/${diveId}`);
      await page.getByRole('button', { name: 'Edit dive' }).click();
      await page.getByRole('button', { name: /Suit$/ }).click();
      await page.getByRole('option', { name: 'Wetsuit', exact: true }).click();
      await page.getByRole('textbox', { name: 'Thickness (mm)' }).fill('5');
      await page.getByRole('button', { name: /Hood$/ }).click();
      await page.getByRole('option', { name: 'Without hood', exact: true }).click();
      await expect(page.getByTestId('lead-hint')).toContainText('Last time with this suit: 8 kg, felt right.');
      await expectGoodPage(page);
      await page.getByRole('button', { name: 'Cancel' }).click();
    } finally {
      await set(earlier, nothing);
      await set(diveId, { ...nothing, cylinders: [] });
      await request.delete(`/api/dive-sites/${site.id}`, send);
    }
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
      // The page takes drops once it is up: without waiting, a fast machine drops before it listens.
      await expect(page.getByRole('button', { name: 'Import files' })).toBeVisible();
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
      await expect(page.getByRole('button', { name: 'Import files' })).toBeVisible();
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

  test('adding a Diver and adding someone you dived with say the difference (slice 25e, C22)', { tag: ['@divers'] }, async ({ page }) => {
    await page.goto('/#/divers');
    const logbooks = page.locator('section', { has: page.getByRole('heading', { name: 'Logbooks you keep' }) });
    const field = logbooks.getByRole('textbox', { name: 'Add a Diver' });
    await expect(field).toHaveAccessibleDescription(/logbook/i);
    await expect(logbooks.getByRole('button', { name: 'Add logbook' })).toBeVisible();
    await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Other divers' }) }).getByRole('button', { name: 'Add buddy' })).toBeVisible();
  });

  test('the account page has its parts as tabs in the address, and the profile menu links the connections (slice 25e, C10)', { tag: ['@account'] }, async ({ page }) => {
    await page.goto('/#/account');
    const parts = page.getByRole('navigation', { name: 'Parts of the account' });
    await expect(parts.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Where you’re signed in' })).toBeVisible();
    // Connections and AI access are not on the first part: the page is not one long scroll.
    await expect(page.getByRole('heading', { name: 'AI access' })).toHaveCount(0);

    await parts.getByRole('link', { name: 'Connections' }).click();
    await expect(page).toHaveURL(/#\/account\?tab=connections$/);
    await expect(parts.getByRole('link', { name: 'Connections' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Where you’re signed in' })).toHaveCount(0);
    await page.reload();
    await expect(parts.getByRole('link', { name: 'Connections' })).toHaveAttribute('aria-current', 'page');

    await parts.getByRole('link', { name: 'AI access' }).click();
    await expect(page).toHaveURL(/#\/account\?tab=ai$/);
    await expect(page.getByRole('heading', { name: 'AI access' }).first()).toBeVisible();

    // The profile menu goes straight to the connections.
    await page.goto('/');
    await page.getByRole('button', { name: /, account$/ }).click();
    await page.getByRole('menuitem', { name: 'Connections' }).click();
    await expect(page).toHaveURL(/#\/account\?tab=connections$/);
    await expect(page.getByRole('heading', { name: 'My account', level: 1 })).toBeVisible();
  });

  test('Imports and Deleted dives are linked from the logbook, even with nothing waiting (slice 25e, C9)', { tag: ['@dives'] }, async ({ page }) => {
    await page.goto('/');
    await expect(diveRows(page).first()).toBeVisible();
    const more = page.getByRole('main').getByRole('navigation', { name: 'Review' });
    await expect(more.getByRole('link', { name: 'Imports' })).toHaveAttribute('href', '#/review?tab=imports');
    await expect(more.getByRole('link', { name: 'Deleted dives' })).toHaveAttribute('href', '#/review?tab=deleted');
    // Above the list, not below it: they are found without scrolling past the Dives.
    const link = await more.boundingBox();
    const list = await diveRows(page).first().boundingBox();
    expect(link!.y).toBeLessThan(list!.y);
    await more.getByRole('link', { name: 'Deleted dives' }).click();
    await expect(page.getByRole('heading', { name: 'Deleted dives', level: 2 })).toBeVisible();
  });

  test('the way back sits above the title on every page that has one (slice 25e, C15)', { tag: ['@dives', '@sites'] }, async ({ page }) => {
    for (const [url, back] of [
      [`/#/dives/${diveId}`, 'Logbook'], [`/#/sites/${siteId}`, 'Dive sites'], [`/#/centres/${centreId}`, 'Dive centres'], ['/#/review', 'Logbook'],
    ] as const) {
      await page.goto(url);
      const link = page.getByRole('main').getByRole('link', { name: back, exact: true }).first();
      const title = page.getByRole('main').getByRole('heading', { level: 1 });
      await expect(title).toBeVisible();
      const [l, h] = [await link.boundingBox(), await title.boundingBox()];
      expect(l!.y + l!.height, url).toBeLessThanOrEqual(h!.y + 1);
      expect(l!.x, url).toBeLessThanOrEqual(h!.x + 1);
    }
  });

  // Slice 25f (C11, C12): on a phone the first Dive is on the first screen, and Save stays in view while a Dive is edited.
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    test(`on a ${size.width} px phone the first Dive is on the first screen (slice 25f, C11)`, { tag: ['@dives', '@layout'] }, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');
      const first = diveRows(page).first();
      await expect(first).toBeVisible();
      const bar = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
      const row = (await first.boundingBox())!;
      // The title line of the first Dive sits above the navigation bar, without scrolling.
      expect(row.y + 48, 'the first Dive starts above the bar').toBeLessThanOrEqual(bar.y);
      // Search stays where it is; the rest of the choices are behind one control that says what is active.
      await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
      const filter = page.getByRole('button', { name: /Filter and sort/ });
      await expect(filter).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('button', { name: /Sort by$/ })).toBeHidden();
      await filter.click();
      await expect(page.getByRole('button', { name: /Sort by$/ })).toBeVisible();
      // The control stays reachable by keyboard and the page doesn't scroll sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });

    test(`on a ${size.width} px phone Save is in view while a Dive is edited (slice 25f, C12)`, { tag: ['@dives', '@layout'] }, async ({ page, request }) => {
      await resetDive(request);
      await page.setViewportSize(size);
      await page.goto(`/#/dives/${diveId}`);
      await page.getByRole('button', { name: 'Edit dive' }).click();
      const save = page.getByRole('button', { name: 'Save' });
      await expect(save).toBeVisible();
      // The first field has focus (the keyboard would be open): the bar has stepped aside, Save is on the screen.
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
      await expect(save).toBeInViewport({ ratio: 1 });
      // Focus on a button: the bar is back, and Save is above it, not under it.
      await save.focus();
      const bar = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
      const box = (await save.boundingBox())!;
      expect(box.y, 'Save is on the screen').toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, 'Save is above the bar, not under it').toBeLessThanOrEqual(bar.y + 1);
      expect((await page.getByRole('button', { name: 'Cancel' }).boundingBox())!.y).toBeLessThan(bar.y);
    });
  }

  // Slice 25g (C16–C19): required fields marked, what "Same as last dive" copies, rows aligned, no "0 dives".
  test('required fields carry a mark and the form says what it means (slice 25g, C16)', { tag: ['@sites', '@layout'] }, async ({ page }) => {
    await page.goto(`/#/sites/${siteId}`);
    await page.getByRole('button', { name: 'Edit dive site' }).click();
    const form = page.getByRole('main').locator('form');
    await expect(form.getByText('* required', { exact: true })).toBeVisible();
    // Only the name is required on a dive site: one mark, on its label.
    await expect(form.getByText('*', { exact: true })).toHaveCount(1);
    await expect(form.locator('label', { hasText: 'Name' }).first()).toContainText('*');
    // The mark is not part of the field's name.
    await expect(form.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  });

  test('"Same as last dive" says what it copies (slice 25g, C17)', { tag: ['@dives'] }, async ({ page, request }) => {
    await resetDive(request);
    await page.goto(`/#/dives/${diveId}`);
    await page.getByRole('button', { name: 'Edit dive' }).click();
    const button = page.getByRole('button', { name: 'Same as last dive' });
    await expect(button).toBeVisible();
    await expect(page.getByText(/cylinders, suit and lead/i)).toBeVisible();
    await expect(button).toHaveAccessibleDescription(/cylinders, suit and lead/i);
  });

  test('on the site form Water type and Maximum depth start on one line (slice 25g, C18)', { tag: ['@sites', '@layout'] }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/#/sites/${siteId}`);
    await page.getByRole('button', { name: 'Edit dive site' }).click();
    const water = (await page.getByRole('button', { name: /Water type/ }).boundingBox())!;
    const depth = (await page.getByRole('textbox', { name: /^Maximum depth/ }).boundingBox())!;
    expect(Math.abs(water.y - depth.y), 'the two inputs start on one line').toBeLessThanOrEqual(1);
  });

  test('the sites list shows a number of dives only above zero (slice 25g, C19)', { tag: ['@sites'] }, async ({ page }) => {
    await page.goto('/#/sites');
    await expect(page.getByRole('main').getByRole('link').filter({ hasText: /\S/ }).first()).toBeVisible();
    await expect(page.getByRole('main').getByText(/^0 dives$/)).toHaveCount(0);
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
    const seededNumber = String(await diveNumber(request, await seededDiveId(request)));
    await search.fill(seededNumber);
    await expect(page).toHaveURL(new RegExp(`q=${seededNumber}`));
    await expect(diveRows(page)).toHaveCount(1); // the seeded dive
    await page.reload();
    await expect(search).toHaveValue(seededNumber);
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

// UI/UX review material (docs/research/2026-10-03-ui-review.md): screenshots, axe-core results,
// accessibility trees and Tab orders of every page and state. Not a test; run it on purpose:
//   pnpm --filter @dive-hub/web review:capture        (output: apps/web/review-output/, git-ignored)
//   REVIEW_AREAS=sites,admin pnpm --filter @dive-hub/web review:capture   only those areas (ADR 0023):
//   dives, divers, account, admin, sites
// It changes the seeded data (adds a Duplicate candidate, a Diver, invitations), so run it alone.
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  cancelWaitingImports, waitingImport,
  E2E_BASE_URL, aiAccessReady, askMcp, assessedDive, diveNumber, clearParticipants, createAiAccess, connectSsi, deletableDive, disconnectSsi, diveWithoutRecording, editElsewhere, externalDiver, falseStart, forgetDivers, keepFalseStart, mergePair, mergeablePair, tankPodDive,
  clearPushRuns, clearQueue, conflictAtSsi, fetchState, queueEntry, ssiConnectionOf, expireSsiTokens, leaveConflict, goneAtSsi, leaveLena, leaveSsi, lenaReady, openLine, pushRunSetup, readyForSsi, sendToSsi, setBuddies, setPreferences,
} from './support.ts';

const out = process.env.REVIEW_OUT ?? 'review-output/';
mkdirSync(out, { recursive: true });
const headers = { origin: E2E_BASE_URL };
const findings: Record<string, unknown> = {};
// Motion runs on the duration tokens, which drop to 0 here: every capture shows the end state without waiting.
test.use({ reducedMotion: 'reduce' });

const areas = process.env.REVIEW_AREAS?.split(',').map((a) => a.trim()).filter(Boolean);
const want = (area: string) => !areas?.length || areas.includes(area);
/** Which area a capture belongs to, by its name. */
const areaOf = (name: string) => (/site|centre/.test(name) ? 'sites' : /divers/.test(name) ? 'divers'
  : /account|signin|invitation/.test(name) ? 'account' : /admin/.test(name) ? 'admin' : /tools/.test(name) ? 'tools' : 'dives');

/** Counts the page's requests until their bodies are read, so a capture can wait until the data is on screen. */
async function trackRequests(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { inflight: number }; w.inflight = 0;
    const original = window.fetch;
    window.fetch = (...args) => {
      w.inflight++;
      const done = () => { w.inflight--; };
      return original(...args).then((r) => { r.clone().arrayBuffer().then(done, done); return r; }, (e) => { done(); throw e; });
    };
  });
}

async function capture(page: Page, name: string, opts: { full?: boolean; axe?: boolean; aria?: boolean } = {}) {
  if (!want(areaOf(name))) return;
  // Wait for no requests in flight, then two frames for React to render what came back.
  await page.waitForFunction(() => (window as unknown as { inflight: number }).inflight === 0);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: `${out}${name}.png`, fullPage: opts.full ?? true });
  if (opts.aria !== false) writeFileSync(`${out}${name}.aria.yml`, await page.locator('body').ariaSnapshot());
  if (opts.axe !== false) {
    const r = await new AxeBuilder({ page })
    // React Aria's live announcer briefly keeps a role=img pointing at a pending button that may be gone.
    .exclude('[data-live-announcer]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    findings[name] = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) }));
  }
}

async function tabOrder(page: Page, name: string, steps = 25) {
  const order: string[] = [];
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '(none)';
      const label = el.getAttribute('aria-label') ?? el.innerText?.trim().slice(0, 40) ?? '';
      return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} "${label}" outline=${getComputedStyle(el).outlineStyle}`;
    }));
  }
  findings[`${name}-tab-order`] = order;
}

test('review material', async ({ page, request, browser }) => {
  test.setTimeout(480_000);
  await trackRequests(page);
  await setPreferences(request, { language: null, units: null });
  const upload = await request.post('/api/imports', {
    headers, multipart: { file: { name: 'odd-computer.fit', mimeType: 'application/octet-stream', buffer: readFileSync('e2e/fixtures/odd-computer.fit') } },
  });
  await expect.poll(async () => (await (await request.get(`/api/imports/${(await upload.json()).id}`)).json()).status).toBe('done');
  await request.post('/api/divers', { headers, data: { name: 'Mia' } });
  const invite = await (await request.post('/api/invitations', { headers, data: { email: 'new@example.com' } })).json();
  const { dives } = await (await request.get('/api/dives')).json() as { dives: { id: string; number: number }[] };
  const dive42 = dives.find((d) => d.number === 42)!.id;

  // Pages of areas left out of REVIEW_AREAS aren't visited at all; capture() only skips the files.
  await page.setViewportSize({ width: 1280, height: 900 });
  if (want('dives')) {
    await page.goto('/'); await page.getByRole('heading', { name: 'Logbook' }).waitFor();
    await capture(page, '01-logbook');
    await tabOrder(page, '01-logbook');
    // The odd computer's recording waits: the logbook says it in one line, the Review page decides.
    await page.getByRole('link', { name: 'Review them' }).click(); await page.getByRole('heading', { name: 'Review', level: 1 }).waitFor();
    await capture(page, '01a-review');
    await tabOrder(page, '01a-review');
    // An upload with several kinds of dive (ADR 0044): one answered with the scuba dives only, one still waiting.
    const answered = await waitingImport(request);
    await request.post(`/api/imports/${answered}/start`, { data: { kinds: ['scuba'] }, headers: { origin: E2E_BASE_URL } });
    await expect.poll(async () => (await (await request.get(`/api/imports/${answered}`)).json()).status).toBe('done');
    await waitingImport(request);
    await page.goto('/'); await page.getByRole('group', { name: /account-export\.zip/ }).waitFor();
    await capture(page, '01c-logbook-import-choice');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, '01c-logbook-import-choice-phone');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('link', { name: 'Imports', exact: true }).click(); await page.getByRole('heading', { name: 'Imports', level: 2 }).waitFor();
    await capture(page, '01b-review-imports');
    await cancelWaitingImports(request);
    await page.goto(`/#/dives/${dive42}`); await page.getByRole('heading', { name: /Dive \d+/ }).waitFor();
    await capture(page, '02-dive');
    await tabOrder(page, '02-dive', 30);
    await page.getByRole('button', { name: 'Edit dive' }).click();
    await capture(page, '03-dive-edit');
    // The dive assessment (ADR 0036): a dive with several findings, one of them shown on the profile.
    const assessed = await assessedDive(request);
    await page.goto(`/#/dives/${assessed}`); await page.getByRole('heading', { name: 'Assessment' }).waitFor();
    await page.getByRole('group', { name: 'Findings along the dive' }).getByRole('button', { name: /^Fast ascent/ }).click();
    await capture(page, '03b-dive-assessment');
    await page.getByRole('button', { name: /^What the assessment can/ }).click(); await page.getByRole('dialog').waitFor();
    await capture(page, '03c-dive-assessment-about', { full: false });
    await page.keyboard.press('Escape');
    await page.goto(`/#/?q=${await diveNumber(request, assessed)}`); await page.getByText('2 findings').waitFor();
    await capture(page, '03c-logbook-finding-mark', { aria: false });
    // The logbook's rows (ADR 0040): buddies as circles (more than fit), then a "Show only" filter pressed.
    await setBuddies(request, dive42, [
      await externalDiver(request, 'Kai Lund'), await externalDiver(request, 'Ulla Berg'), await externalDiver(request, 'Lena Meier'), await externalDiver(request, 'Tom Keller'),
    ]);
    await page.goto('/'); await page.getByText('with Kai Lund').waitFor({ state: 'attached' });
    await capture(page, '03d-logbook-rows-buddies');
    await page.setViewportSize({ width: 320, height: 640 });
    await capture(page, '03e-logbook-rows-buddies-320', { aria: false, axe: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('group', { name: 'Show only' }).getByRole('button').first().click();
    await page.getByRole('group', { name: 'Show only' }).getByRole('button', { pressed: true }).waitFor();
    await capture(page, '03f-logbook-show-only');
    await page.goto('/#/?sort=maxDepth&q=nothing+like+this&only=no-site,with-findings'); await page.getByRole('button', { name: 'Show all dives' }).waitFor();
    await capture(page, '03g-logbook-show-only-nothing', { aria: false });
    await clearParticipants(request, dive42);
    for (const name of ['Lena Meier', 'Tom Keller']) await forgetDivers(request, name);
    // A tank pod's pressure under the profile (ADR 0045). Last, so the logbook above doesn't gain this dive.
    await page.goto(`/#/dives/${await tankPodDive(request)}`); await page.getByRole('img', { name: 'Tank pressure' }).waitFor();
    await capture(page, '03h-dive-tank-pressure');
    // Its Cylinder, made from the pod's data, in the Dive's form (ADR 0045, slice 2).
    await page.getByRole('button', { name: 'Edit dive' }).click(); await page.getByRole('group', { name: /Cylinder 1/ }).waitFor();
    await capture(page, '03i-dive-cylinders-form');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, '03h-dive-tank-pressure-phone', { aria: false });
    await page.getByRole('button', { name: 'Edit dive' }).click(); await page.getByRole('group', { name: /Cylinder 1/ }).waitFor();
    await capture(page, '03i-dive-cylinders-form-phone', { aria: false });
    await page.getByRole('button', { name: 'Cancel' }).click();
    // Suit, lead and how the weighting felt (ADR 0031): as facts and in the Dive's form, phone first, then desktop.
    {
      const id = await tankPodDive(request);
      const { version } = (await (await request.get(`/api/dives/${id}`)).json()) as { version: number };
      await request.patch(`/api/dives/${id}`, {
        data: {
          version, lead: [{ amountKg: 6, placement: 'belt' }, { amountKg: 2, placement: 'trim' }], weightingFeedback: { felt: 'too_heavy', amountKg: 1 },
          suit: { type: 'wetsuit', thicknessMm: 7, hood: true },
        },
        headers,
      });
      await page.reload(); await page.getByRole('definition').filter({ hasText: '8 kg (6 kg on a belt, 2 kg trim)' }).waitFor();
      await capture(page, '03j-dive-suit-and-lead-phone', { aria: false });
      await page.getByRole('button', { name: 'Edit dive' }).click(); await page.getByRole('textbox', { name: 'Lead 1' }).scrollIntoViewIfNeeded();
      await capture(page, '03k-dive-suit-and-lead-form-phone', { aria: false });
      await page.getByRole('button', { name: 'Cancel' }).click();
      // The hint (slice 20d) asks with the site's water type: a site, and the estimate as the server gives it.
      const hintSite = (await (await request.post('/api/dive-sites', { data: { name: 'Hint reef', waterType: 'salt' }, headers })).json()) as { id: string };
      {
        const v = ((await (await request.get(`/api/dives/${id}`)).json()) as { version: number }).version;
        await request.patch(`/api/dives/${id}`, { data: { version: v, siteId: hintSite.id }, headers });
      }
      await page.route('**/api/divers/*/lead-estimate*', (route) => route.fulfill({ json: {
        confidence: 'high', total: 8, range: { low: 7, high: 9 }, reserve: { bar: 50, fromDives: false }, adjustments: [], missing: [], leftOut: { noWaterType: 0 },
        weightCheck: { reserveBar: 50, steps: ['eye_level_empty_bc', 'neutral_at_5m_at_reserve'] },
        basis: { kind: 'dives', personal: 8, dives: [{ diveId: '00000000-0000-4000-8000-000000000001', startsAt: '2026-03-01T09:00:00Z', number: 12, carried: 8, needed: 8, weight: 2 }] },
      } }));
      await page.reload(); await page.getByRole('button', { name: 'Edit dive' }).click(); await page.getByRole('textbox', { name: 'Lead 1' }).scrollIntoViewIfNeeded();
      await page.getByTestId('lead-hint').waitFor();
      await capture(page, '03l-dive-lead-hint-form-phone', { aria: false });
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.setViewportSize({ width: 1280, height: 900 });
      await capture(page, '03j-dive-suit-and-lead');
      await page.getByRole('button', { name: 'Edit dive' }).click(); await page.getByRole('textbox', { name: 'Lead 1' }).scrollIntoViewIfNeeded();
      await capture(page, '03k-dive-suit-and-lead-form');
      await page.getByTestId('lead-hint').waitFor();
      await capture(page, '03l-dive-lead-hint-form', { aria: false });
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.unroute('**/api/divers/*/lead-estimate*');
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  if (want('divers')) {
    // A dive professional taken from a code (ADR 0043); person, account, e-mail and leader number are made up.
    await request.post('/api/divers/from-code', { headers, data: { text: 'buddy;4600002;firstName:Pia;lastName:Probe;email:pia@example.com;leaderNr:70001', create: true } });
    await page.goto('/#/divers'); await page.getByRole('heading', { name: 'Devices' }).waitFor(); await page.locator('table').waitFor();
    await capture(page, '04-divers');
    await page.getByRole('button', { name: 'Codes: Pia Probe' }).click();
    await page.getByRole('dialog').getByRole('img').nth(1).waitFor();
    await capture(page, '04a-divers-codes', { full: false, aria: false });
    // A Diver's body weight (ADR 0031): the dialog with one value, removed again.
    await page.keyboard.press('Escape');
    const [ownDiver] = (await (await request.get('/api/divers')).json()) as { id: string; name: string }[];
    await request.put(`/api/divers/${ownDiver!.id}/body-weights/2026-03-01`, { headers, data: { kg: 82 } });
    await page.getByRole('button', { name: `Body weight: ${ownDiver!.name}` }).click();
    await page.getByRole('dialog').getByText('82 kg').waitFor();
    await capture(page, '04e-divers-body-weight', { full: false, aria: false });
    await page.keyboard.press('Escape');
    await request.delete(`/api/divers/${ownDiver!.id}/body-weights/2026-03-01`, { headers });
    // A Diver's certification cards (ADR 0050): one typed, one imported from SSI's fake account with its picture.
    const typed = await (await request.post(`/api/divers/${ownDiver!.id}/certifications`, {
      headers, data: { agency: 'PADI', level: 'Rescue Diver', issuedOn: '2022-05-01', notes: 'Seen at the dive base', cardSeen: true },
    })).json() as { id: string };
    await request.post('/api/connections/ssi', { headers, data: { diverId: ownDiver!.id, login: 'erika@example.com', password: 'ssi-password', keepSignedIn: true } });
    const connection = ((await (await request.get('/api/connections')).json()) as { id: string; provider: string; diverId: string }[])
      .find((c) => c.provider === 'ssi' && c.diverId === ownDiver!.id);
    if (connection) await request.post(`/api/connections/${connection.id}/certifications/import`, { headers });
    // One expired and one expiring soon (slice 25c): the Diver's line counts them, the tiles say so in words.
    const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await request.post(`/api/divers/${ownDiver!.id}/certifications`, { headers, data: { agency: 'ERC', level: 'Emergency First Response', issuedOn: '2023-02-01', expiresOn: inDays(-20) } });
    await request.post(`/api/divers/${ownDiver!.id}/certifications`, { headers, data: { agency: 'DAN', level: 'Oxygen Provider', issuedOn: '2024-02-01', expiresOn: inDays(40) } });
    await page.reload();
    await page.getByRole('button', { name: `Certifications: ${ownDiver!.name}` }).waitFor();
    await capture(page, '04f-divers-certifications-closed', { full: false, aria: false });
    await page.getByRole('button', { name: `Certifications: ${ownDiver!.name}` }).click();
    await page.getByRole('button', { name: /^Show picture large/ }).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    await capture(page, '04f-divers-certifications', { aria: false });
    await page.getByRole('button', { name: /^Show picture large/ }).first().click().catch(() => undefined);
    await capture(page, '04g-divers-certification-picture', { full: false, aria: false });
    await page.keyboard.press('Escape');
    const cards = (await (await request.get(`/api/divers/${ownDiver!.id}/certifications`)).json()) as { id: string }[];
    for (const c of cards) await request.delete(`/api/divers/${ownDiver!.id}/certifications/${c.id}`, { headers });
    void typed;
    await page.getByRole('button', { name: 'Codes: Pia Probe' }).click();
    await page.getByRole('button', { name: 'Edit details' }).click();
    await capture(page, '04b-divers-codes-edit', { full: false, aria: false });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add from a code' }).click();
    await page.getByRole('textbox', { name: 'Text of the code' }).fill('buddy;4600003;firstName:Jonas;lastName:Muster;email:jonas@example.com');
    await page.getByRole('button', { name: 'Read code' }).click();
    await page.getByRole('radiogroup').waitFor();
    await capture(page, '04c-divers-code-unknown', { full: false, aria: false });
    await page.getByRole('textbox', { name: 'Text of the code' }).fill('buddy;4600002;firstName:Pia;lastName:Probst;email:pia@example.com');
    await page.getByRole('button', { name: 'Read code' }).click();
    await page.getByRole('button', { name: 'Take over' }).waitFor();
    await capture(page, '04d-divers-code-changes', { full: false, aria: false });
    await page.keyboard.press('Escape');
  }
  if (want('account')) {
    // AI access (ADR 0035): one access that read something, then a new one with its key on screen.
    await aiAccessReady(request);
    const access = await createAiAccess(request, 'Claude Code on my laptop', true);
    await askMcp(request, access.key, 'logbook_search_dives', { query: 'wreck', country: 'EG', limit: 5 });
    await askMcp(request, access.key, 'logbook_get_dive', { dive_id: '00000000-0000-7000-8000-000000000000' });
    await askMcp(request, access.key, 'logbook_stats', { group_by: 'year' });
    await page.goto('/#/account'); await page.getByRole('heading', { name: 'My account' }).waitFor(); await page.locator('table').first().waitFor();
    await capture(page, '05-account');
    await page.goto('/#/account?tab=connections'); await page.getByRole('heading', { name: 'SSI', exact: true }).waitFor();
    await capture(page, '05c-account-connections');
    await page.goto('/#/account?tab=ai'); await page.getByRole('region', { name: 'What was read' }).waitFor();
    await capture(page, '05d-account-ai-access');
    await page.getByRole('textbox', { name: 'Name' }).fill('VS Code at the dive centre');
    await page.getByRole('button', { name: 'Create AI access' }).click();
    await page.getByRole('button', { name: 'Copy: Key' }).waitFor();
    await capture(page, '05b-account-ai-access-key');
    await page.getByRole('button', { name: 'Done, I copied the key' }).click();
  }
  if (want('admin')) {
    await page.goto('/#/admin'); await page.getByRole('heading', { name: 'Users' }).waitFor();
    await page.getByRole('textbox', { name: 'E-mail' }).fill('second@example.com');
    await page.getByRole('button', { name: 'Create invitation link' }).click();
    await page.getByRole('button', { name: 'Copy' }).waitFor(); // the notice's text is also in the live region
    await capture(page, '06-admin');
    await tabOrder(page, '06-admin', 30);
  }

  if (want('dives')) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/'); await page.getByRole('heading', { name: 'Logbook' }).waitFor();
    await capture(page, '07-logbook-dark', { aria: false });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  if (want('dives') || want('divers') || want('admin') || want('account')) {
    await setPreferences(request, { language: 'de' });
    await page.setViewportSize({ width: 390, height: 844 });
    // A new language needs a full load; moving by hash afterwards keeps it.
    await page.goto('/'); await page.getByRole('heading', { name: 'Logbuch' }).waitFor();
    if (want('dives')) {
      await capture(page, '08-logbook-de-phone', { aria: false });
      await setBuddies(request, dive42, [await externalDiver(request, 'Kai Lund'), await externalDiver(request, 'Ulla Berg'), await externalDiver(request, 'Lena Meier')]);
      await page.goto('/#/?only=no-site'); await page.getByText('mit Kai Lund').waitFor({ state: 'attached' });
      await capture(page, '08b-logbook-de-phone-buddies-show-only', { aria: false });
      await clearParticipants(request, dive42);
      await forgetDivers(request, 'Lena Meier');
      await page.goto(`/#/dives/${dive42}`); await page.getByRole('heading', { name: /Tauchgang \d+/ }).waitFor();
      await capture(page, '09-dive-de-phone', { aria: false });
      await page.goto(`/#/dives/${await assessedDive(request)}`); await page.getByRole('heading', { name: 'Auswertung' }).waitFor();
      await capture(page, '09b-dive-assessment-de-phone', { aria: false });
    }
    if (want('divers')) {
      await page.goto('/#/divers'); await page.getByRole('heading', { name: 'Geräte' }).waitFor();
      await capture(page, '10-divers-de-phone', { aria: false });
      // A Diver's certification cards at phone width, in German: a typed and an imported one (ADR 0050), and the form.
      const [diver] = (await (await request.get('/api/divers')).json()) as { id: string; name: string }[];
      await request.post(`/api/divers/${diver!.id}/certifications`, {
        headers, data: { agency: 'PADI', level: 'Advanced Open Water Diver', issuedOn: '2022-05-01', centreName: 'Tauchbasis am See', notes: 'Karte beim Tauchladen gesehen', cardSeen: true },
      });
      const connections = (await (await request.get('/api/connections')).json()) as { id: string; provider: string; diverId: string }[];
      const ssi = connections.find((c) => c.provider === 'ssi' && c.diverId === diver!.id);
      if (ssi) await request.post(`/api/connections/${ssi.id}/certifications/import`, { headers });
      await request.post(`/api/divers/${diver!.id}/certifications`, {
        headers, data: { agency: 'ERC', level: 'Emergency First Response', issuedOn: '2023-02-01', expiresOn: new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10) },
      });
      await page.reload();
      await page.getByRole('button', { name: `Zertifizierungen: ${diver!.name}` }).click();
      await page.getByRole('button', { name: /^Bild groß anzeigen/ }).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
      await capture(page, '10c-divers-certifications-de-phone', { aria: false });
      await page.getByRole('button', { name: 'Zertifizierung hinzufügen' }).click();
      await page.getByRole('button', { name: 'Weitere Angaben' }).click();
      await capture(page, '10d-divers-certification-form-de-phone', { full: false, aria: false });
      await page.keyboard.press('Escape');
      for (const c of (await (await request.get(`/api/divers/${diver!.id}/certifications`)).json()) as { id: string }[]) {
        await request.delete(`/api/divers/${diver!.id}/certifications/${c.id}`, { headers });
      }
      await page.getByRole('button', { name: 'Codes: Pia Probe' }).click();
      await page.getByRole('dialog').getByRole('img').nth(1).waitFor();
      await capture(page, '10a-divers-codes-de-phone', { aria: false });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Aus Code hinzufügen' }).click();
      await page.getByRole('textbox', { name: 'Text des Codes' }).fill('buddy;4600003;firstName:Jonas;lastName:Muster;email:jonas@example.com');
      await page.getByRole('button', { name: 'Code lesen' }).click();
      await page.getByRole('radiogroup').waitFor();
      await capture(page, '10b-divers-code-unknown-de-phone', { aria: false });
      await page.keyboard.press('Escape');
    }
    if (want('admin')) {
      await page.goto('/#/admin'); await page.getByRole('heading', { name: 'Benutzer' }).waitFor();
      await capture(page, '11-admin-de-phone', { aria: false });
    }
    if (want('account')) {
      await page.goto('/#/account?tab=ai'); await page.getByRole('region', { name: 'Was gelesen wurde' }).waitFor();
      await capture(page, '11b-account-de-phone', { aria: false });
    }
    await setPreferences(request, { language: null });
  }

  // Dive sites (ADR 0020): a dive with a position, a site near it, and the pages in both themes,
  // both languages, at desktop, phone (390 px) and the narrowest phone (320 px).
  const sited = await request.post('/api/imports', {
    headers, multipart: { file: { name: 'sited-computer.fit', mimeType: 'application/octet-stream', buffer: readFileSync('e2e/fixtures/sited-computer.fit') } },
  });
  await expect.poll(async () => (await (await request.get(`/api/imports/${(await sited.json()).id}`)).json()).status).toBe('done');
  const sitedDive = (await (await request.get(`/api/imports/${(await sited.json()).id}`)).json()).outcome[0].diveId as string;
  const site = await (await request.post('/api/dive-sites', {
    headers,
    data: {
      name: 'Lighthouse', position: { latitude: 28.5007, longitude: 34.5199 }, country: 'EG', waterBody: 'Red Sea', waterType: 'salt',
      description: 'Shore entry by the café. Sandy slope to 12 m, then the wall; mind the boats at the point.',
    },
  })).json() as { id: string };
  // A duplicate 25 m from Lighthouse, for the "Close by" list and the merge dialog (ADR 0022).
  await request.post('/api/dive-sites', { headers, data: { name: 'Lighthouse Point', position: { latitude: 28.5009, longitude: 34.5199 }, maxDepthM: 24 } });
  await request.post('/api/dive-sites', { headers, data: { name: 'Eel Garden', position: { latitude: 28.5101, longitude: 34.5172 }, country: 'EG', waterBody: 'Red Sea' } });
  const diveNow = await (await request.get(`/api/dives/${sitedDive}`)).json() as { version: number };
  await request.patch(`/api/dives/${sitedDive}`, { headers, data: { version: diveNow.version, siteId: site.id } });
  // Dive centres (ADR 0043): one with an SSI centre number at Lighthouse, so its code shows there and on the dive, and
  // one without a number. Name and number are made up.
  const centre = await (await request.post('/api/dive-centres', {
    headers, data: { name: 'Example Divers Red Sea GmbH, Musterstadt', externalIds: [{ source: 'ssi', externalId: '700001' }], siteIds: [site.id] },
  })).json() as { id: string };
  await request.post('/api/dive-centres', { headers, data: { name: 'Tauchschule Beispiel' } });

  // Site import (ADR 0021): Malta from the recorded OpenStreetMap answer; one site with the SSI ID and depth set.
  const started = await (await request.post('/api/admin/site-imports', {
    headers, data: { sources: ['osm', 'wikidata'], area: { kind: 'country', country: 'MT' }, language: 'en', confirmOdbl: true },
  })).json() as { id: string };
  await expect.poll(async () => (await (await request.get(`/api/admin/site-imports/${started.id}`)).json()).status, { timeout: 20_000 }).toBe('done');
  const imported = (await (await request.get('/api/dive-sites?q=Ras%20il')).json() as { sites: { id: string; name: string; version: number }[] }).sites
    .find((s) => s.name === 'Ras il-Ħobż')!;
  await request.patch(`/api/dive-sites/${imported.id}`, { headers, data: { version: imported.version, maxDepthM: 32 } });
  await request.put(`/api/dive-sites/${imported.id}/external-ids/ssi`, { headers, data: { externalId: '3314' } });

  // SSI (ADR 0025): a site made here with SSI's ID typed in, filled by an SSI import of Switzerland that creates
  // nothing, so its page offers SSI's data; and Dive 42 at a fresh-water site, for the dive page's hint.
  const ours = await (await request.post('/api/dive-sites', {
    headers, data: { name: 'Ouchy – Seeufer (club notes)', position: { latitude: 46.5001, longitude: 6.62 }, waterBody: 'Lac Léman' },
  })).json() as { id: string };
  await request.put(`/api/dive-sites/${ours.id}/external-ids/ssi`, { headers, data: { externalId: '7008' } });
  const ssiRun = await (await request.post('/api/admin/site-imports', {
    headers, data: { sources: ['ssi'], area: { kind: 'country', country: 'CH' }, language: 'en', confirmSsi: true, createSites: false },
  })).json() as { id: string };
  await expect.poll(async () => (await (await request.get(`/api/admin/site-imports/${ssiRun.id}`)).json()).status, { timeout: 20_000 }).toBe('done');
  const lake = await (await request.post('/api/dive-sites', {
    headers, data: { name: 'Gosausee', position: { latitude: 47.5326, longitude: 13.4995 }, country: 'AT', waterType: 'fresh' },
  })).json() as { id: string };
  const dive42Now = await (await request.get(`/api/dives/${dive42}`)).json() as { version: number };
  await request.patch(`/api/dives/${dive42}`, { headers, data: { version: dive42Now.version, siteId: lake.id } });

  // axe in two of the six variants, as in ui-quality (ADR 0023): both colour schemes, both languages.
  const sitePages = async (prefix: string, de: boolean, axe = false) => {
    if (!want('sites')) return;
    // A new language needs a reload; moving by hash keeps the one the app started with.
    await page.goto('/#/sites'); await page.reload(); await page.locator('table').waitFor();
    await capture(page, `${prefix}-sites`, { aria: false, axe });
    await page.goto('/#/sites?country=EG&sort=diveCount&order=desc'); await page.locator('table').waitFor();
    await capture(page, `${prefix}-sites-filtered`, { aria: false, axe });
    await page.goto(`/#/sites/${site.id}`); await page.getByRole('heading', { name: 'Lighthouse' }).waitFor();
    await capture(page, `${prefix}-site`, { aria: false, axe });
    await page.getByRole('button', { name: de ? /^Mit diesem Platz zusammenführen:/ : /^Merge into this site:/ }).click();
    await page.getByRole('dialog').waitFor();
    await capture(page, `${prefix}-site-merge`, { full: false, aria: false, axe });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: de ? 'Tauchplatz bearbeiten' : 'Edit dive site' }).click();
    await capture(page, `${prefix}-site-edit`, { aria: false, axe });
    await page.goto(`/#/dives/${sitedDive}`); await page.getByRole('heading', { name: de ? /Tauchgang \d+/ : /Dive \d+/ }).waitFor();
    await capture(page, `${prefix}-dive-with-site`, { aria: false, axe });
    await page.getByRole('button', { name: de ? 'Tauchplatz ändern' : 'Change dive site' }).click();
    await page.getByRole('dialog').waitFor();
    await capture(page, `${prefix}-site-picker`, { full: false, aria: false, axe });
    await page.getByRole('dialog').getByRole('searchbox').fill('Ligh');
    await page.getByRole('dialog').getByRole('status').filter({ hasText: /Ligh/ }).waitFor();
    await capture(page, `${prefix}-site-picker-search`, { full: false, aria: false, axe });
    await page.getByRole('dialog').getByRole('button', { name: de ? 'Neuer Tauchplatz' : 'New dive site' }).click();
    await capture(page, `${prefix}-site-picker-new`, { full: false, aria: false, axe });
    await page.keyboard.press('Escape');
    await page.goto(`/#/dives/${sitedDive}`);
    await page.getByRole('button', { name: de ? 'Verifizierungscode' : 'Verification code', exact: true }).click();
    await page.getByRole('img', { name: /Example Divers Red Sea GmbH/ }).waitFor();
    await capture(page, `${prefix}-dive-centre-code`, { aria: false, axe });
    await page.goto('/#/centres'); await page.getByRole('link', { name: 'Example Divers Red Sea GmbH' }).waitFor();
    await capture(page, `${prefix}-centres`, { aria: false, axe });
    await page.getByRole('button', { name: de ? 'Neue Tauchbasis' : 'New dive centre' }).click();
    await capture(page, `${prefix}-centre-new`, { aria: false, axe });
    // The scanner (ADR 0043): with a camera that shows a white wall, and with a camera the browser has blocked.
    await page.evaluate(() => {
      const getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const context = canvas.getContext('2d')!;
        const draw = () => { context.fillStyle = '#ddd'; context.fillRect(0, 0, 640, 480); };
        draw();
        setInterval(draw, 100);
        return canvas.captureStream(10);
      };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    });
    await page.getByRole('button', { name: de ? 'Mit Kamera scannen' : 'Scan with camera' }).click();
    await page.getByText(de ? 'Halte den QR-Code vor die Kamera.' : 'Hold the QR code in front of the camera.').waitFor();
    await capture(page, `${prefix}-centre-scan`, { full: false, aria: false, axe });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new DOMException('', 'NotAllowedError'); } } });
    });
    await page.getByRole('button', { name: de ? 'Mit Kamera scannen' : 'Scan with camera' }).click();
    await page.getByRole('button', { name: de ? 'Erneut versuchen' : 'Try again' }).waitFor();
    await capture(page, `${prefix}-centre-scan-blocked`, { full: false, aria: false, axe });
    await page.keyboard.press('Escape');
    await page.goto(`/#/centres/${centre.id}`); await page.getByRole('img', { name: /Example Divers Red Sea GmbH/ }).waitFor();
    await capture(page, `${prefix}-centre`, { aria: false, axe });
    await page.getByRole('button', { name: de ? 'Ändern: SSI-Centernummer' : 'Change: SSI centre number' }).click();
    await capture(page, `${prefix}-centre-number`, { aria: false, axe });
    await page.goto(`/#/sites/${imported.id}`); await page.getByRole('heading', { name: 'Ras il-Ħobż' }).waitFor();
    await capture(page, `${prefix}-imported-site`, { aria: false, axe });
    await page.getByRole('button', { name: de ? 'Tauchplatz bearbeiten' : 'Edit dive site' }).click();
    await capture(page, `${prefix}-imported-site-edit`, { aria: false, axe });
    await page.goto(`/#/sites/${ours.id}`); await page.getByRole('heading', { name: 'Ouchy – Seeufer (club notes)' }).waitFor();
    await capture(page, `${prefix}-site-offer`, { aria: false, axe });
    await page.getByRole('button', { name: de ? 'Daten von SSI übernehmen' : 'Use SSI’s data' }).click();
    await page.getByRole('dialog').waitFor();
    await capture(page, `${prefix}-site-adopt`, { full: false, aria: false, axe });
    await page.keyboard.press('Escape');
    await page.goto(`/#/dives/${dive42}`); await page.getByRole('heading', { name: de ? /Tauchgang \d+/ : /Dive \d+/ }).waitFor();
    await capture(page, `${prefix}-dive-at-fresh-water-site`, { aria: false, axe });
    await page.goto('/#/admin/site-imports'); await page.locator('.site-imports > li').first().waitFor();
    await capture(page, `${prefix}-site-import`, { aria: false, axe });
    await page.getByText(de ? 'Ein Gebiet nach Koordinaten' : 'An area by coordinates').click();
    await page.getByRole('button', { name: de ? 'Import starten' : 'Start import' }).click();
    await capture(page, `${prefix}-site-import-box`, { aria: false, axe });
    await page.getByText(de ? 'SSI (ohne Lizenz, siehe unten)' : 'SSI (no licence, see below)').click();
    await page.getByText(de ? 'Nur Tauchplätze ergänzen, die schon hier sind' : 'Only fill dive sites that are already here').click();
    await capture(page, `${prefix}-site-import-ssi`, { aria: false, axe });
  };
  // The Tools page (ADR 0032): empty, a bottom time with its three limits, and outside the limits.
  const toolsPages = async (prefix: string, axe = false) => {
    if (!want('tools')) return;
    await page.goto('/#/tools'); await page.reload(); await page.getByRole('heading', { level: 1 }).waitFor();
    await capture(page, `${prefix}-tools`, { aria: false, axe });
    await page.goto('/#/tools?o2=32&depth=30&volume=11.1&pressure=200'); await page.getByTestId('bottom-time').waitFor();
    await capture(page, `${prefix}-tools-bottom-time`, { aria: false, axe });
    // A reload: a setting in the address opens the Settings section when the page is built, not when only the hash changes.
    await page.goto('/#/tools?o2=32&depth=30&volume=11.1&pressure=200&rule=reserve&bar=60'); await page.reload(); await page.getByTestId('bottom-time').waitFor();
    await capture(page, `${prefix}-tools-settings`, { aria: false, axe });
    // The profile with the first levels, before a mix or a Diver.
    await page.goto('/#/tools/plan?lv=20x15,12x10'); await page.locator('.plan-profile canvas').first().waitFor();
    await capture(page, `${prefix}-tools-plan-sketch`, { aria: false, axe });
    // A gas plan of a group with a turn rule, and one that does not fit.
    await page.goto('/#/tools/plan?mix=32&water=fresh&rule=thirds&lv=20x15,12x10&dv=Tim~12~200~20~&dv=Ann~10~200~15~'); await page.reload(); await page.getByTestId('plan-briefing').waitFor();
    await capture(page, `${prefix}-tools-plan`, { aria: false, axe });
    // One set of fields open at a time: a level's, then the search for another Diver.
    await page.locator('.plan-levels .plan-actions .btn').first().click();
    await capture(page, `${prefix}-tools-plan-level`, { aria: false, axe });
    await page.locator('.plan-add').last().click(); await page.getByRole('searchbox').fill('a'); await page.getByRole('option').first().waitFor();
    await capture(page, `${prefix}-tools-plan-find`, { aria: false, axe });
    await page.goto('/#/tools/plan?water=fresh&lv=20x40&dv=Tim~12~200~20~'); await page.reload(); await page.getByTestId('plan-briefing').waitFor();
    await capture(page, `${prefix}-tools-plan-no-fit`, { aria: false, axe });
    await page.goto('/#/tools?o2=40&depth=36&he=0'); await page.locator('.tools-answer .notice').first().waitFor();
    await capture(page, `${prefix}-tools-outside`, { aria: false, axe });
    // The lead calculator: empty, with no number (no body weight in the review data), and the two answers as the server gives them.
    const leadUrl = '/#/tools/lead?lw=salt&suit=wetsuit&mm=5&hood=0&cyl=11.1%7Ealuminium';
    const base = { unit: 'kg', reserve: { bar: 50, fromDives: false }, leftOut: { noWaterType: 0 }, weightCheck: { steps: ['eye_level_empty_bc', 'neutral_at_5m_at_reserve'], reserveBar: 50 } };
    await page.goto('/#/tools/lead'); await page.reload(); await page.getByRole('heading', { level: 1 }).waitFor();
    await capture(page, `${prefix}-tools-lead`, { aria: false, axe });
    await page.goto(leadUrl); await page.getByText(/^(No number yet|Noch keine Zahl)$/).waitFor();
    await capture(page, `${prefix}-tools-lead-no-number`, { aria: false, axe });
    const answer = async (body: object) => {
      await page.unroute('**/api/divers/*/lead-estimate*');
      await page.route('**/api/divers/*/lead-estimate*', (route) => route.fulfill({ json: body }));
      await page.goto(leadUrl); await page.reload(); await page.getByTestId('lead-total').waitFor();
    };
    await answer({
      ...base, confidence: 'low', total: 6.5, range: { low: 5, high: 8 }, basis: { kind: 'rule_of_thumb', rule: 6, personalOffset: 1, offsetFromSuits: 2 },
      adjustments: [{ kind: 'personal_offset', amount: 1 }, { kind: 'cylinder', amount: 1.5 }, { kind: 'water', amount: -2, water: 'salt' }],
      missing: [{ kind: 'cylinder_material', diveIds: [], planned: true }, { kind: 'suit_thickness' }],
    });
    await capture(page, `${prefix}-tools-lead-rule`, { aria: false, axe });
    await answer({
      ...base, confidence: 'high', total: 8, range: { low: 7, high: 9.5 }, reserve: { bar: 55, fromDives: true },
      basis: { kind: 'dives', personal: 7, dives: [{ diveId: sitedDive, startsAt: '2026-03-01T09:00:00Z', number: 12, carried: 8, needed: 9, weight: 2 }, { diveId: sitedDive, startsAt: '2025-03-01T09:00:00Z', number: null, carried: 7, needed: 7, weight: 1 }] },
      adjustments: [{ kind: 'cylinder', amount: 1 }, { kind: 'water', amount: 0.5, water: 'salt' }], missing: [{ kind: 'cylinder', diveIds: [sitedDive] }], leftOut: { noWaterType: 2 },
    });
    await capture(page, `${prefix}-tools-lead-dives`, { aria: false, axe });
    await page.unroute('**/api/divers/*/lead-estimate*');
  };
  const pagesOf = async (prefix: string, de: boolean, axe = false) => { await sitePages(prefix, de, axe); await toolsPages(prefix, axe); };
  await page.setViewportSize({ width: 1280, height: 900 });
  await pagesOf('17-en-light-desktop', false, true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await pagesOf('18-en-dark-desktop', false);
  await page.setViewportSize({ width: 320, height: 640 });
  await pagesOf('19-en-dark-320', false);
  await setPreferences(request, { language: 'de' });
  await page.setViewportSize({ width: 390, height: 844 });
  await pagesOf('20-de-dark-390', true, true);
  await page.emulateMedia({ colorScheme: 'light' });
  await pagesOf('21-de-light-390', true);
  await page.setViewportSize({ width: 320, height: 640 });
  await pagesOf('22-de-light-320', true);
  if (want('sites')) {
    await page.goto(`/#/?site=${site.id}`); await page.getByRole('region', { name: 'Tauchgänge' }).waitFor();
    await capture(page, '23-de-light-320-logbook-at-site', { aria: false });
  }
  await setPreferences(request, { language: null });
  const dive42Then = await (await request.get(`/api/dives/${dive42}`)).json() as { version: number };
  await request.patch(`/api/dives/${dive42}`, { headers, data: { version: dive42Then.version, siteId: null } });

  // SSI (ADR 0024): the account panel before and after connecting; a Dive ready to send, the SSI site picker,
  // sent, and changed since sent; the same in German on a dark phone.
  if (want('account') || want('dives')) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await disconnectSsi(request);
    await setPreferences(request, { language: 'en' });
    // Changing the hash doesn't reload the app, which keeps the language it had: reload to take the new one.
    if (want('account')) {
      await page.goto('/#/account?tab=connections'); await page.reload(); await page.getByRole('button', { name: 'Connect to SSI' }).waitFor();
      await capture(page, '24-account-ssi-connect');
    }
    await connectSsi(request);
    if (want('account')) {
      await page.reload(); await page.getByText('Connected, password kept').waitFor();
      await capture(page, '25-account-ssi-connected', { aria: false });
      // Sending by itself (ADR 0056): the last fetch with what waits, the offer of unsent new dives, and a dive SSI already has.
      const automaticDive = await deletableDive(request);
      const automaticConnection = await ssiConnectionOf(request, automaticDive);
      await fetchState(request, automaticConnection, { created: 2, updated: 1, skipped: 3, unsent: [automaticDive] });
      await queueEntry(request, automaticDive, { state: 'held', reason: 'exists', detail: { remoteId: '555', remoteNumber: 12, startsAt: '2026-03-05 08:00' } });
      await page.reload(); await page.getByText(/^Last fetched/).waitFor();
      await capture(page, '25a-account-ssi-automatic', { aria: false });
      await page.goto('/#/review'); await page.getByText(/^SSI already has a dive at this time/).waitFor();
      await capture(page, '25a2-account-review-dive-already-at-ssi', { aria: false });
      await setPreferences(request, { language: 'de' });
      await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
      await page.reload(); await page.getByText(/^SSI hat schon einen Tauchgang/).waitFor();
      await capture(page, '25a3-account-review-dive-already-at-ssi-de-phone', { aria: false });
      await page.goto('/#/account?tab=connections'); await page.getByText(/^Zuletzt abgerufen/).waitFor();
      await capture(page, '25a4-account-ssi-automatic-de-phone', { aria: false });
      await fetchState(request, automaticConnection, { clear: true }); await clearQueue(request);
      await setPreferences(request, { language: 'en' });
      await page.setViewportSize({ width: 1280, height: 900 }); await page.emulateMedia({ colorScheme: 'light' });
      await page.goto('/#/account?tab=connections'); await page.reload(); await page.getByText('Connected, password kept').waitFor();
      // The SSI buddy list (ADR 0029): who is in Dive Hub already, adding and linking.
      await page.getByRole('button', { name: /^Show your SSI buddy list/ }).click();
      await page.getByRole('row', { name: /Mia Stone/ }).waitFor();
      await capture(page, '25b-account-ssi-buddies');
    }
    if (want('dives')) {
      await readyForSsi(request, dive42);
      await page.goto(`/#/dives/${dive42}`); await page.reload(); await openLine(page, 'SSI'); await page.getByRole('button', { name: 'Choose the SSI site' }).waitFor();
      await capture(page, '26-dive-ssi-ready');
      await page.getByRole('button', { name: 'Choose the SSI site' }).click();
      await page.getByRole('dialog').getByRole('option').first().waitFor();
      await capture(page, '27-dive-ssi-picker', { full: false });
      // The account's own private site among them (piece 4): marked "private".
      await page.getByRole('dialog').getByRole('searchbox').fill('geheim');
      await page.getByRole('dialog').getByRole('option', { name: /Erikas Geheimriff/ }).waitFor();
      await capture(page, '27b-dive-ssi-picker-private', { full: false, aria: false });
      await page.getByRole('dialog').getByRole('option', { name: /Erikas Geheimriff/ }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Send to SSI' }).click();
      await page.getByText('Up to date').waitFor();
      await capture(page, '28-dive-ssi-sent', { aria: false });
      // Piece 4: the site the send made at SSI is private to the account; its page and form say so.
      const sent = await (await request.get(`/api/dives/${dive42}`)).json() as { site: { id: string } };
      await page.goto(`/#/sites/${sent.site.id}`); await page.getByText('Your private SSI site', { exact: true }).waitFor();
      await capture(page, '28b-site-private-id', { aria: false });
      await page.getByRole('button', { name: 'Edit dive site' }).click();
      await page.getByRole('textbox', { name: 'Your private SSI site ID' }).waitFor();
      await capture(page, '28c-site-private-id-edit', { aria: false });
      await page.goto(`/#/dives/${dive42}`); await page.reload();
      await editElsewhere(request, dive42, 'Changed after sending');
      await page.reload(); await page.getByText('Changed since sent').waitFor();
      await capture(page, '29-dive-ssi-changed');
      // Buddies (ADR 0028, 0029): Kai has an SSI account, Ulla none, so SSI's panel offers to find her.
      await forgetDivers(request, 'Mia');
      await setBuddies(request, dive42, [await externalDiver(request, 'Kai Lund', '4989164'), await externalDiver(request, 'Ulla Berg')]);
      await page.reload(); await page.getByRole('button', { name: 'Link or add Ulla Berg' }).waitFor();
      await capture(page, '29b-dive-buddies');
      await page.getByRole('button', { name: 'Change: Buddies and guides' }).click(); await page.getByRole('dialog').getByRole('listitem').first().waitFor();
      await capture(page, '29b2-dive-change-buddies', { full: false });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Add someone' }).click();
      await page.getByRole('dialog').getByRole('searchbox').fill('u');
      await page.getByRole('dialog').getByRole('option').first().waitFor();
      await capture(page, '29c-dive-add-someone', { full: false });
      // Escape in a search field with text clears it first; Cancel closes the dialog.
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('button', { name: 'Link or add Ulla Berg' }).click();
      await page.getByRole('dialog').getByRole('option').first().waitFor();
      await capture(page, '29d-dive-find-in-ssi-list', { full: false });
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    }
    await setPreferences(request, { language: 'de' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    if (want('dives')) {
      await page.reload(); await page.getByText('Seit dem Senden geändert').waitFor();
      await capture(page, '30-dive-ssi-de-dark-390', { aria: false });
    }
    if (want('account')) {
      await page.goto('/#/account?tab=connections'); await page.reload(); await page.getByText('Verbunden, Passwort gespeichert').waitFor();
      await capture(page, '31-account-ssi-de-dark-390', { aria: false });
    }
    // Sending many dives (ADR 0047): the dialog with a dive held back, and a run stopped by a sign-in need; German on a dark phone.
    if (want('dives')) {
      await setPreferences(request, { language: 'en' });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width: 1280, height: 900 });
      const { connectionId, siteId } = await pushRunSetup(request, dive42, { keepSignedIn: false, siteExternalId: null, positioned: false });
      await page.goto(`/#/?site=${siteId}`); await page.reload();
      await page.getByRole('button', { name: 'Send to SSI…' }).click();
      await page.getByRole('dialog').getByText(/held back/).waitFor();
      await capture(page, '32-logbook-send-dialog', { full: false });
      await page.keyboard.press('Escape');
      await request.put(`/api/dive-sites/${siteId}/external-ids/ssi`, { headers, data: { externalId: '7099' } });
      // The dialog that owns the selection (slice 25b): which dives, and the ones that go.
      await page.getByRole('button', { name: 'Send to SSI…' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Show the dive' }).click();
      await capture(page, '32b-logbook-send-dialog-dives', { full: false });
      await page.keyboard.press('Escape');
      await expireSsiTokens(request);
      await request.post(`/api/connections/${connectionId}/push-runs`, { headers, data: { dives: { list: { siteId } } } });
      await page.reload(); await page.getByRole('button', { name: 'Continue' }).waitFor();
      await capture(page, '33-logbook-run-stopped');
      await setPreferences(request, { language: 'de' });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload(); await page.getByRole('button', { name: 'Fortsetzen' }).waitFor();
      await capture(page, '34-logbook-run-stopped-de-dark-390');
      // On a phone Send sits behind "Filter and sort" (slice 25f); with a filter set the control says what is on.
      await page.getByRole('button', { name: /Filtern und sortieren/ }).click();
      await capture(page, '34b-logbook-choices-open-de-dark-390', { full: false });
      await page.getByRole('button', { name: 'An SSI senden…' }).click();
      await page.getByRole('dialog').waitFor();
      await capture(page, '35-logbook-send-dialog-de-dark-390', { full: false });
      await page.keyboard.press('Escape');
      // A run going, with an earlier one (slice 25d): the mark beside "Logbook" and the list "Earlier runs", as drawn by the server's answer.
      const now = new Date().toISOString();
      const stub = { connectionId, provider: 'ssi', diverId: '00000000-0000-4000-8000-000000000003', stopCode: null, updates: false, updatesRemovingVerification: false,
        numbers: false, cancelRequested: false, leftOut: {}, pauseMs: 0, createdAt: now, startedAt: now, dismissedAt: null };
      await page.route('**/api/push-runs', (route) => route.fulfill({ json: [
        { ...stub, id: '00000000-0000-4000-8000-000000000001', status: 'running', counts: { total: 10, waiting: 7, sent: 3, skipped: 0, failed: 0 }, finishedAt: null },
        { ...stub, id: '00000000-0000-4000-8000-000000000004', status: 'done', counts: { total: 2, waiting: 0, sent: 2, skipped: 0, failed: 0 }, finishedAt: now },
      ] }));
      await page.reload(); await page.getByRole('button', { name: 'Frühere Sendungen (1)' }).click();
      await capture(page, '35f-logbook-run-going-earlier-de-dark-390', { full: false });
      await page.unroute('**/api/push-runs');
      await clearPushRuns(request);
      await leaveSsi(request, dive42);
      // A dive changed after it was sent (slice 22d): the "Changed since sent" chip, and the dialog's link to it.
      const changed = await pushRunSetup(request, dive42, { keepSignedIn: true, siteExternalId: '7099' });
      await request.post(`/api/dives/${dive42}/providers/ssi`, { headers, data: {} });
      const current = await (await request.get(`/api/dives/${dive42}`)).json() as { version: number };
      await request.patch(`/api/dives/${dive42}`, { headers, data: { version: current.version, notes: 'Changed after it was sent' } });
      await page.goto(`/#/?site=${changed.siteId}`); await page.reload();
      await page.getByRole('button', { name: /Filtern und sortieren/ }).click();
      await page.getByRole('button', { name: /^Seit dem Senden geändert \d+$/ }).waitFor();
      await capture(page, '35b-logbook-changed-since-sent-de-dark-390');
      await page.getByRole('button', { name: 'An SSI senden…' }).click();
      await page.getByRole('dialog').getByRole('link', { name: 'Diese Tauchgänge im Logbuch zeigen' }).waitFor();
      await capture(page, '35c-logbook-send-dialog-changed-de-dark-390', { full: false });
      await page.getByRole('dialog').getByText('Auch Tauchgänge aktualisieren, die seit dem Senden geändert wurden').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Den Tauchgang zeigen' }).click();
      await capture(page, '35e-logbook-send-dialog-dives-de-dark-390', { full: false });
      await page.keyboard.press('Escape');
      await setPreferences(request, { language: 'en' });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.reload(); await page.getByRole('button', { name: /^Changed since sent \d+$/ }).waitFor();
      await capture(page, '35d-logbook-changed-since-sent');
      await clearPushRuns(request);
      await leaveSsi(request, dive42);
      await setPreferences(request, { language: 'en' });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await setPreferences(request, { language: null });
    await page.emulateMedia({ colorScheme: 'light' });
    await request.delete(`/api/dives/${dive42}/providers/ssi`, { headers });
    await clearParticipants(request, dive42);
    await leaveSsi(request, dive42);
  }

  // Importing dives from SSI (ADR 0030), with Lena's logbook: the preview with a computer and decisions, the outcome, a
  // dive without a recording; the preview in German on a dark phone.
  if (want('account') || want('dives')) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await setPreferences(request, { language: 'en' });
    await lenaReady(request);
    if (want('account')) {
      await page.goto('/#/account?tab=connections'); await page.reload();
      const section = page.getByRole('region', { name: 'Dives of Lena from SSI' });
      await section.getByRole('button', { name: 'Show what the import would do' }).click();
      await section.getByRole('radiogroup', { name: /^SSI dive 15: / }).waitFor();
      await capture(page, '31b-account-ssi-import-preview');
      await section.getByRole('button', { name: 'Import from SSI' }).click();
      await section.getByRole('link', { name: 'Go to the logbook' }).waitFor({ timeout: 30_000 });
      await capture(page, '31c-account-ssi-import-done');
    }
    if (want('dives')) {
      await page.goto(`/#/dives/${await diveWithoutRecording(request)}`); await page.reload();
      await page.getByText(/^No recording yet/).waitFor();
      await capture(page, '31d-dive-from-ssi-without-recording');
    }
    if (want('account')) {
      await setPreferences(request, { language: 'de' });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/#/account?tab=connections'); await page.reload();
      const section = page.getByRole('region', { name: 'Tauchgänge von Lena aus SSI' });
      await section.getByRole('button', { name: 'Zeigen, was der Import tun würde' }).click();
      await section.getByRole('radiogroup', { name: /^SSI-Tauchgang 15: / }).waitFor();
      await capture(page, '31e-account-ssi-import-de-dark-390', { aria: false });
    }
    await setPreferences(request, { language: null });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await leaveLena(request);
  }

  // Deleting a Dive (ADR 0026), with dive 9: the dialog without and with the SSI question, the logbook with Undo, the
  // reminder and the deleted dives; the list and the SSI question in German on a dark phone.
  if (want('dives')) {
    const openDelete = async (more: string, item: RegExp, button: string) => {
      await page.getByRole('button', { name: more }).click();
      await page.getByRole('menuitem', { name: item }).click();
      await page.getByRole('dialog').getByRole('button', { name: button }).waitFor();
    };
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await setPreferences(request, { language: 'en' });
    const nine = await deletableDive(request);
    const nineNumber = await diveNumber(request, nine);
    await page.goto(`/#/dives/${nine}`); await page.reload(); await page.getByRole('heading', { name: `Dive ${nineNumber}` }).waitFor();
    await openDelete(`More: Dive ${nineNumber}`, /^Delete dive/, 'Delete dive');
    await capture(page, '32-dive-delete', { full: false });
    await page.keyboard.press('Escape');
    await sendToSsi(request, nine);
    await page.reload(); await page.getByRole('heading', { name: `Dive ${nineNumber}` }).waitFor();
    await openDelete(`More: Dive ${nineNumber}`, /^Delete dive/, 'Delete here and in SSI');
    await capture(page, '33-dive-delete-ssi', { full: false });
    await page.getByRole('dialog').getByRole('button', { name: 'Delete only here' }).click();
    await page.getByRole('button', { name: 'Undo' }).waitFor();
    await capture(page, '34-logbook-deleted');
    await page.reload();
    await page.getByRole('link', { name: 'Show deleted dives', exact: true }).click();
    await page.getByRole('button', { name: /^Restore: .*2026/ }).waitFor();
    await capture(page, '35-logbook-deleted-dives');
    await setPreferences(request, { language: 'de' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole('button', { name: /^Wiederherstellen: .*2026/ }).waitFor();
    await capture(page, '36-logbook-deleted-dives-de-dark-390', { aria: false });
    await deletableDive(request);
    await sendToSsi(request, nine);
    await page.goto(`/#/dives/${nine}`); await page.getByRole('heading', { name: `Tauchgang ${nineNumber}` }).waitFor();
    await openDelete(`Mehr: Tauchgang ${nineNumber}`, /^Tauchgang löschen/, 'Hier und in SSI löschen');
    await capture(page, '37-dive-delete-ssi-de-dark-390', { full: false, aria: false });
    await page.keyboard.press('Escape');
    await deletableDive(request);
    await setPreferences(request, { language: null });
    await page.emulateMedia({ colorScheme: 'light' });
  }

  // Sending by itself (ADR 0056), with dive 9: a stopped send in its logbook row and on its page, and a delete at SSI
  // that waits in the deleted dives; in English on a desktop, in German on a dark phone.
  if (want('dives')) {
    const nine = await deletableDive(request);
    const nineNumber = await diveNumber(request, nine);
    const connection = await ssiConnectionOf(request, nine);
    const deleteAtSsi = (on: boolean) => request.patch(`/api/connections/${connection}`, { data: { deleteAtProvider: on }, headers });
    for (const [language, suffix] of [['en', ''], ['de', '-de-dark-390']] as const) {
      const de = language === 'de';
      await setPreferences(request, { language });
      await page.emulateMedia({ colorScheme: de ? 'dark' : 'light' });
      await page.setViewportSize(de ? { width: 390, height: 844 } : { width: 1280, height: 900 });
      await leaveSsi(request, nine);
      await queueEntry(request, nine, { state: 'stopped', reason: 'provider_unavailable' });
      await page.goto('/#/'); await page.reload();
      await page.getByRole('button', { name: `${de ? 'Erneut versuchen' : 'Retry'}: ${de ? 'Nummer' : 'Number'} ${nineNumber}` }).waitFor();
      await capture(page, `38-logbook-waiting-push-stopped${suffix}`, { aria: !de });
      await page.goto(`/#/dives/${nine}`); await openLine(page, 'SSI');
      await page.getByRole('group', { name: 'SSI' }).getByRole('button', { name: de ? 'Erneut versuchen' : 'Retry' }).waitFor();
      await capture(page, `38a-dive-waiting-push-stopped${suffix}`, { aria: !de });
      await clearQueue(request);
      await sendToSsi(request, nine);
      await deleteAtSsi(true);
      await page.goto(`/#/dives/${nine}`); await page.reload();
      await page.getByRole('button', { name: `${de ? 'Mehr: Tauchgang' : 'More: Dive'} ${nineNumber}` }).click();
      await page.getByRole('menuitem', { name: de ? /^Tauchgang löschen/ : /^Delete dive/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: de ? 'Tauchgang löschen' : 'Delete dive' }).click();
      // The delete goes to the logbook with Undo first; the deleted dives after that.
      await page.getByRole('button', { name: de ? 'Rückgängig' : 'Undo' }).waitFor();
      await page.goto('/#/review?tab=deleted');
      await page.getByRole('button', { name: de ? /^Wiederherstellen: .*2026/ : /^Restore: .*2026/ }).first().waitFor();
      await capture(page, `38b-logbook-deleted-dives-waiting${suffix}`, { aria: !de });
      await deleteAtSsi(false); await clearQueue(request);
      await deletableDive(request);
    }
    await leaveSsi(request, nine);
    await setPreferences(request, { language: null });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  // Merging two Dives (ADR 0038), with dive 31 and a Dive without a Recording beside it: the hint on the dive page and the
  // dialog, the pair as a logbook check on the logbook, the kept Dive afterwards, the deleted dives saying where the other
  // went; the hint, the dialog and the check in German on a dark phone.
  if (want('dives')) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setPreferences(request, { language: 'en' });
    let pair = await mergeablePair(request);
    await page.goto(`/#/dives/${pair.kept}`); await page.reload();
    await page.getByRole('button', { name: 'Merge the two…' }).waitFor();
    await capture(page, '70-dive-merge-hint');
    await page.goto('/'); await page.getByRole('link', { name: 'Review them' }).click();
    await page.getByRole('button', { name: /^They are two dives: / }).waitFor();
    await capture(page, '70b-review-check');
    await page.goto(`/#/dives/${pair.kept}`); await page.getByRole('button', { name: 'Merge the two…' }).waitFor();
    // Merging by hand: the dives nearby to choose from (ADR 0038, amended).
    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('menuitem', { name: 'Merge with another dive…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Merge with this dive…/ }).waitFor();
    await capture(page, '71a-dive-merge-picker', { full: false });
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Merge the two…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Merge', exact: true }).waitFor();
    await capture(page, '71-dive-merge-dialog', { full: false });
    await page.getByRole('dialog').getByRole('button', { name: 'Merge', exact: true }).click();
    await page.getByRole('tab').nth(1).waitFor(); await openLine(page, 'History');
    await page.getByText('Another dive of the same time was merged into this one').first().waitFor();
    await capture(page, '72-dive-merged');
    await page.goto('/#/review?tab=deleted');
    await page.getByText('Merged into another dive.').first().waitFor();
    await capture(page, '73-logbook-deleted-merged');
    pair = await mergeablePair(request);
    await setPreferences(request, { language: 'de' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/dives/${pair.kept}`); await page.reload();
    await page.getByRole('button', { name: /^Beide zusammenführen/ }).waitFor();
    await capture(page, '74-dive-merge-hint-de-dark-390', { aria: false });
    await page.getByRole('button', { name: /^Beide zusammenführen/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Zusammenführen', exact: true }).waitFor();
    await capture(page, '75-dive-merge-dialog-de-dark-390', { full: false, aria: false });
    await page.keyboard.press('Escape');
    await page.goto('/'); await page.getByRole('link', { name: 'Durchsehen' }).click();
    await page.getByRole('button', { name: /^Es sind zwei Tauchgänge: / }).waitFor();
    await capture(page, '76-review-check-de-dark-390', { aria: false });
    await mergePair(request);
    await setPreferences(request, { language: null });
    await page.emulateMedia({ colorScheme: 'light' });
  }

  // A Dive that is probably no dive (ADR 0038, `short_shallow_dive`): the logbook's line, the check on the Review page, the
  // delete dialog it opens, the kept ones under "Decided"; the check in German on a dark phone.
  if (want('dives')) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setPreferences(request, { language: 'en' });
    await falseStart(request);
    await page.goto('/'); await page.reload();
    await page.getByRole('link', { name: 'Review them' }).waitFor();
    await capture(page, '77-logbook-short-dive-line', { full: false, aria: false });
    await page.getByRole('link', { name: 'Review them' }).click();
    await page.getByRole('button', { name: /^Keep it: / }).waitFor();
    await capture(page, '77b-review-short-dive');
    await page.getByRole('button', { name: /^Delete…: / }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete dive' }).waitFor();
    await capture(page, '77c-review-short-dive-delete-dialog', { full: false });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Keep it: / }).click();
    await page.getByRole('button', { name: 'Undo' }).waitFor();
    await capture(page, '77d-review-short-dive-kept');
    await page.goto('/#/review?tab=decided');
    await page.getByRole('button', { name: /^Ask again: / }).waitFor();
    await capture(page, '77e-review-short-dive-decided');
    await falseStart(request);
    await setPreferences(request, { language: 'de' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/review'); await page.reload();
    await page.getByRole('button', { name: /^Behalten: / }).waitFor();
    await capture(page, '78-review-short-dive-de-dark-390', { aria: false });
    await keepFalseStart(request);
    await setPreferences(request, { language: null });
    await page.emulateMedia({ colorScheme: 'light' });

    // A dive deleted in SSI's app (ADR 0051): the check found it; the logbook's strip, the Review page with its two
    // choices and the Connection's check, then the same in German, dark, on a phone.
    const goneId = await deletableDive(request);
    await readyForSsi(request, goneId);
    await goneAtSsi(request, goneId);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/'); await page.reload();
    await page.getByRole('link', { name: 'Review them' }).waitFor();
    await capture(page, '79-logbook-gone-dive-line', { full: false, aria: false });
    await page.getByRole('link', { name: 'Review them' }).click();
    await page.getByRole('button', { name: /^Delete here too: / }).waitFor();
    await capture(page, '79b-review-gone-dive');
    await page.goto('/#/account?tab=connections');
    await page.getByRole('button', { name: /^Check for dives deleted in SSI/ }).click();
    await page.getByRole('link', { name: 'Show them' }).waitFor();
    await capture(page, '79c-account-gone-check');
    await setPreferences(request, { language: 'de' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/review'); await page.reload();
    await page.getByRole('button', { name: /^Auch hier löschen: / }).waitFor();
    await capture(page, '79d-review-gone-dive-de-dark-390', { aria: false });
    await setPreferences(request, { language: null });
    await page.emulateMedia({ colorScheme: 'light' });
    await request.post('/e2e/fake-ssi/clear-dives', { data: { email: 'erika@example.com' }, headers });
    await deletableDive(request);

    // Notes changed both here and in SSI's app (ADR 0056): the update asks on the dive's page, light and dark, desktop
    // and phone; a run leaves the dive waiting, its report says so, and the Review page asks the same.
    const conflictId = await conflictAtSsi(request);
    const askConflict = async () => {
      await page.goto(`/#/dives/${conflictId}`); await page.reload();
      await openLine(page, 'SSI');
      await page.getByRole('button', { name: /^(Update in SSI|In SSI aktualisieren)$/ }).click();
      await page.getByRole('radiogroup', { name: /^(Notes|Notizen)$/ }).waitFor();
    };
    await page.setViewportSize({ width: 1280, height: 900 });
    await askConflict();
    await capture(page, '79e-dive-ssi-conflict');
    await page.emulateMedia({ colorScheme: 'dark' });
    await askConflict();
    await capture(page, '79f-dive-ssi-conflict-dark', { aria: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, '79g-dive-ssi-conflict-dark-390', { aria: false });
    await page.emulateMedia({ colorScheme: 'light' });
    await setPreferences(request, { language: 'de' });
    await askConflict();
    await capture(page, '79h-dive-ssi-conflict-de-390', { aria: false });
    await setPreferences(request, { language: null });
    await page.setViewportSize({ width: 1280, height: 900 });
    const conflictStatus = await (await request.get(`/api/dives/${conflictId}/providers/ssi`)).json() as { connection: { id: string } };
    const conflictRun = await (await request.post(`/api/connections/${conflictStatus.connection.id}/push-runs`, { data: { dives: { ids: [conflictId] }, updates: true }, headers })).json() as { id: string };
    await expect.poll(async () => ((await (await request.get(`/api/push-runs/${conflictRun.id}`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('done');
    await page.goto('/'); await page.reload();
    await page.getByText(/values changed in both places: it waits in Needs your decision/).waitFor();
    await capture(page, '79i-logbook-run-conflicts', { full: false, aria: false });
    await page.goto('/#/review'); await page.reload();
    await page.getByRole('button', { name: /^Send with these choices: / }).waitFor();
    await capture(page, '79j-review-conflict');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, '79k-review-conflict-dark-390', { aria: false });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await clearPushRuns(request);
    await leaveConflict(request);
  }

  // Signed out, then signed up through the invitation: the empty logbook and Divers belong to the new account.
  if (want('account') || want('dives') || want('divers')) {
    const fresh = await browser.newContext({ baseURL: E2E_BASE_URL, locale: 'en-GB', storageState: { cookies: [], origins: [] }, reducedMotion: 'reduce' });
    const p2 = await fresh.newPage();
    await trackRequests(p2);
    await p2.setViewportSize({ width: 1280, height: 900 });
    await p2.goto('/'); await p2.getByRole('heading', { name: 'Sign in' }).waitFor();
    await p2.getByRole('button', { name: 'Sign in' }).click();
    await capture(p2, '12-signin-errors');
    await p2.goto(`/${new URL(invite.url).hash}`); await p2.getByRole('heading', { name: 'Join Dive Hub' }).waitFor();
    await capture(p2, '13-invitation');
    await p2.getByRole('textbox', { name: 'Your name' }).fill('Neu');
    await p2.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple');
    await p2.getByRole('button', { name: 'Create account' }).click();
    await p2.getByRole('heading', { name: 'Logbook' }).waitFor();
    await capture(p2, '14-empty-logbook');
    await p2.goto('/#/divers'); await p2.getByRole('heading', { name: 'Devices' }).waitFor();
    await capture(p2, '15-empty-divers');
    await p2.goto('/#/dives/00000000-0000-7000-8000-000000000000'); await p2.getByRole('heading', { name: 'Dive not found' }).waitFor();
    await capture(p2, '16-dive-not-found', { aria: false });
    await fresh.close();
  }

  writeFileSync(`${out}findings.json`, JSON.stringify(findings, null, 2));
});

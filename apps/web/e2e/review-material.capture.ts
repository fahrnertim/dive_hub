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
  E2E_BASE_URL, aiAccessReady, askMcp, clearParticipants, createAiAccess, connectSsi, deletableDive, disconnectSsi, diveWithoutRecording, editElsewhere, externalDiver, forgetDivers,
  leaveLena, leaveSsi, lenaReady, readyForSsi, sendToSsi, setBuddies, setPreferences,
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
const areaOf = (name: string) => (/site/.test(name) ? 'sites' : /divers/.test(name) ? 'divers'
  : /account|signin|invitation/.test(name) ? 'account' : /admin/.test(name) ? 'admin' : 'dives');

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
    await page.goto(`/#/dives/${dive42}`); await page.getByRole('heading', { name: /Dive 42/ }).waitFor();
    await capture(page, '02-dive');
    await tabOrder(page, '02-dive', 30);
    await page.getByRole('button', { name: 'Edit dive' }).click();
    await capture(page, '03-dive-edit');
  }
  if (want('divers')) {
    await page.goto('/#/divers'); await page.getByRole('heading', { name: 'Devices' }).waitFor(); await page.locator('table').waitFor();
    await capture(page, '04-divers');
  }
  if (want('account')) {
    // AI access (ADR 0035): one access that read something, then a new one with its key on screen.
    await aiAccessReady(request);
    const access = await createAiAccess(request, 'Claude Code on my laptop', true);
    await askMcp(request, access.key, 'logbook_search_dives', { query: 'wreck', country: 'EG', limit: 5 });
    await askMcp(request, access.key, 'logbook_get_dive', { dive_id: '00000000-0000-7000-8000-000000000000' });
    await askMcp(request, access.key, 'logbook_stats', { group_by: 'year' });
    await page.goto('/#/account'); await page.getByRole('heading', { name: 'My account' }).waitFor(); await page.locator('table').first().waitFor();
    await page.getByRole('region', { name: 'What was read' }).waitFor();
    await capture(page, '05-account');
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
      await page.goto(`/#/dives/${dive42}`); await page.getByRole('heading', { name: /Tauchgang 42/ }).waitFor();
      await capture(page, '09-dive-de-phone', { aria: false });
    }
    if (want('divers')) {
      await page.goto('/#/divers'); await page.getByRole('heading', { name: 'Geräte' }).waitFor();
      await capture(page, '10-divers-de-phone', { aria: false });
    }
    if (want('admin')) {
      await page.goto('/#/admin'); await page.getByRole('heading', { name: 'Benutzer' }).waitFor();
      await capture(page, '11-admin-de-phone', { aria: false });
    }
    if (want('account')) {
      await page.goto('/#/account'); await page.getByRole('region', { name: 'Was gelesen wurde' }).waitFor();
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
    await page.goto(`/#/dives/${sitedDive}`); await page.getByRole('heading', { name: de ? /Tauchgang 7/ : /Dive 7/ }).waitFor();
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
    await page.goto(`/#/dives/${dive42}`); await page.getByRole('heading', { name: de ? /Tauchgang 42/ : /Dive 42/ }).waitFor();
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
  await page.setViewportSize({ width: 1280, height: 900 });
  await sitePages('17-en-light-desktop', false, true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await sitePages('18-en-dark-desktop', false);
  await page.setViewportSize({ width: 320, height: 640 });
  await sitePages('19-en-dark-320', false);
  await setPreferences(request, { language: 'de' });
  await page.setViewportSize({ width: 390, height: 844 });
  await sitePages('20-de-dark-390', true, true);
  await page.emulateMedia({ colorScheme: 'light' });
  await sitePages('21-de-light-390', true);
  await page.setViewportSize({ width: 320, height: 640 });
  await sitePages('22-de-light-320', true);
  if (want('sites')) {
    await page.goto(`/#/?site=${site.id}`); await page.locator('table').waitFor();
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
      await page.goto('/#/account'); await page.reload(); await page.getByRole('button', { name: 'Connect to SSI' }).waitFor();
      await capture(page, '24-account-ssi-connect');
    }
    await connectSsi(request);
    if (want('account')) {
      await page.reload(); await page.getByText('Connected, password kept').waitFor();
      await capture(page, '25-account-ssi-connected', { aria: false });
      // The SSI buddy list (ADR 0029): who is in Dive Hub already, adding and linking.
      await page.getByRole('button', { name: /^Show your SSI buddy list/ }).click();
      await page.getByRole('row', { name: /Mia Stone/ }).waitFor();
      await capture(page, '25b-account-ssi-buddies');
    }
    if (want('dives')) {
      await readyForSsi(request, dive42);
      await page.goto(`/#/dives/${dive42}`); await page.reload(); await page.getByRole('button', { name: 'Choose the SSI site' }).waitFor();
      await capture(page, '26-dive-ssi-ready');
      await page.getByRole('button', { name: 'Choose the SSI site' }).click();
      await page.getByRole('dialog').getByRole('option').first().waitFor();
      await capture(page, '27-dive-ssi-picker', { full: false });
      await page.getByRole('dialog').getByRole('option', { name: /Attersee – Schwarzenbach/ }).click();
      await page.getByRole('button', { name: 'Send to SSI' }).click();
      await page.getByText('Up to date').waitFor();
      await capture(page, '28-dive-ssi-sent', { aria: false });
      await editElsewhere(request, dive42, 'Changed after sending');
      await page.reload(); await page.getByText('Changed since sent').waitFor();
      await capture(page, '29-dive-ssi-changed');
      // Buddies (ADR 0028, 0029): Kai has an SSI account, Ulla none, so SSI's panel offers to find her.
      await forgetDivers(request, 'Mia');
      await setBuddies(request, dive42, [await externalDiver(request, 'Kai Lund', '4989164'), await externalDiver(request, 'Ulla Berg')]);
      await page.reload(); await page.getByRole('button', { name: 'Find Ulla Berg in your SSI buddy list' }).waitFor();
      await capture(page, '29b-dive-buddies');
      await page.getByRole('button', { name: 'Add someone' }).click();
      await page.getByRole('dialog').getByRole('searchbox').fill('u');
      await page.getByRole('dialog').getByRole('option').first().waitFor();
      await capture(page, '29c-dive-add-someone', { full: false });
      // Escape in a search field with text clears it first; Cancel closes the dialog.
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('button', { name: 'Find Ulla Berg in your SSI buddy list' }).click();
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
      await page.goto('/#/account'); await page.reload(); await page.getByText('Verbunden, Passwort gespeichert').waitFor();
      await capture(page, '31-account-ssi-de-dark-390', { aria: false });
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
      await page.goto('/#/account'); await page.reload();
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
      await page.goto('/#/account'); await page.reload();
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
    await page.goto(`/#/dives/${nine}`); await page.reload(); await page.getByRole('heading', { name: 'Dive 9' }).waitFor();
    await openDelete('More: Dive 9', /^Delete dive/, 'Delete dive');
    await capture(page, '32-dive-delete', { full: false });
    await page.keyboard.press('Escape');
    await sendToSsi(request, nine);
    await page.reload(); await page.getByRole('heading', { name: 'Dive 9' }).waitFor();
    await openDelete('More: Dive 9', /^Delete dive/, 'Delete here and in SSI');
    await capture(page, '33-dive-delete-ssi', { full: false });
    await page.getByRole('dialog').getByRole('button', { name: 'Delete only here' }).click();
    await page.getByRole('button', { name: 'Undo' }).waitFor();
    await capture(page, '34-logbook-deleted');
    await page.reload();
    await page.getByRole('button', { name: 'Show deleted dives', exact: true }).click();
    await page.getByRole('button', { name: 'Restore: Dive 9' }).waitFor();
    await capture(page, '35-logbook-deleted-dives');
    await setPreferences(request, { language: 'de' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole('button', { name: 'Gelöschte Tauchgänge zeigen', exact: true }).click();
    await page.getByRole('button', { name: 'Wiederherstellen: Tauchgang 9' }).waitFor();
    await capture(page, '36-logbook-deleted-dives-de-dark-390', { aria: false });
    await deletableDive(request);
    await sendToSsi(request, nine);
    await page.goto(`/#/dives/${nine}`); await page.getByRole('heading', { name: 'Tauchgang 9' }).waitFor();
    await openDelete('Mehr: Tauchgang 9', /^Tauchgang löschen/, 'Hier und in SSI löschen');
    await capture(page, '37-dive-delete-ssi-de-dark-390', { full: false, aria: false });
    await page.keyboard.press('Escape');
    await deletableDive(request);
    await setPreferences(request, { language: null });
    await page.emulateMedia({ colorScheme: 'light' });
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

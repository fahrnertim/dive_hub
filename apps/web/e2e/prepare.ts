// Prepares each e2e server once, before any test (ADR 0023): a crowded instance for ui-quality.spec.ts.
// In parallel mode Playwright may run a spec's beforeAll more than once per worker, which is slow
// (Users created through Invitations hash passwords) and piled the crowd up twice.
// What the tests need from it (ids, tokens) is written to e2e/.state/data-<slot>.json.
import { writeFileSync } from 'node:fs';
import { expect, request, type APIRequestContext } from '@playwright/test';

export interface PreparedData {
  diveId: string;
  invitationToken: string;
  resetToken: string;
  /** A site with long names and everything filled in, with a duplicate 20 m away. */
  siteId: string;
  /** "Elphinstone Reef", imported from the recorded OpenStreetMap answer for Egypt (site-import.spec.ts imports Malta). */
  importedSiteId: string;
  /** A site made here that SSI's list describes: its page offers SSI's data (ADR 0025). */
  offerSiteId: string;
}

export const dataFile = (slot: number) => `e2e/.state/data-${slot}.json`;

/** Accepts an Invitation as the invited person would: without a session. */
async function accept(baseURL: string, url: string, name: string) {
  const anonymous = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  const response = await anonymous.post('/api/invitations/accept', {
    data: { token: url.split('/invite/')[1], name, password: 'a long enough test password' },
  });
  if (!response.ok()) throw new Error(`accepting an invitation failed: ${response.status()}`);
  await anonymous.dispose();
}

/**
 * Two more Users (each row with all the admin's actions) and a Diver with long names, so narrow widths
 * meet long names and full rows; not admins, the tests expect Erika to be the only one. A Dive site with
 * long names and everything filled in (ADR 0020), and a duplicate 20 m away for "Close by" (ADR 0022).
 */
async function addCrowd(api: APIRequestContext, baseURL: string) {
  const people = [
    { email: 'maximiliane.schwarzenberger-uebermuth@tauchclub-beispiel.example', name: 'Maximiliane Schwarzenberger-Übermuth' },
    { email: 'bartholomaeus.oberhuber@example.com', name: 'Bartholomäus Oberhuber-Kirchmayr' },
  ];
  for (const p of people) {
    const invitation = await (await api.post('/api/invitations', { data: { email: p.email } })).json() as { url: string };
    await accept(baseURL, invitation.url, p.name);
  }
  await api.post('/api/divers', { data: { name: 'Konstantin von Hohenzollern-Sigmaringen' } });
  const site = await (await api.post('/api/dive-sites', {
    data: {
      name: 'Ras Mohammed – Shark and Yolanda Reef, Anemone City and the Satellite Pinnacles',
      position: { latitude: 27.7355, longitude: 34.2522 }, country: 'CD', waterBody: 'Gulf of Aqaba and the northern Red Sea',
      description: 'Drift along the wall from Shark Reef to Yolanda; the wreck’s cargo of toilets lies at 20–30 m.',
    },
  })).json() as { id: string };
  await api.post('/api/dive-sites', { data: { name: 'Ras Mohammed – Shark Reef (duplicate from an old logbook)', position: { latitude: 27.7357, longitude: 34.2522 } } });
  return site.id;
}

/** A signed-out person's links: an open Invitation, and a reset link for a User who accepted one. */
async function makeLinks(api: APIRequestContext, baseURL: string) {
  const used = await (await api.post('/api/invitations', { data: { email: 'member@example.com' } })).json() as { url: string };
  await accept(baseURL, used.url, 'Member');
  const users = await (await api.get('/api/users')).json() as { id: string; email: string }[];
  const member = users.find((u) => u.email === 'member@example.com')!;
  const resetToken = ((await (await api.post(`/api/users/${member.id}/password-reset`)).json()) as { url: string }).url.split('/reset/')[1]!;
  const open = await (await api.post('/api/invitations', { data: { email: 'guest@example.com' } })).json() as { url: string };
  return { resetToken, invitationToken: open.url.split('/invite/')[1]! };
}

/** Imports Egypt from the recorded OpenStreetMap answer (ADR 0021) and returns one of its sites. */
async function importEgypt(api: APIRequestContext) {
  const started = await (await api.post('/api/admin/site-imports', {
    data: { sources: ['osm'], area: { kind: 'country', country: 'EG' }, language: 'en', confirmOdbl: true },
  })).json() as { id: string };
  await expect.poll(async () => (await (await api.get(`/api/admin/site-imports/${started.id}`)).json()).status, { timeout: 30_000 }).toBe('done');
  const { sites } = await (await api.get('/api/dive-sites?q=Elphinstone')).json() as { sites: { id: string; name: string }[] };
  return sites.find((s) => s.name === 'Elphinstone Reef')!.id;
}

/**
 * A site made here with SSI's ID typed in, then an SSI import of Switzerland that only fills (ADR 0025), so the site
 * offers SSI's data. Switzerland is in no other spec; the import creates nothing.
 */
async function offerSsiData(api: APIRequestContext) {
  const site = await (await api.post('/api/dive-sites', {
    data: { name: 'Ouchy – Seeufer (club notes)', position: { latitude: 46.5001, longitude: 6.62 }, waterBody: 'Lac Léman' },
  })).json() as { id: string };
  await api.put(`/api/dive-sites/${site.id}/external-ids/ssi`, { data: { externalId: '7008' } });
  const started = await (await api.post('/api/admin/site-imports', {
    data: { sources: ['ssi'], area: { kind: 'country', country: 'CH' }, language: 'en', confirmSsi: true, createSites: false },
  })).json() as { id: string };
  await expect.poll(async () => (await (await api.get(`/api/admin/site-imports/${started.id}`)).json()).status, { timeout: 30_000 }).toBe('done');
  return site.id;
}

export async function prepareServer(baseURL: string, session: string, slot: number) {
  const api = await request.newContext({ baseURL, storageState: session, extraHTTPHeaders: { origin: baseURL } });
  const { dives } = await (await api.get('/api/dives?q=42')).json() as { dives: { id: string; number: number | null }[] };
  const data: PreparedData = {
    diveId: dives.find((d) => d.number === 42)!.id,
    ...(await makeLinks(api, baseURL)),
    siteId: await addCrowd(api, baseURL),
    importedSiteId: await importEgypt(api),
    offerSiteId: await offerSsiData(api),
  };
  writeFileSync(dataFile(slot), JSON.stringify(data, null, 2));
  await api.dispose();
}

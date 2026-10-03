// UI/UX review material (docs/research/2026-10-03-ui-review.md): screenshots, axe-core results,
// accessibility trees and Tab orders of every page and state. Not a test; run it on purpose:
//   pnpm --filter @dive-hub/web review:capture        (output: apps/web/review-output/, git-ignored)
// It changes the seeded data (adds a Duplicate candidate, a Diver, invitations), so run it alone.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { E2E_BASE_URL, setPreferences } from './support.ts';

const out = process.env.REVIEW_OUT ?? 'review-output/';
mkdirSync(out, { recursive: true });
const headers = { origin: E2E_BASE_URL };
const findings: Record<string, unknown> = {};

async function capture(page: Page, name: string, opts: { full?: boolean; axe?: boolean; aria?: boolean } = {}) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}${name}.png`, fullPage: opts.full ?? true });
  if (opts.aria !== false) writeFileSync(`${out}${name}.aria.yml`, await page.locator('body').ariaSnapshot());
  if (opts.axe !== false) {
    // axe-core from cdnjs, for review runs only (no dependency).
    await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js' });
    findings[name] = await page.evaluate(async () => {
      // @ts-expect-error injected above
      const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] });
      return r.violations.map((v: { id: string; impact: string; help: string; nodes: { target: string[] }[] }) =>
        ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) }));
    });
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
  test.setTimeout(240_000);
  await setPreferences(request, { language: null, units: null });
  const upload = await request.post('/api/imports', {
    headers, multipart: { file: { name: 'odd-computer.fit', mimeType: 'application/octet-stream', buffer: readFileSync('e2e/fixtures/odd-computer.fit') } },
  });
  await expect.poll(async () => (await (await request.get(`/api/imports/${(await upload.json()).id}`)).json()).status).toBe('done');
  await request.post('/api/divers', { headers, data: { name: 'Mia' } });
  const invite = await (await request.post('/api/invitations', { headers, data: { email: 'new@example.com' } })).json();
  const dives = await (await request.get('/api/dives')).json() as { id: string; number: number }[];
  const dive42 = dives.find((d) => d.number === 42)!.id;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/'); await page.getByRole('heading', { name: 'Logbook' }).waitFor();
  await capture(page, '01-logbook');
  await tabOrder(page, '01-logbook');
  await page.goto(`/#/dives/${dive42}`); await page.getByRole('heading', { name: /Dive 42/ }).waitFor();
  await capture(page, '02-dive');
  await tabOrder(page, '02-dive', 30);
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await capture(page, '03-dive-edit');
  await page.goto('/#/divers'); await page.getByRole('heading', { name: 'Devices' }).waitFor(); await page.locator('table').waitFor();
  await capture(page, '04-divers');
  await page.goto('/#/account'); await page.getByRole('heading', { name: 'My account' }).waitFor(); await page.locator('table').waitFor();
  await capture(page, '05-account');
  await page.goto('/#/admin'); await page.getByRole('heading', { name: 'Users' }).waitFor();
  await page.getByRole('textbox', { name: 'E-mail' }).fill('second@example.com');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  await page.getByText('Send this link to').waitFor();
  await capture(page, '06-admin');
  await tabOrder(page, '06-admin', 30);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/'); await page.getByRole('heading', { name: 'Logbook' }).waitFor();
  await capture(page, '07-logbook-dark', { aria: false });
  await setPreferences(request, { language: 'de' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.getByRole('heading', { name: 'Logbuch' }).waitFor();
  await capture(page, '08-logbook-de-phone', { aria: false });
  await page.goto(`/#/dives/${dive42}`); await page.getByRole('heading', { name: /Tauchgang 42/ }).waitFor();
  await capture(page, '09-dive-de-phone', { aria: false });
  await page.goto('/#/divers'); await page.getByRole('heading', { name: 'Geräte' }).waitFor();
  await capture(page, '10-divers-de-phone', { aria: false });
  await page.goto('/#/admin'); await page.getByRole('heading', { name: 'Benutzer' }).waitFor();
  await capture(page, '11-admin-de-phone', { aria: false });
  await setPreferences(request, { language: null });

  const fresh = await browser.newContext({ baseURL: E2E_BASE_URL, locale: 'en-GB', storageState: { cookies: [], origins: [] } });
  const p2 = await fresh.newPage();
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
  await p2.goto('/#/divers'); await p2.getByRole('heading', { name: 'Devices' }).waitFor(); await p2.waitForTimeout(500);
  await capture(p2, '15-empty-divers');
  await p2.goto('/#/dives/00000000-0000-7000-8000-000000000000'); await p2.waitForTimeout(800);
  await capture(p2, '16-dive-not-found', { aria: false });
  await fresh.close();

  writeFileSync(`${out}findings.json`, JSON.stringify(findings, null, 2));
});

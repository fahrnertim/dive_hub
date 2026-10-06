// AI access (ADR 0035) in a real browser: an admin switches the MCP endpoint on, a User creates an access, sees its key
// once, uses it as an LLM client would, sees what was read, and revokes it; switching off ends every key.
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, aiAccessReady, askMcp, createAiAccess, setPreferences } from './support.ts';

const headers = { origin: E2E_BASE_URL };

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});
test.afterEach(async ({ request }) => {
  await aiAccessReady(request);
});

test('an admin switches AI access on; a User creates one, uses its key, reads the log and revokes it', { tag: ['@account', '@admin'] }, async ({ page, request }) => {
  await aiAccessReady(request);
  await request.put('/api/admin/ai-access', { data: { enabled: false }, headers });

  // Off: the account page says so and offers nothing to create.
  await page.goto('/#/account');
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'AI access', exact: true }) });
  await expect(panel.getByText('AI access is switched off on this Dive Hub.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Create AI access' })).toHaveCount(0);
  await panel.getByRole('link', { name: 'Admin' }).click();

  const admin = page.locator('section', { has: page.getByRole('heading', { name: 'AI access', exact: true }) });
  await expect(admin.getByText('Off', { exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'Switch AI access on' }).click();
  await expect(admin.getByText('On', { exact: true })).toBeVisible();
  await expect(admin.getByText(/Switched on by Erika/)).toBeVisible();

  // On: what the AI provider gets is said before anything can be created.
  await page.goto('/#/account');
  await expect(panel.getByRole('heading', { name: 'What your AI provider gets' })).toBeVisible();
  await expect(panel.getByText('the names of the people you dived with, which is other people’s data')).toBeVisible();
  await expect(panel.getByText('You have no AI access yet.')).toBeVisible();
  await expect(panel.getByText('Nothing was read yet.')).toBeVisible();

  await panel.getByRole('textbox', { name: 'Name' }).fill('Claude Code on my laptop');
  await panel.getByText('Also allow the positions of my dives').click();
  await expect(panel.getByRole('checkbox', { name: /Also allow the positions of my dives/ })).toBeChecked();
  await panel.getByRole('button', { name: 'Create AI access' }).click();

  // The key, once, and lines that carry it and the endpoint.
  const key = await panel.getByRole('textbox', { name: 'Key' }).inputValue();
  expect(key).toMatch(/^dh_/);
  await expect(panel.getByRole('textbox', { name: 'Claude Code: run in a terminal' }))
    .toHaveValue(`claude mcp add --transport http dive-hub ${E2E_BASE_URL}/mcp --header "Authorization: Bearer ${key}"`);
  expect(JSON.parse(await panel.getByRole('textbox', { name: 'VS Code: content of .vscode/mcp.json' }).inputValue()))
    .toEqual({ servers: { 'dive-hub': { type: 'http', url: `${E2E_BASE_URL}/mcp`, headers: { Authorization: `Bearer ${key}` } } } });
  await expect(panel.getByRole('textbox', { name: 'Other assistants: the command for mcp-remote' })).toHaveValue(new RegExp(`^npx -y mcp-remote ${E2E_BASE_URL}/mcp `));
  const row = panel.getByRole('row', { name: /Claude Code on my laptop/ });
  await expect(row.getByRole('cell', { name: 'Logbook and positions' })).toBeVisible();
  await expect(row.getByRole('cell', { name: 'never' })).toBeVisible();

  await panel.getByRole('button', { name: 'Done, I copied the key' }).click();
  await expect(panel.getByRole('textbox', { name: 'Key' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Create AI access' })).toBeVisible();
  // Gone for good: a reload doesn't bring the key back.
  await page.reload();
  await expect(panel.getByRole('row', { name: /Claude Code on my laptop/ })).toBeVisible();
  expect(await page.content()).not.toContain(key);

  // An LLM client reads with the key; the page then says when and what.
  const answer = await askMcp(request, key, 'logbook_search_dives', { query: '42' });
  expect(answer.status()).toBe(200);
  expect(await answer.text()).toContain('"number\\":42');
  await askMcp(request, key, 'sites_get', { site_id: '00000000-0000-7000-8000-000000000000' });
  await page.reload();
  await expect(panel.getByRole('row', { name: /Claude Code on my laptop/ }).getByRole('cell', { name: 'never' })).toHaveCount(0);
  const log = panel.getByRole('region', { name: 'What was read' });
  await expect(log.getByRole('row', { name: /sites_get/ })).toContainText('refused: site_not_found');
  const searched = log.getByRole('row', { name: /logbook_search_dives/ });
  await expect(searched).toContainText('answered');
  // The search words stay out of the log.
  await expect(searched).toContainText('query: [text]');
  await expect(panel.getByText('2 of 2 requests')).toBeVisible();

  // Revoked: the key stops working at once; what it read stays.
  await panel.getByRole('button', { name: 'Revoke: Claude Code on my laptop' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Its key stops working at once.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(panel.getByText('You have no AI access yet.')).toBeVisible();
  expect((await askMcp(request, key, 'logbook_stats')).status()).toBe(401);
  await expect(log.getByRole('row', { name: /logbook_search_dives/ })).toBeVisible();
});

test('an admin switches AI access off, which ends every key, and revokes all accesses', { tag: ['@admin'] }, async ({ page, request }) => {
  await aiAccessReady(request);
  const first = await createAiAccess(request, 'First');
  await createAiAccess(request, 'Second');
  expect((await askMcp(request, first.key, 'divers_list')).status()).toBe(200);

  await page.goto('/#/admin');
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'AI access', exact: true }) });
  await expect(panel.getByText('Users have 2 AI accesses.')).toBeVisible();
  await panel.getByRole('button', { name: 'Switch AI access off…' }).click();
  await expect(page.getByRole('dialog').getByText('Every key stops working at once.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Switch AI access off' }).click();
  await expect(panel.getByText('Off', { exact: true })).toBeVisible();
  const refused = await askMcp(request, first.key, 'divers_list');
  expect(refused.status()).toBe(401);
  expect((await refused.json()).error_description).toContain('switched off');

  // Back on, the accesses work again; then all are revoked.
  await panel.getByRole('button', { name: 'Switch AI access on' }).click();
  await expect(panel.getByText('On', { exact: true })).toBeVisible();
  expect((await askMcp(request, first.key, 'divers_list')).status()).toBe(200);
  await panel.getByRole('button', { name: 'Revoke all AI accesses…' }).click();
  await expect(page.getByRole('dialog').getByText(/The keys of all 2 AI accesses stop working/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke all AI accesses' }).click();
  await expect(panel.getByText('Users have 0 AI accesses.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Revoke all AI accesses…' })).toHaveCount(0);
  expect((await askMcp(request, first.key, 'divers_list')).status()).toBe(401);
});

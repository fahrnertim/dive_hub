// The Oceanic+ app's logbook export (docs/references/oceanic-plus.md) in a real browser: the zip the app sends, as it
// is, with scuba dives and a breath-hold session. Both kinds are chosen; a nitrox dive shows its mix, at the local time
// the app meant. The fixture is anonymised from a real export (samples/README.md).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { cancelWaitingImports, headers, setPreferences } from './support.ts';

test.beforeEach(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
});

test('imports an Oceanic+ logbook export zip', { tag: ['@dives'] }, async ({ page, request }) => {
  await cancelWaitingImports(request);
  const upload = await request.post('/api/imports', {
    headers,
    multipart: { file: { name: 'Oceanic+ logbook.zip', mimeType: 'application/zip', buffer: readFileSync('e2e/fixtures/oceanic-plus.zip') } },
  });
  const url = `/api/imports/${(await upload.json() as { id: string }).id}`;
  const status = async () => (await (await request.get(url)).json() as { status: string }).status;
  // The first time, three scuba dives and a breath-hold session wait for the choice; the same file again is known.
  await expect.poll(status).toMatch(/^(awaiting_choice|done)$/);
  if (await status() === 'awaiting_choice') await request.post(`${url}/start`, { data: { kinds: ['scuba', 'apnea'] }, headers });
  await expect.poll(status).toBe('done');
  const { outcome } = await (await request.get(url)).json() as { outcome: { result: string; diveId?: string }[] };
  expect(outcome).toHaveLength(4);
  expect(outcome.every((o) => ['created', 'unchanged'].includes(o.result) && o.diveId)).toBe(true);

  // The app writes the offset as `+00:02`: two hours ahead of UTC, so 11:07 local is 09:07 UTC.
  const dives = await Promise.all(outcome.map(async (o) => ({ id: o.diveId!, ...await (await request.get(`/api/dives/${o.diveId}`)).json() as {
    fromRecording: { startsAt: { at: string; utcOffsetSeconds: number } };
  } })));
  const nitrox = dives.find((d) => d.fromRecording.startsAt.at === '2021-08-12T09:07:57.000Z');
  expect(nitrox?.fromRecording.startsAt.utcOffsetSeconds).toBe(7200);

  await page.goto(`/#/dives/${nitrox!.id}`);
  await expect(page.getByRole('img', { name: /depth/i }).first()).toBeVisible();
  await expect(page.getByText('EAN31').first()).toBeVisible();
});

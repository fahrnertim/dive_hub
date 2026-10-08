// Cylinders on a Dive in a real browser (ADR 0045, slice 2): typed in the Dive's form or filled from the catalogue,
// copied from the last dive, and made by an import from a tank pod's data.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL, openLine, resetDive, setPreferences, tankPodDive } from './support.ts';

const headers = { origin: E2E_BASE_URL };
type Cylinder = { gas: { o2: number; he: number } | null; series: object | null } & Record<string, unknown>;
type Dive = { id: string; version: number; cylinders: Cylinder[] };

const getDive = async (api: APIRequestContext, id: string) => (await (await api.get(`/api/dives/${id}`)).json()) as Dive;
async function setCylinders(api: APIRequestContext, id: string, cylinders: object[]) {
  const { version } = await getDive(api, id);
  expect((await api.patch(`/api/dives/${id}`, { data: { version, cylinders }, headers })).status()).toBe(200);
}

let diveId: string;

test.beforeEach(async ({ request }) => {
  diveId = (await resetDive(request)).id;
  await setCylinders(request, diveId, []);
});
test.afterEach(async ({ request }) => {
  await setCylinders(request, diveId, []);
  await setPreferences(request, { language: null, units: null });
});

test('adds a Cylinder from the facts: filled from the catalogue, typed, saved and in the history', { tag: ['@dives'] }, async ({ page }) => {
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Add cylinders' }).click();
  const cylinder = page.getByRole('group', { name: 'Cylinder 1' });
  await expect(cylinder.getByRole('textbox', { name: 'Volume' })).toBeFocused();
  await cylinder.getByRole('button', { name: /Fill in from a common cylinder/ }).click();
  await page.getByRole('option', { name: 'Steel 12 L, 232 bar' }).click();
  await expect(cylinder.getByRole('textbox', { name: 'Volume' })).toHaveValue('12');
  await expect(cylinder.getByRole('textbox', { name: 'Working pressure' })).toHaveValue('232');
  await cylinder.getByRole('textbox', { name: 'Oxygen' }).fill('32');
  await cylinder.getByRole('textbox', { name: 'Pressure at the start' }).fill('205');

  // An end pressure above the start is said at the Cylinder, and nothing is saved.
  await cylinder.getByRole('textbox', { name: 'Pressure at the end' }).fill('260');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(cylinder.getByRole('alert')).toHaveText('The pressure at the end is above the pressure at the start.');
  await cylinder.getByRole('textbox', { name: 'Pressure at the end' }).fill('60');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Cylinders' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: /^12 L, Steel, 232 bar, EAN32: 205 bar at the start, 60 bar at the end, 145 bar used$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add cylinders' })).toHaveCount(0);
  await openLine(page, 'History');
  await expect(page.locator('.history > li').first()).toContainText('Cylinders: 12 L, Steel, 232 bar, EAN32: 205 bar at the start');
});

test('a second Cylinder is added and one removed; a Cylinder left empty is not saved', { tag: ['@dives'] }, async ({ page, request }) => {
  await setCylinders(request, diveId, [{ volumeL: 12, material: 'steel', gas: { o2: 21, he: 0 } }]);
  await page.goto(`/#/dives/${diveId}`);
  await page.getByRole('button', { name: 'Edit dive' }).click();
  await page.getByRole('button', { name: 'Add cylinder' }).click();
  const stage = page.getByRole('group', { name: 'Cylinder 2' });
  await stage.getByRole('textbox', { name: 'Volume' }).fill('7');
  await stage.getByRole('textbox', { name: 'Oxygen' }).fill('50');
  await page.getByRole('button', { name: 'Add cylinder' }).click();
  await expect(page.getByRole('group', { name: 'Cylinder 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove cylinder 1' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: /^7 L, EAN50$/ })).toBeVisible();
  expect((await getDive(request, diveId)).cylinders).toMatchObject([{ volumeL: 7, gas: { o2: 50, he: 0 } }]);
});

test('"Same as last dive" fills the form with the last dive\'s Cylinders, their pressures left to type', { tag: ['@dives'] }, async ({ page, request }) => {
  // The Dive before the seeded one (2026) is the one with the tank pod (2025), unless another test put one between.
  await tankPodDive(request);
  const last = (await (await request.get(`/api/dives/${diveId}/same-as-last`)).json()) as { diveId: string };
  const before = (await getDive(request, last.diveId)).cylinders.map(({ fromPod: _mark, ...c }) => c);
  // A typed Cylinder after the ones it has: a pod's keeps its series, and so its mark.
  const typed = { volumeL: 15, workingPressureBar: 232, material: 'steel', gas: { o2: 28, he: 0 }, startPressureBar: 210, endPressureBar: 70 };
  await setCylinders(request, last.diveId, [...before, typed]);
  try {
    await page.goto(`/#/dives/${diveId}`);
    await page.getByRole('button', { name: 'Add cylinders' }).click();
    await page.getByRole('button', { name: 'Same as last dive' }).click();
    await expect(page.getByRole('group', { name: `Cylinder ${before.length + 1}` })).toBeVisible();
    // Nothing is saved until the User saves.
    expect((await getDive(request, diveId)).cylinders).toEqual([]);
    for (let n = before.length; n > 0; n--) await page.getByRole('button', { name: 'Remove cylinder 1' }).click();
    const cylinder = page.getByRole('group', { name: 'Cylinder 1' });
    await expect(cylinder.getByRole('textbox', { name: 'Volume' })).toHaveValue('15');
    await expect(cylinder.getByRole('textbox', { name: 'Oxygen' })).toHaveValue('28');
    await expect(cylinder.getByRole('textbox', { name: 'Pressure at the start' })).toHaveValue('');
    await cylinder.getByRole('textbox', { name: 'Pressure at the start' }).fill('200');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: /^15 L, Steel, 232 bar, EAN28: 200 bar at the start$/ })).toBeVisible();
  } finally {
    await setCylinders(request, last.diveId, before);
  }
});

test('a tank pod\'s Cylinder is there after the import, marked, and the profile speaks of it once it is changed', { tag: ['@dives'] }, async ({ page, request }) => {
  const podDive = await tankPodDive(request);
  const asImported = (await getDive(request, podDive)).cylinders.map(({ fromPod: _mark, ...c }) => c);
  try {
    await page.goto(`/#/dives/${podDive}`);
    const line = page.getByRole('listitem').filter({ hasText: /^12 L, EAN32: 200 bar at the start, 50 bar at the end, 150 bar used/ });
    await expect(line.getByText('From the tank pod')).toBeVisible();

    await page.getByRole('button', { name: 'Edit dive' }).click();
    const cylinder = page.getByRole('group', { name: /Cylinder 1/ });
    await expect(cylinder.getByRole('button', { name: /Pressure measured by/ })).toContainText(/Tank pod on .*Suunto D5/);
    await cylinder.getByRole('textbox', { name: 'Oxygen' }).fill('36');
    await page.getByRole('button', { name: 'Save' }).click();
    // Still the pod's: it kept the pod's series, and the strip's words follow the Cylinder.
    await expect(page.getByRole('listitem').filter({ hasText: /^12 L, EAN36: 200 bar at the start/ }).getByText('From the tank pod')).toBeVisible();
    await expect(page.getByText('EAN36, 12 L: 200 bar at the start, 50 bar at the end, 150 bar used.')).toBeVisible();

    // In psi, saving the form again changes nothing: untouched pressures are saved as they were.
    await setPreferences(request, { units: 'imperial' });
    const { version } = await getDive(request, podDive);
    await page.reload();
    await page.getByRole('button', { name: 'Edit dive' }).click();
    await expect(page.getByRole('group', { name: /Cylinder 1/ }).getByRole('textbox', { name: 'Pressure at the start' })).toHaveValue('2,907');
    await page.getByRole('textbox', { name: 'Notes' }).fill('Checked in psi');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Checked in psi')).toBeVisible();
    // The typed note shows in the form before the save has answered: wait for the save itself.
    await expect.poll(async () => (await getDive(request, podDive)).version).toBe(version + 1);
    const after = await getDive(request, podDive);
    expect(after.cylinders[0]).toMatchObject({ startPressureBar: expect.closeTo(200.4, 1), endPressureBar: expect.closeTo(50.1, 1), fromPod: true });
  } finally {
    const d = await getDive(request, podDive);
    await request.patch(`/api/dives/${podDive}`, { data: { version: d.version, cylinders: asImported, notes: null }, headers });
  }
});

test('SAC on this dive: L/min from the Cylinders, bar/min beside it for a single one, and what is missing when there is none', { tag: ['@dives'] }, async ({ page, request }) => {
  // 12 L of air from 201 to 51 bar is 1725.6 L with real gas; over 40 minutes at an average of 10 m: 21.57 L/min and
  // 1.875 bar/min (worked in the server's sac.test.ts).
  const air12 = { volumeL: 12, startPressureBar: 201, endPressureBar: 51 };
  const { version } = await getDive(request, diveId);
  await request.patch(`/api/dives/${diveId}`, { data: { version, set: { durationSeconds: 40 * 60, avgDepthM: 10 }, cylinders: [air12] }, headers });
  await page.goto(`/#/dives/${diveId}`);
  await expect(page.getByText('SAC on this dive: 21.6 L/min (1.9 bar/min)')).toBeVisible();

  // A 7 L stage of air from 201 to 101 bar adds 653.2 L: together 29.7 L/min, and no pressure drop for two Cylinders.
  await setCylinders(request, diveId, [air12, { volumeL: 7, startPressureBar: 201, endPressureBar: 101 }]);
  await page.reload();
  await expect(page.getByText(/^SAC on this dive: 29\.7 L\/min$/)).toBeVisible();

  await setCylinders(request, diveId, [air12, { volumeL: 7, startPressureBar: 201 }]);
  await page.reload();
  await expect(page.getByText('No SAC for this dive yet: it needs the volume and the pressure at the start and at the end of every cylinder.')).toBeVisible();

  await setPreferences(request, { language: 'de', units: 'imperial' });
  await setCylinders(request, diveId, [air12]);
  await page.reload();
  await expect(page.getByText(/^AMV bei diesem Tauchgang: 21,6 l\/min \(27 psi\/min\)$/)).toBeVisible();
});

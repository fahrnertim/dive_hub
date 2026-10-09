// The Tools page's gas numbers and bottom time (ADR 0032, slice 21) in a real browser: Tim's nitrox dive from the data
// model's scenario 6, the inputs kept in the address, units, "outside recreational limits", and the estimate notice that
// is always on the page. The figures are tested in the server's planning tests; here: what the page asks and says.
import { expect, test } from '@playwright/test';
import { expectGoodPage, setPreferences } from './support.ts';

test.beforeAll(async ({ request }) => setPreferences(request, { language: 'en', units: 'metric' }));
test.afterAll(async ({ request }) => setPreferences(request, { language: null, units: null }));

test('gas numbers and a bottom time for 30 m on EAN32, with the assumptions and the notice', { tag: ['@tools'] }, async ({ page }) => {
  await page.goto('/#/tools');
  await expectGoodPage(page, 'Tools');
  // The estimate notice is on the page before anything is typed.
  await expect(page.locator('#main').getByText(/estimate, not advice/i)).toBeVisible();
  await expect(page.locator('#main').getByText(/dive computer and your training govern/i)).toBeVisible();

  await page.getByRole('textbox', { name: /^Oxygen/ }).fill('32');
  await page.getByRole('textbox', { name: /^Depth/ }).fill('30');
  await page.getByRole('textbox', { name: /^Depth/ }).press('Tab');

  const gas = page.getByRole('region', { name: 'Gas' });
  // 33.44 m and 39.66 m, shown rounded down; 1.29 bar and 34 % at 30 m (planning-gas.test.ts).
  await expect(gas.getByText('MOD at 1.4 bar')).toBeVisible();
  await expect(gas.getByText('33.4 m')).toBeVisible();
  await expect(gas.getByText('39.6 m')).toBeVisible();
  await expect(gas.getByText('1.29 bar')).toBeVisible();
  await expect(gas.getByText('34 %')).toBeVisible();

  // The address keeps what was typed.
  await expect(page).toHaveURL(/#\/tools\?.*o2=32/);
  await expect(page).toHaveURL(/depth=30/);

  const cylinder = page.getByRole('group', { name: 'Cylinder' });
  await cylinder.getByRole('textbox', { name: /^Volume/ }).fill('11.1');
  await cylinder.getByRole('textbox', { name: /^Fill pressure/ }).fill('200');
  await cylinder.getByRole('textbox', { name: /^Fill pressure/ }).press('Tab');

  const bottom = page.getByRole('region', { name: 'Bottom time' });
  await expect(bottom.getByTestId('bottom-time')).toHaveText(/^\d+ min$/);
  await expect(bottom.getByText(/Limited by/)).toBeVisible();
  // Each limit is shown, and the values that were assumed say where they came from (the Diver's own computer, once
  // other tests have imported a Recording with a gradient factor, else the default).
  for (const limit of ['No-decompression limit', 'Oxygen', 'Gas']) await expect(bottom.getByRole('row', { name: new RegExp(`^${limit}`) })).toBeVisible();
  await expect(bottom.getByText(/^Gradient factor high: \d+ % \((default|from your computer)\)$/)).toBeVisible();
  await expect(bottom.getByText(/^Gas use: [\d.]+ L\/min \((default|from your recent dives)(, \d+ dives?)?\)$/)).toBeVisible();
  await expect(bottom.getByText('Water: salt (default)')).toBeVisible();
  await expect(bottom.getByText('No altitude given: sea level')).toBeVisible();
  await expect(bottom.getByText('Gas rule: Rock bottom (default)')).toBeVisible();
  await expect(bottom.getByText(/^The gas limit ends at \d+ bar, where you start up\.$/)).toBeVisible();
  await expect(page.locator('#main').getByText(/estimate, not advice/i)).toBeVisible();

  // A reload brings the same page back from the address.
  await page.reload();
  await expect(page.getByRole('textbox', { name: /^Oxygen/ })).toHaveValue('32');
  await expect(bottom.getByTestId('bottom-time')).toHaveText(/^\d+ min$/);
});

test('beyond the MOD there is no bottom time, only the reason and the MOD', { tag: ['@tools'] }, async ({ page }) => {
  await page.goto('/#/tools?o2=40&depth=36');
  const bottom = page.getByRole('region', { name: 'Bottom time' });
  await expect(bottom.getByText('Outside recreational limits')).toBeVisible();
  await expect(bottom.getByText(/beyond the MOD/)).toBeVisible();
  await expect(bottom.getByTestId('bottom-time')).toHaveCount(0);
  await expectGoodPage(page, 'Tools');

  // Deeper than 40 m.
  await page.goto('/#/tools?o2=21&depth=42');
  await expect(bottom.getByText(/deeper than 40 m/)).toBeVisible();

  // Trimix: gas numbers, no bottom time.
  await page.goto('/#/tools?o2=21&he=35&depth=30');
  await expect(page.getByRole('region', { name: 'Gas' }).getByText('MOD at 1.4 bar')).toBeVisible();
  await expect(bottom.getByText(/air and nitrox/i)).toBeVisible();
});

test('a mix under 16 % oxygen is refused with a reason', { tag: ['@tools'] }, async ({ page }) => {
  await page.goto('/#/tools?o2=15&he=50&depth=60');
  await expect(page.getByRole('alert')).toContainText(/16 %/);
});

test('imperial units: feet and psi in the fields and the answers, metres and bar in the address', { tag: ['@tools'] }, async ({ page, request }) => {
  await setPreferences(request, { units: 'imperial' });
  try {
    await page.goto('/#/tools?o2=32&depth=30&volume=11.1&pressure=200');
    // 30 m = 98 ft; the MOD at 1.4 bar, 33.4 m = 109.6 ft.
    await expect(page.getByRole('textbox', { name: /^Depth/ })).toHaveValue('98');
    await expect(page.getByRole('region', { name: 'Gas' }).getByText(/^109\.\d ft$/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Fill pressure/ })).toHaveValue('2,901');
    await expect(page).toHaveURL(/depth=30/);
  } finally {
    await setPreferences(request, { units: 'metric' });
  }
});

test('a gas plan for a group: levels and Divers as lists with one editor open, the profile, the controlling Diver, and the rule explained', { tag: ['@tools'] }, async ({ page }) => {
  // The plan stands on its own: nothing of "Your dive" is typed, and it plans with air.
  // The plan is a part of Tools with its own address; "Your dive" is not on it.
  await page.goto('/#/tools');
  const parts = page.getByRole('navigation', { name: 'Tools' });
  await expect(parts.getByRole('link', { name: 'Gas and bottom time' })).toHaveAttribute('aria-current', 'page');
  await parts.getByRole('link', { name: 'Gas plan' }).click();
  await expect(page).toHaveURL(/#\/tools\/plan$/);
  await expect(parts.getByRole('link', { name: 'Gas plan' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Your dive' })).toHaveCount(0);
  await expect(page.locator('#main').getByText(/estimate, not advice/i)).toBeVisible();
  await page.goto('/#/tools/plan?water=fresh');
  await expectGoodPage(page, 'Tools');
  const plan = page.getByRole('region', { name: 'Gas plan' });
  await expect(plan.getByText('Add a level and a Diver to see the plan.')).toBeVisible();
  await expect(plan.getByRole('textbox', { name: /^Mix/ })).toHaveAttribute('placeholder', '21');
  const levels = plan.getByRole('list', { name: 'Levels' }).getByRole('listitem');
  const divers = plan.getByRole('list', { name: 'Divers' }).getByRole('listitem');

  // A new level opens its fields under its line; "Done" folds them away.
  await plan.getByRole('button', { name: 'Add a level' }).click();
  const level = plan.getByRole('group', { name: 'Level 1' });
  await level.getByRole('textbox', { name: /^Depth/ }).fill('20');
  await level.getByRole('textbox', { name: /^Time/ }).fill('20');
  await level.getByRole('button', { name: 'Done' }).click();
  await expect(level).toHaveCount(0);
  await expect(plan.getByRole('button', { name: 'Edit level 1' })).toBeFocused();

  // The first level brings the User's own Diver. Their fields open from the pencil: a 12 L cylinder at 200 bar, 20 L/min.
  await expect(divers).toHaveText([/Erika/]);
  await plan.getByRole('button', { name: 'Edit Erika' }).click();
  const erika = plan.getByRole('group', { name: 'Erika' });
  await expect(erika.getByRole('textbox', { name: /^Volume/ })).toHaveValue('12');
  await erika.getByRole('textbox', { name: /^Gas use/ }).fill('20');
  await erika.getByRole('textbox', { name: /^Gas use/ }).press('Tab');

  // Someone who is no Diver here is a guest, by the name typed. Only one set of fields is open at a time.
  await plan.getByRole('button', { name: 'Add a Diver' }).click();
  await expect(erika).toHaveCount(0);
  await plan.getByRole('searchbox', { name: 'Find a diver' }).fill('Ann');
  await plan.getByRole('option', { name: /Add “Ann” as a guest/ }).click();
  const ann = plan.getByRole('group', { name: 'Ann' });
  await ann.getByRole('textbox', { name: /^Gas use/ }).fill('15');
  await ann.getByRole('button', { name: 'Done' }).click();
  await expect(divers).toHaveText([/Erika.*12 L.*200 bar.*20 L\/min/, /Ann.*12 L.*200 bar.*15 L\/min/]);

  // planning-gas-plan.test.ts: 1413 and 1060 litres; the higher SAC runs out of margin first.
  await expect(plan.getByTestId('plan-fits')).toContainText('The plan fits.');
  await expect(plan.getByTestId('plan-briefing')).toHaveText(/^Everyone follows Erika: we go up when anyone reaches their ascent pressure\.$/);
  const first = plan.getByRole('row', { name: /^Erika/ });
  await expect(first.getByText('Controls the plan')).toBeVisible();
  await expect(first.getByRole('cell').nth(1)).toHaveText('1413 L');
  await expect(plan.getByRole('row', { name: /^Ann/ }).getByRole('cell').nth(1)).toHaveText('1060 L');
  await expect(plan.getByText('Erika: gas use 20 L/min (entered)')).toBeVisible();
  await expect(plan.getByText('Gas rule: Rock bottom (default)')).toBeVisible();
  await expect(plan.getByText('Mix: air (default)')).toBeVisible();
  await expect(plan.getByText(/estimate, not advice/i)).toHaveCount(0);
  await expect(page.locator('#main').getByText(/estimate, not advice/i)).toBeVisible();

  // The way down, between and up is in the list with its minutes, and the whole plan is drawn like a dive's profile.
  await expect(levels).toHaveText([/Descent.*20 m.*1\.1 min/, /Level 1.*20 m.*20 min/, /Ascent.*5 m.*1\.7 min/, /Safety stop.*5 m.*3 min/, /Ascent.*0 m/]);
  await expect(plan.getByRole('img', { name: 'Planned profile' })).toBeVisible();
  await expect(plan.getByRole('img', { name: 'Planned pressure' })).toBeVisible();
  await expect(plan.getByText(/does not check the no-decompression limit/)).toBeVisible();

  // Any Diver of the instance can be found by name; of one the User doesn't manage nothing is read.
  await plan.getByRole('button', { name: 'Add a Diver' }).click();
  await plan.getByRole('searchbox', { name: 'Find a diver' }).fill('Bartholom');
  await plan.getByRole('option', { name: /Bartholomäus/ }).click();
  await expect(plan.getByRole('group', { name: /Bartholomäus/ }).getByText(/only they see their logbook/i)).toBeVisible();
  await expect(plan.getByText(/Bartholomäus.*: gas use 20 L\/min \(default\)/)).toBeVisible();
  await plan.getByRole('button', { name: /^Remove Bartholomäus/ }).click();
  await expect(divers).toHaveCount(2);

  // The address keeps the levels and the Divers; a reload brings the plan back.
  await expect(page).toHaveURL(/#\/tools\/plan\?.*lv=20x20/);
  await expect(page).toHaveURL(/dv=Erika(~|%7E)12(~|%7E)200(~|%7E)20(~|%7E)[0-9a-f-]{36}/);
  await expect(page).toHaveURL(/dv=Ann(~|%7E)12(~|%7E)200(~|%7E)15/);
  await page.reload();
  await expect(plan.getByTestId('plan-briefing')).toBeVisible();

  // The plan has its own mix, in its own place in the address; the mix of "Your dive" is not the plan's.
  await plan.getByRole('textbox', { name: /^Mix/ }).fill('32');
  await plan.getByRole('textbox', { name: /^Mix/ }).press('Tab');
  await expect(plan.getByText('Mix: nitrox 32 (entered)')).toBeVisible();
  await expect(page).toHaveURL(/mix=32/);
  await expect(page).not.toHaveURL(/o2=/);

  // The other part and back: the plan is still there, and the shared settings went along.
  await parts.getByRole('link', { name: 'Gas and bottom time' }).click();
  await expect(page).toHaveURL(/#\/tools\?water=fresh$/);
  await expect(page.getByRole('heading', { name: 'Your dive' })).toBeVisible();
  await expect(plan).toHaveCount(0);
  await parts.getByRole('link', { name: 'Gas plan' }).click();
  await expect(page).toHaveURL(/#\/tools\/plan\?.*mix=32.*lv=20x20/);
  await expect(plan.getByTestId('plan-briefing')).toBeVisible();

  // Turn rules show a turn pressure and say who they are for.
  // The water in the address keeps the settings open.
  await page.getByRole('button', { name: /Gas rule/ }).click();
  await page.getByRole('option', { name: 'Thirds' }).click();
  await expect(page.getByTestId('rule-explanation')).toContainText('overhead diving with training');
  await expect(plan.getByRole('columnheader', { name: 'Turn at' })).toBeVisible();
  await expect(plan.getByTestId('plan-briefing')).toContainText('we turn when anyone reaches their turn pressure');

  // A slower ascent is a setting: the way up takes longer, and the plan says what it assumed.
  await page.getByRole('textbox', { name: /^Ascent rate/ }).fill('6');
  await page.getByRole('textbox', { name: /^Ascent rate/ }).press('Tab');
  await expect(levels.nth(2)).toHaveText(/Ascent.*5 m.*2\.5 min/);
  await expect(plan.getByText('Descent 18 m/min (default), ascent 6 m/min (entered)')).toBeVisible();
  await expect(page).toHaveURL(/ar=6/);
  await expectGoodPage(page, 'Tools');
});

test('a gas plan that does not fit says when to leave, and one beyond the limits gives no numbers', { tag: ['@tools'] }, async ({ page }) => {
  const plan = page.getByRole('region', { name: 'Gas plan' });
  // The profile is there with the first level, before a mix or a Diver: the way down and up is already in the list.
  await page.goto('/#/tools/plan?lv=20x20');
  await expect(plan.getByRole('img', { name: 'Planned profile' })).toBeVisible();
  await expect(plan.getByRole('img', { name: 'Planned pressure' })).toHaveCount(0);
  await expect(plan.getByRole('list', { name: 'Levels' }).getByRole('listitem')).toHaveText([/Descent/, /Level 1/, /Ascent/, /Safety stop/, /Ascent/]);
  await expect(plan.getByText('Add a level and a Diver to see the plan.')).toBeVisible();
  // 40 minutes at 20 m for one Diver in a 12 L cylinder is more than the cylinder holds.
  await page.goto('/#/tools/plan?water=fresh&lv=20x40&dv=Tim~12~200~20~');
  await expect(plan.getByText('The plan does not fit.')).toBeVisible();
  await expect(plan.getByText(/Leave 20 m by minute \d+ at the latest/)).toBeVisible();
  await expect(plan.getByText(/The dashed line is minute \d+/)).toBeVisible();

  await page.goto('/#/tools/plan?lv=20x5,42x5&dv=Tim~12~200~20~');
  await expect(plan.getByText('Outside recreational limits')).toBeVisible();
  await expect(plan.getByText(/deeper than 40 m/)).toBeVisible();
  await expect(plan.getByRole('table')).toHaveCount(0);
  await expect(plan.getByRole('img')).toHaveCount(0);
  // Nitrox 40 at 30 m is beyond its MOD: the plan's own mix decides, and there is no picture.
  await page.goto('/#/tools/plan?mix=40&lv=30x10&dv=Tim~12~200~20~');
  await expect(plan.getByText('Outside recreational limits')).toBeVisible();
  await expect(plan.getByRole('img')).toHaveCount(0);
  await page.goto('/#/tools/plan?lv=20x5,42x5&dv=Tim~12~200~20~');
  await expect(plan.getByText('Outside recreational limits')).toBeVisible();
  // An address from before the plan had its own part still opens the plan.
  await page.goto('/#/tools?lv=20x20&dv=Tim~12~200~20~');
  await expect(plan.getByTestId('plan-fits')).toBeVisible();
  await page.goto('/#/tools/plan?lv=20x5,42x5&dv=Tim~12~200~20~');
  await expect(plan.getByText('Outside recreational limits')).toBeVisible();
  // A level removed with its bin leaves the others.
  await plan.getByRole('button', { name: 'Remove level 2' }).click();
  await expect(plan.getByTestId('plan-fits')).toBeVisible();
  await expect(page).toHaveURL(/lv=20x5&/);
});

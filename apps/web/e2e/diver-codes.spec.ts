// Buddy and professional codes (ADR 0043, slice 3) in a real browser: a diver is added from the pasted text of a
// professional's code and shows both codes; the details are edited and the professional's code goes with the leader
// number; a code of someone already here says so; and a professional on a dive puts their code on that dive.
// The person, account, e-mail and leader number are made up: no real person's code is in this repository.
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, clearParticipants, forgetDivers, resetDive, setBuddies } from './support.ts';

const headers = { origin: E2E_BASE_URL };
const NAME = 'Pia Probe';
const CODE = 'buddy;4600001;firstName:Pia;lastName:Probe;email:pia@example.com;leaderNr:70001';

test.describe.configure({ mode: 'serial' });

const forget = async (request: Parameters<typeof forgetDivers>[0]) => {
  const dive = await resetDive(request);
  await clearParticipants(request, dive.id);
  await forgetDivers(request, NAME);
};
test.beforeAll(async ({ request }) => forget(request));
test.afterAll(async ({ request }) => forget(request));

test('a diver is added from the text of a professional’s code, and shows both codes', { tag: ['@divers'] }, async ({ page }) => {
  await page.goto('/#/divers');
  const others = page.locator('section', { has: page.getByRole('heading', { name: 'Other divers' }) });
  await others.getByRole('button', { name: 'Add from a code' }).click();
  const scan = page.getByRole('dialog', { name: 'Add a diver from an SSI code' });
  const text = scan.getByRole('textbox', { name: 'Text of the code (optional)' });

  // A centre's code is told apart, and nothing of it is taken.
  await text.fill('center;999001;name:Tauchbasis Beispiel');
  await scan.getByRole('button', { name: 'Read code' }).click();
  await expect(scan.getByText('This is a dive centre’s code, not a diver’s.')).toBeVisible();

  await text.fill(CODE);
  await scan.getByRole('button', { name: 'Read code' }).click();
  await expect(scan.getByText(`The professional’s code of ${NAME}. No diver here has this SSI account yet.`)).toBeVisible();
  await expect(scan.getByRole('radio', { name: `A new diver: ${NAME}` })).toBeChecked();
  // Said before anything is saved: everyone here will see the e-mail.
  await expect(scan.getByText('Everyone on this Dive Hub then sees these details.')).toBeVisible();
  await scan.getByRole('button', { name: 'Add as a new diver' }).click();

  const codes = page.getByRole('dialog', { name: `${NAME}: codes and details` });
  await expect(codes.getByRole('img', { name: `SSI buddy code: ${NAME}` })).toBeVisible();
  await expect(codes.getByRole('img', { name: `SSI professional’s code: ${NAME}` })).toBeVisible();
  await expect(codes.getByText('pia@example.com')).toBeVisible();
  await expect(codes.getByText('4600001')).toBeVisible();
  await codes.getByRole('button', { name: 'Done' }).click();
  await expect(others.getByRole('listitem').filter({ hasText: NAME })).toContainText('SSI account known');
});

test('the details are edited where the codes are shown; without a leader number there is no professional’s code', { tag: ['@divers'] }, async ({ page }) => {
  await page.goto('/#/divers');
  await page.getByRole('button', { name: `Codes: ${NAME}` }).click();
  const codes = page.getByRole('dialog', { name: `${NAME}: codes and details` });
  await codes.getByRole('button', { name: 'Edit details' }).click();
  await codes.getByRole('textbox', { name: 'SSI leader number' }).fill('');
  await codes.getByRole('button', { name: 'Save' }).click();
  await expect(codes.getByRole('img', { name: `SSI buddy code: ${NAME}` })).toBeVisible();
  await expect(codes.getByRole('img', { name: `SSI professional’s code: ${NAME}` })).toHaveCount(0);

  // Without the e-mail no code can be built, and the page says what is missing.
  await codes.getByRole('button', { name: 'Edit details' }).click();
  await codes.getByRole('textbox', { name: 'E-mail' }).fill('');
  await codes.getByRole('button', { name: 'Save' }).click();
  await expect(codes.getByText('No code yet. It needs the SSI account, first name, last name and e-mail.')).toBeVisible();
});

test('the code of a diver already here shows what taking it changes', { tag: ['@divers'] }, async ({ page }) => {
  await page.goto('/#/divers');
  await page.getByRole('button', { name: 'Add from a code' }).click();
  const scan = page.getByRole('dialog', { name: 'Add a diver from an SSI code' });
  await scan.getByRole('textbox', { name: 'Text of the code (optional)' }).fill(CODE);
  await scan.getByRole('button', { name: 'Read code' }).click();
  await expect(scan.getByText(`This is the professional’s code of ${NAME}.`)).toBeVisible();
  await expect(scan.getByRole('listitem').filter({ hasText: 'E-mail' })).toContainText('Not set → pia@example.com');
  await expect(scan.getByRole('listitem').filter({ hasText: 'SSI leader number' })).toContainText('Not set → 70001');
  await scan.getByRole('button', { name: 'Take over' }).click();
  const codes = page.getByRole('dialog', { name: `${NAME}: codes and details` });
  await expect(codes.getByRole('img', { name: `SSI professional’s code: ${NAME}` })).toBeVisible();
});

test('a dive a professional was on shows the professional’s code', { tag: ['@divers', '@dives'] }, async ({ page, request }) => {
  const dive = await resetDive(request);
  const { divers } = await (await request.get(`/api/external-divers?q=${encodeURIComponent(NAME)}`)).json() as { divers: { id: string }[] };
  await setBuddies(request, dive.id, [divers[0]!.id]);
  await page.goto(`/#/dives/${dive.id}`);
  const line = page.getByRole('button', { name: /^Verification codes?$/ });
  if (await line.getAttribute('aria-expanded') !== 'true') await line.click();
  await expect(page.getByRole('img', { name: `SSI verification code of a dive professional: ${NAME}` })).toBeVisible();
  // Off the dive, the code is gone from it.
  await clearParticipants(request, dive.id);
  await page.reload();
  await expect(page.getByRole('img', { name: `SSI verification code of a dive professional: ${NAME}` })).toHaveCount(0);
});

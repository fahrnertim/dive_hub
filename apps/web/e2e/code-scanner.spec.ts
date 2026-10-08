// The scanner for verification codes in a real browser (ADR 0043, slice 2): a code is read from an image file and by
// the camera, and its text goes to the server, which says what it is.
// The camera here is a stream drawn on a canvas in the page: it proves the scanner's own steps (the picture, the
// reading, stopping the camera), not the browser's permission prompt or a real camera.
// The centre numbers and names are made up: no real centre's code is in this repository.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { encode } from 'uqr';
import { E2E_BASE_URL, expectGoodPage, setPreferences } from './support.ts';

test.describe.configure({ mode: 'serial' });

const headers = { origin: E2E_BASE_URL };
const CENTRE = 'Scanner Divers GmbH, Musterstadt';
const CODE = `center;700101;name:${CENTRE}`;
const BUDDY_CODE = 'buddy;1234567;firstName:Erika;lastName:Example;email:erika@example.com';

/** The modules of a text's QR code, as the client draws it. */
const modules = (text: string) => encode(text, { ecc: 'M', border: 4 }).data;

/** A text's QR code as a BMP file, 6 pixels per module; `null` gives a white picture without a code. */
function picture(text: string | null) {
  const rows = text ? modules(text) : Array.from({ length: 40 }, () => Array<boolean>(40).fill(false));
  const scale = 6;
  const side = rows.length * scale;
  const rowBytes = Math.ceil((side * 3) / 4) * 4;
  const file = Buffer.alloc(54 + rowBytes * side, 255);
  file.write('BM', 0, 'latin1');
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(0, 6);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(side, 18);
  // A negative height: the rows run from the top.
  file.writeInt32LE(-side, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(0, 30);
  file.writeUInt32LE(rowBytes * side, 34);
  file.writeUInt32LE(2835, 38);
  file.writeUInt32LE(2835, 42);
  file.writeUInt32LE(0, 46);
  file.writeUInt32LE(0, 50);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (rows[Math.floor(y / scale)]![Math.floor(x / scale)]) file.fill(0, 54 + y * rowBytes + x * 3, 54 + y * rowBytes + x * 3 + 3);
    }
  }
  return { name: 'code.bmp', mimeType: 'image/bmp', buffer: file };
}

/** Chooses a file with the "Read from image" button. */
async function chooseImage(page: Page, file: ReturnType<typeof picture>) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Read from image' }).click();
  await (await chooser).setFiles(file);
}

/**
 * Gives the page a camera that shows a text's QR code, or a white wall for `null`: a canvas, redrawn so that frames
 * keep coming. The tracks it hands out are kept on `window.cameraTracks`, to see that the scanner stops them.
 */
async function cameraShowing(page: Page, text: string | null) {
  await page.addInitScript((rows: boolean[][]) => {
    const tracks: MediaStreamTrack[] = [];
    Object.assign(window, { cameraTracks: tracks });
    const getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      const scale = 8;
      canvas.width = canvas.height = rows[0]!.length * scale;
      const context = canvas.getContext('2d')!;
      const draw = () => {
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#000';
        rows.forEach((row, y) => row.forEach((dark, x) => { if (dark) context.fillRect(x * scale, y * scale, scale, scale); }));
      };
      draw();
      setInterval(draw, 50);
      const stream = canvas.captureStream(20);
      tracks.push(...stream.getTracks());
      return stream;
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  }, text ? modules(text) : [Array<boolean>(40).fill(false)]);
}

/** Gives the page a camera that fails with a DOMException of this name. */
async function cameraFailing(page: Page, name: string) {
  await page.addInitScript((errorName: string) => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => { throw new DOMException('', errorName); } },
    });
  }, name);
}

/** Deletes the centres an earlier run of this story left behind. */
async function forgetCentres(api: APIRequestContext) {
  const { centres } = await (await api.get('/api/dive-centres?q=Scanner+Divers')).json() as { centres: { id: string }[] };
  for (const c of centres) await api.delete(`/api/dive-centres/${c.id}`, { headers });
}

async function newCentreForm(page: Page) {
  await page.goto('/#/centres');
  await page.getByRole('button', { name: 'New dive centre' }).click();
  await expect(page.getByRole('button', { name: 'Create dive centre' })).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  await setPreferences(request, { language: null, units: null });
  await forgetCentres(request);
});

test.afterAll(async ({ request }) => {
  await forgetCentres(request);
});

test('a centre’s code is read from an image file', { tag: ['@sites'] }, async ({ page }) => {
  await newCentreForm(page);

  await chooseImage(page, picture(null));
  await expect(page.getByText('No QR code was found in this image.')).toBeVisible();

  // A diver's code is told apart, and nothing of it is taken: not into a field either.
  await chooseImage(page, picture(BUDDY_CODE));
  await expect(page.getByText('This is a diver’s buddy code, not a dive centre’s.')).toBeVisible();
  await expect(page.getByText('No QR code was found in this image.')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Text of the centre’s SSI code (optional)' })).toHaveValue('');

  await chooseImage(page, picture(CODE));
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(CENTRE);
  await expect(page.getByRole('textbox', { name: 'SSI centre number (optional)' })).toHaveValue('700101');
  await expectGoodPage(page, 'Dive centres');
});

test('a centre’s code is scanned with the camera, and the camera is stopped', { tag: ['@sites'] }, async ({ page }) => {
  await cameraShowing(page, CODE);
  await newCentreForm(page);

  await page.getByRole('button', { name: 'Scan with camera' }).click();
  // The dialog closes by itself once the code is read.
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(CENTRE);
  await expect(page.getByRole('textbox', { name: 'SSI centre number (optional)' })).toHaveValue('700101');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { cameraTracks: MediaStreamTrack[] }).cameraTracks.map((t) => t.readyState))).toEqual(['ended']);
  await expect(page.getByRole('button', { name: 'Scan with camera' })).toBeFocused();

  await page.getByRole('button', { name: 'Create dive centre' }).click();
  await expect(page.getByRole('img', { name: 'SSI verification code of Scanner Divers GmbH' })).toBeVisible();
});

test('closing the scanner stops the camera', { tag: ['@sites'] }, async ({ page }) => {
  // Nothing to read in front of the camera: the scanner stays open.
  await cameraShowing(page, null);
  await newCentreForm(page);
  await page.getByRole('button', { name: 'Scan with camera' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scan code' });
  await expect(dialog.getByText('Hold the QR code in front of the camera.')).toBeVisible();
  await expectGoodPage(page, 'Dive centres');
  await dialog.getByRole('button', { name: 'Close scanner' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { cameraTracks: MediaStreamTrack[] }).cameraTracks.map((t) => t.readyState))).toEqual(['ended']);
});

for (const [name, text] of [
  ['NotAllowedError', 'The camera is blocked for this page. Allow it in the browser’s settings for this page and try again, or read the code from an image.'],
  ['NotFoundError', 'No camera was found. Read the code from an image instead.'],
  ['NotReadableError', 'The camera could not be started. Another app may be using it.'],
] as const) {
  test(`a camera that fails with ${name} is explained, and can be tried again`, { tag: ['@sites'] }, async ({ page }) => {
    await cameraFailing(page, name);
    await newCentreForm(page);
    await page.getByRole('button', { name: 'Scan with camera' }).click();
    const dialog = page.getByRole('dialog', { name: 'Scan code' });
    await expect(dialog.getByText(text)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expectGoodPage(page, 'Dive centres');
    await dialog.getByRole('button', { name: 'Close scanner' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('without a camera in the browser, the scanner says why', { tag: ['@sites'] }, async ({ page }) => {
  // What a page opened over plain HTTP on the home network sees: no `navigator.mediaDevices`.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  });
  await newCentreForm(page);
  await page.getByRole('button', { name: 'Scan with camera' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scan code' });
  await expect(dialog.getByText('The browser only gives a page the camera over HTTPS. Read the code from an image instead.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('a centre’s SSI number is read from an image of its code', { tag: ['@sites'] }, async ({ page, request }) => {
  const centre = await (await request.post('/api/dive-centres', { headers, data: { name: 'Scanner Divers Two, Musterstadt' } })).json() as { id: string };
  await page.goto(`/#/centres/${centre.id}`);
  await page.getByRole('button', { name: 'Add: SSI centre number' }).click();

  await chooseImage(page, picture(BUDDY_CODE));
  await expect(page.getByText('This is a diver’s buddy code, not a dive centre’s.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'SSI centre number' })).toHaveValue('');

  await chooseImage(page, picture('center;700102;name:Scanner Divers Two, Musterstadt'));
  await expect(page.getByRole('textbox', { name: 'SSI centre number' })).toHaveValue('700102');
  // Without a number the centre shows its whole name; the shorter one is the rule of the Source it has an ID at.
  await expectGoodPage(page, 'Scanner Divers Two, Musterstadt');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('dl.facts')).toContainText('700102');
  await expect(page.getByRole('img', { name: 'SSI verification code of Scanner Divers Two' })).toBeVisible();
});

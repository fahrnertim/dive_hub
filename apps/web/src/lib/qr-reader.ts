// Reading a QR code from a picture (ADR 0043, the scanner): the browser's own detector where it reads QR codes
// (Chrome on Android and macOS), and the library `qr` everywhere else and whenever the detector finds nothing.
// Only the text is read here; what it means is the server's (POST /api/verification-codes/read).
import decodeQR from 'qr/decode.js';

/** Pixels as a canvas gives them (RGBA); an `ImageData` is one. */
export type Picture = { width: number; height: number; data: Uint8ClampedArray };

type Detector = { detect: (source: ImageData) => Promise<{ rawValue: string }[]> };
type DetectorClass = { new (options: { formats: string[] }): Detector; getSupportedFormats: () => Promise<string[]> };

let known: { from: DetectorClass; detector: Promise<Detector | null> } | null = null;

/** The browser's detector, when it has one that reads QR codes. */
function browserDetector(): Promise<Detector | null> {
  const from = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!from) return Promise.resolve(null);
  if (known?.from !== from) {
    known = {
      from,
      detector: from.getSupportedFormats()
        .then((formats) => (formats.includes('qr_code') ? new from({ formats: ['qr_code'] }) : null))
        .catch(() => null),
    };
  }
  return known.detector;
}

/** The text of the QR code in a picture, or null when none is found. */
export async function readQr(picture: Picture): Promise<string | null> {
  const detector = await browserDetector();
  if (detector) {
    try {
      const found = (await detector.detect(picture as ImageData))[0]?.rawValue;
      if (found) return found;
    } catch {
      // The detector can fail on a platform that lists the format; the library reads the picture instead.
    }
  }
  try {
    return decodeQR(picture) || null;
  } catch {
    // The library throws when it finds no code: a missed frame, not an error.
    return null;
  }
}

/** The longer side a picture is scaled down to before reading: a phone's photo is far larger than a code needs. */
const LONGEST_SIDE = 1600;

/** The pixels of a video frame or an image, scaled down to `longest` on its longer side. */
export function pictureOf(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement, longest = LONGEST_SIDE): ImageData | null {
  if (!width || !height) return null;
  const scale = Math.min(1, longest / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** The text of the QR code in an image file, or null when the file is no image or holds no code. */
export async function readQrFromFile(file: Blob): Promise<string | null> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const picture = pictureOf(image, image.width, image.height, document.createElement('canvas'));
    return picture ? await readQr(picture) : null;
  } finally {
    image.close();
  }
}

// Reading a QR code from a picture (ADR 0043, the scanner). The pictures are drawn here with the library the client
// draws codes with; the centre is made up.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encode } from 'uqr';
import { readQr, type Picture } from '../src/lib/qr-reader.ts';

/** A text as the client draws it (error correction M, quiet zone 4), `scale` pixels per module. */
function drawn(text: string, scale = 4): Picture {
  const code = encode(text, { ecc: 'M', border: 4 });
  const side = code.size * scale;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const value = code.data[Math.floor(y / scale)]![Math.floor(x / scale)] ? 0 : 255;
      data.set([value, value, value, 255], (y * side + x) * 4);
    }
  }
  return { width: side, height: side, data };
}

const blank = (): Picture => ({ width: 120, height: 120, data: new Uint8ClampedArray(120 * 120 * 4).fill(255) });

afterEach(() => vi.unstubAllGlobals());

describe('reading a QR code from a picture', () => {
  it('gives the text of a centre’s code', async () => {
    expect(await readQr(drawn('center;700001;name:Example Divers GmbH, Musterstadt'))).toBe('center;700001;name:Example Divers GmbH, Musterstadt');
  });

  it('keeps umlauts', async () => {
    expect(await readQr(drawn('center;700002;name:Tauchschule Müßig & Söhne, Überstadt'))).toBe('center;700002;name:Tauchschule Müßig & Söhne, Überstadt');
  });

  it('reads a code drawn one pixel per module', async () => {
    expect(await readQr(drawn('center;700001;name:Example Divers GmbH, Musterstadt', 1))).toBe('center;700001;name:Example Divers GmbH, Musterstadt');
  });

  it('gives nothing for a picture without a code', async () => {
    expect(await readQr(blank())).toBeNull();
  });

  it('asks the browser’s own detector first, where it reads QR codes', async () => {
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => ['ean_13', 'qr_code'];
      detect = async () => [{ rawValue: 'center;700003;name:From The Browser, Musterstadt' }];
    });
    expect(await readQr(blank())).toBe('center;700003;name:From The Browser, Musterstadt');
  });

  it('reads the code itself when the browser’s detector finds none or fails', async () => {
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => ['qr_code'];
      detect = async () => { throw new Error('detector unavailable'); };
    });
    expect(await readQr(drawn('center;700001;name:Example Divers GmbH, Musterstadt'))).toBe('center;700001;name:Example Divers GmbH, Musterstadt');
  });

  it('doesn’t ask a detector that reads no QR codes', async () => {
    const detect = vi.fn(async () => [{ rawValue: 'wrong' }]);
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => ['ean_13'];
      detect = detect;
    });
    expect(await readQr(blank())).toBeNull();
    expect(detect).not.toHaveBeenCalled();
  });
});

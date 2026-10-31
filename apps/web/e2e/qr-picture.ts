// A QR code as a picture file for the scanner's "Read from image" (code-scanner.spec.ts, buddies.spec.ts).
import encodeQR from 'qr';

/** The modules of a text's QR code, as the client draws it. */
export const modules = (text: string) => encodeQR(text, 'raw', { ecc: 'medium', border: 4 });

/** A text's QR code as a BMP file, 6 pixels per module; `null` gives a white picture without a code. */
export function picture(text: string | null) {
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

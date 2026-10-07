import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * A text drawn as a QR code (ADR 0043): the text comes from the API and is drawn unchanged, as UTF-8 bytes. Dark on
 * white with the quiet zone in both themes, since a scanner needs that contrast. Whether SSI's app reads a name with
 * an umlaut this way isn't known: no code with one has been seen (owner, 2026-10-08).
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = encode(text, { ecc: 'M', border: 4 });
    let d = '';
    code.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return { size: code.size, path: d };
  }, [text]);
  return (
    <svg className="qr-code" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect className="qr-code-paper" width={size} height={size} />
      <path className="qr-code-ink" d={path} />
    </svg>
  );
}

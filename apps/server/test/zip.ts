// Builds zip files for tests (yazl, a dev dependency): SSI's site list arrives as a zip (ADR 0025).
import { readFileSync } from 'node:fs';
import yazl from 'yazl';

export async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, data] of Object.entries(files)) zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** The hand-made site list in SSI's format (test/fixtures/site-sources/ssi-sites.json), zipped as SSI ships it. */
export const ssiSitesZip = (overrides?: (file: { divesites: Record<string, unknown>[] }) => void) => {
  const file = JSON.parse(readFileSync(new URL('./fixtures/site-sources/ssi-sites.json', import.meta.url), 'utf8')) as { divesites: Record<string, unknown>[] };
  overrides?.(file);
  return zipOf({ 'sites.json': JSON.stringify(file) });
};

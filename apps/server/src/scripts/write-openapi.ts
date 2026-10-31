// Writes the OpenAPI description without a database, for generating the web client's API types.
// It includes the Better Auth endpoints we expose, described by Better Auth itself.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import { auth } from '../auth/cli-config.js';
import { createServices } from '../compose.js';
import type { Db } from '../db/client.js';
import { createSsiAdapter } from '../providers/ssi/ssi-adapter.js';
import type { SsiClient } from '../providers/ssi/ssi-client.js';
import { createSecretBox } from '../secrets/secret-box.js';
import type { SiteSourceAdapter } from '../sites/import/site-source.js';
import type { ImportSource } from '../sites/sources.js';
import type { BlobStore } from '../storage/blob-store.js';

// The services as main.ts builds them, over no database: describing the routes calls none of them.
const services = createServices({
  db: {} as Db, blobs: {} as BlobStore, auth, secrets: createSecretBox(undefined), siteSources: {} as Record<ImportSource, SiteSourceAdapter>,
  // The production Providers: their ids become the routes' enum.
  adapters: [createSsiAdapter({ client: {} as SsiClient })],
});
const app = await buildApp({ ...services, baseUrl: 'http://localhost', maxUploadBytes: 1 });
const response = await app.inject({ method: 'GET', url: '/api/openapi.json' });
const out = fileURLToPath(new URL('../../../../packages/api-client/openapi.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(response.json(), null, 2)}\n`);
await app.close();
console.log(`wrote ${out}`);

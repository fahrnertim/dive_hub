// Writes the OpenAPI description without a database, for generating the web client's API types.
// It includes the Better Auth endpoints we expose, described by Better Auth itself.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import { auth } from '../auth/cli-config.js';
import type { Db } from '../db/client.js';
import type { ImportService } from '../imports/import-service.js';
import type { BlobStore } from '../storage/blob-store.js';
import type { Invitations } from '../users/invitations.js';
import type { Setup } from '../users/setup.js';

const app = await buildApp({
  db: {} as Db, imports: {} as ImportService, blobs: {} as BlobStore, auth, setup: {} as Setup, invitations: {} as Invitations,
  baseUrl: 'http://localhost', maxUploadBytes: 1,
});
const response = await app.inject({ method: 'GET', url: '/api/openapi.json' });
const out = fileURLToPath(new URL('../../../../packages/api-client/openapi.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(response.json(), null, 2)}\n`);
await app.close();
console.log(`wrote ${out}`);

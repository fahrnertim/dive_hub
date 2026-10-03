// Writes the OpenAPI description without a database, for generating the web client's API types.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import type { Auth } from '../auth/auth.js';
import type { Db } from '../db/client.js';
import type { ImportService } from '../imports/import-service.js';
import type { Invitations } from '../users/invitations.js';
import type { Setup } from '../users/setup.js';

const app = await buildApp({
  db: {} as Db, imports: {} as ImportService, auth: {} as Auth, setup: {} as Setup, invitations: {} as Invitations,
  baseUrl: 'http://localhost', maxUploadBytes: 1,
});
await app.ready();
const out = fileURLToPath(new URL('../../../../packages/api-client/openapi.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`wrote ${out}`);

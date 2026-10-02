// Writes the OpenAPI description without a database, for generating the web client's API types.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import type { ImportService } from '../imports/import-service.js';

const app = await buildApp({
  db: {} as Db, imports: {} as ImportService, maxUploadBytes: 1, currentUserId: () => 'openapi',
});
await app.ready();
const out = fileURLToPath(new URL('../../../../packages/api-client/openapi.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`wrote ${out}`);

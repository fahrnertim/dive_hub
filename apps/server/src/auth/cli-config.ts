// Entry point for the pinned Better Auth CLI, used only to generate src/db/auth-schema.ts:
//   pnpm --filter @dive-hub/server auth:generate
// Migrations are then generated with drizzle-kit, reviewed and committed (ADR 0008, 0011).
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Db } from '../db/client.js';
import { createAuth } from './auth.js';

export const auth = createAuth({
  db: drizzle.mock() as unknown as Db,
  baseUrl: 'http://localhost:3000',
  secret: 'schema-generation-only-not-a-real-secret',
});

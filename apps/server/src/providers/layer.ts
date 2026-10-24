// The provider layer of one app (ADR 0027): the registry, Connections, Pushes and their leases, the account's list
// of people (ADR 0029) and importing its dives (ADR 0030), built from the adapters this instance has. main.ts passes the
// production adapters; tests pass the fake SSI and a test-only adapter.
import type { Db } from '../db/client.js';
import { createDiverService } from '../divers/diver-service.js';
import type { SecretBox } from '../secrets/secret-box.js';
import type { BlobStore } from '../storage/blob-store.js';
import { createCertificationService } from '../certifications/certification-service.js';
import { createBuddyService } from './buddy-service.js';
import { createConflictService } from './conflicts.js';
import { createConnectionService } from './connection-service.js';
import { createDiveImportService } from './dive-import.js';
import { createGoneDiveService } from './gone-dives.js';
import { createLeases, type Clock } from './leases.js';
import type { ProviderAdapter } from './provider.js';
import { createPushRunService } from './push-run-service.js';
import { createPushService } from './push-service.js';
import { createProviderRegistry } from './registry.js';

export function createProviderLayer(deps: { db: Db; secrets: SecretBox; blobs: BlobStore; adapters: ProviderAdapter[]; clock?: Clock }) {
  const providers = createProviderRegistry(deps.adapters);
  const leases = createLeases({ db: deps.db, ...(deps.clock && { clock: deps.clock }) });
  const connections = createConnectionService({ db: deps.db, registry: providers, secrets: deps.secrets, leases });
  const pushes = createPushService({ db: deps.db, blobs: deps.blobs, registry: providers, connections, leases });
  const pushRuns = createPushRunService({ db: deps.db, registry: providers, pushes });
  const buddies = createBuddyService({ registry: providers, connections, divers: createDiverService(deps.db) });
  const diveImports = createDiveImportService({ db: deps.db, blobs: deps.blobs, registry: providers, connections });
  const goneDives = createGoneDiveService({ db: deps.db, registry: providers, connections, leases });
  const conflicts = createConflictService({ db: deps.db, connections });
  const certifications = createCertificationService({ db: deps.db, blobs: deps.blobs, registry: providers, connections });
  return { providers, connections, pushes, pushRuns, buddies, diveImports, goneDives, conflicts, certifications };
}

export type ProviderLayer = ReturnType<typeof createProviderLayer>;

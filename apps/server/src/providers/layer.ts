// The provider layer of one app (ADR 0027): the registry, Connections, Pushes and their leases, the account's list
// of people (ADR 0029), importing its dives (ADR 0030), also on a schedule, and the Waiting pushes the worker sends (ADR 0056), built from
// the adapters this instance has. main.ts passes the production adapters; tests pass the fake SSI and a test-only adapter.
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
import { createScheduledFetch } from './scheduled-fetch.js';
import { createSitePickService } from './site-pick.js';
import { createWaitingPushService, type ProviderLog } from './waiting-push-service.js';
import { consoleLog, noteDiveChange, noteSiteChange } from './waiting-push-queue.js';
import { listenToChanges } from '../dives/revisions.js';

export function createProviderLayer(deps: {
  db: Db; secrets: SecretBox; blobs: BlobStore; adapters: ProviderAdapter[]; clock?: Clock;
  /** Where the worker's own faults go (the app's logger); without one, the console (consoleLog). */
  log?: ProviderLog;
}) {
  // Changes to Dives and sites reach the Waiting push queue (ADR 0056) through the listener dives/ owns.
  listenToChanges({ diveChanged: noteDiveChange, siteChanged: noteSiteChange });
  const providers = createProviderRegistry(deps.adapters);
  const clock = deps.clock && { clock: deps.clock };
  // One fallback for the whole layer: every service that logs is handed the same logger.
  const log = deps.log ?? consoleLog;
  const leases = createLeases({ db: deps.db, ...clock, log });
  const connections = createConnectionService({ db: deps.db, registry: providers, secrets: deps.secrets, leases, ...clock });
  const conflicts = createConflictService({ db: deps.db, connections, registry: providers, blobs: deps.blobs });
  const pushes = createPushService({ db: deps.db, blobs: deps.blobs, registry: providers, connections, leases, conflicts, ...clock, log });
  const pushRuns = createPushRunService({ db: deps.db, registry: providers, pushes, conflicts, log });
  const waitingPushes = createWaitingPushService({ db: deps.db, registry: providers, pushes, ...clock, log });
  const buddies = createBuddyService({ db: deps.db, registry: providers, connections, divers: createDiverService(deps.db) });
  const sitePicks = createSitePickService({ db: deps.db, registry: providers, connections });
  const diveImports = createDiveImportService({ db: deps.db, blobs: deps.blobs, registry: providers, connections, ...clock });
  const scheduledFetch = createScheduledFetch({ db: deps.db, registry: providers, diveImports, ...clock, log });
  const goneDives = createGoneDiveService({ db: deps.db, registry: providers, connections, leases });
  const certifications = createCertificationService({ db: deps.db, blobs: deps.blobs, registry: providers, connections });
  return { providers, connections, pushes, pushRuns, waitingPushes, buddies, sitePicks, diveImports, scheduledFetch, goneDives, conflicts, certifications };
}

export type ProviderLayer = ReturnType<typeof createProviderLayer>;

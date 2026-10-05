// The provider layer of one app (ADR 0027): the registry, Connections, Pushes and their leases, and the account's list
// of people (ADR 0029), built from the adapters this instance has. main.ts passes the production adapters; tests pass
// the fake SSI and a test-only adapter.
import type { Db } from '../db/client.js';
import { createDiverService } from '../divers/diver-service.js';
import type { SecretBox } from '../secrets/secret-box.js';
import { createBuddyService } from './buddy-service.js';
import { createConnectionService } from './connection-service.js';
import { createLeases, type Clock } from './leases.js';
import type { ProviderAdapter } from './provider.js';
import { createPushService } from './push-service.js';
import { createProviderRegistry } from './registry.js';

export function createProviderLayer(deps: { db: Db; secrets: SecretBox; adapters: ProviderAdapter[]; clock?: Clock }) {
  const providers = createProviderRegistry(deps.adapters);
  const leases = createLeases({ db: deps.db, ...(deps.clock && { clock: deps.clock }) });
  const connections = createConnectionService({ db: deps.db, registry: providers, secrets: deps.secrets, leases });
  const pushes = createPushService({ db: deps.db, registry: providers, connections, leases });
  const buddies = createBuddyService({ registry: providers, connections, divers: createDiverService(deps.db) });
  return { providers, connections, pushes, buddies };
}

export type ProviderLayer = ReturnType<typeof createProviderLayer>;

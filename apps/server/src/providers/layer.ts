// The provider layer of one app (ADR 0027): the registry, Connections, Pushes and their leases, built from the adapters
// this instance has. main.ts passes the production adapters; tests pass the fake SSI and a test-only adapter.
import type { Db } from '../db/client.js';
import type { SecretBox } from '../secrets/secret-box.js';
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
  return { providers, connections, pushes };
}

export type ProviderLayer = ReturnType<typeof createProviderLayer>;

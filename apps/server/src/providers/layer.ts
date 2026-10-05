// The provider layer of one app (ADR 0027): the registry, Connections and Pushes, built from the adapters this
// instance has. main.ts passes the production adapters; tests pass the fake SSI and a test-only adapter.
import type { Db } from '../db/client.js';
import type { SecretBox } from '../secrets/secret-box.js';
import { createConnectionService } from './connection-service.js';
import { createPacer, type Sleep } from './pacing.js';
import type { ProviderAdapter } from './provider.js';
import { createPushService } from './push-service.js';
import { createProviderRegistry } from './registry.js';

export function createProviderLayer(deps: { db: Db; secrets: SecretBox; adapters: ProviderAdapter[]; sleep?: Sleep }) {
  const providers = createProviderRegistry(deps.adapters);
  const connections = createConnectionService({ db: deps.db, registry: providers, secrets: deps.secrets, pace: createPacer({ ...(deps.sleep && { sleep: deps.sleep }) }) });
  const pushes = createPushService({ db: deps.db, registry: providers, connections });
  return { providers, connections, pushes };
}

export type ProviderLayer = ReturnType<typeof createProviderLayer>;

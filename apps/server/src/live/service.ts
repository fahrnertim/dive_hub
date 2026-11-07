// The live layer of one process (ADR 0066): the hub of SSE streams and the one LISTEN connection that feeds it.
import type pg from 'pg';
import type { Db } from '../db/client.js';
import { createHub, type LiveHub } from './hub.js';
import { createListener, type LiveListener, type LiveLog } from './listener.js';

export interface Live {
  hub: LiveHub;
  start(): void;
  stop(): Promise<void>;
}

export function createLive({ db, log }: { db: Db; log?: LiveLog }): Live {
  const hub = createHub();
  const logger: LiveLog = log ?? {
    info: (detail, message) => console.info(message, detail),
    warn: (detail, message) => console.warn(message, detail),
  };
  // A database built without a client (the OpenAPI script) never starts a listener.
  const client = (db as { $client?: pg.Pool }).$client;
  const connectionString = client?.options?.connectionString;
  const listener: LiveListener = connectionString
    ? createListener({ connectionString, hub, log: logger })
    : { start: () => undefined, stop: async () => undefined };
  return {
    hub,
    start() {
      hub.startHeartbeat();
      listener.start();
    },
    async stop() {
      await listener.stop();
      hub.stop();
      hub.closeAll();
    },
  };
}

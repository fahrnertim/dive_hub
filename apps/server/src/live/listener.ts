// One dedicated LISTEN connection per app process (ADR 0066). It must never come from the shared pool: LISTEN pins the
// connection for its lifetime. Losing it closes every SSE stream, so each client reconnects and refetches.
import pg from 'pg';
import { HINT_CHANNEL } from './emit.js';
import type { LiveHub } from './hub.js';

export interface LiveLog {
  info?(detail: object, message: string): void;
  warn(detail: object, message: string): void;
}

export interface LiveListener {
  start(): void;
  stop(): Promise<void>;
}

const RETRY_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000];

export function createListener({ connectionString, hub, log }: {
  connectionString: string;
  hub: LiveHub;
  log: LiveLog;
}): LiveListener {
  let client: pg.Client | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!;
    attempt += 1;
    retry = setTimeout(() => {
      retry = undefined;
      void connect();
    }, wait);
    retry.unref?.();
  };

  async function connect(): Promise<void> {
    if (stopped || client) return;
    const next = new pg.Client({ connectionString });
    client = next;
    next.on('notification', (message) => {
      if (message.channel === HINT_CHANNEL && message.payload) hub.publish(message.payload);
    });
    next.on('error', (error) => {
      log.warn({ err: error }, 'the live hint connection failed');
      lost(next);
    });
    next.on('end', () => lost(next));
    try {
      await next.connect();
      await next.query(`LISTEN ${HINT_CHANNEL}`);
      attempt = 0;
      hub.startHeartbeat();
      log.info?.({ channel: HINT_CHANNEL }, 'listening for live hints');
    } catch (error) {
      log.warn({ err: error }, 'the live hint connection could not be made');
      lost(next);
    }
  }

  function lost(which: pg.Client) {
    if (client !== which) return;
    client = null;
    void which.end().catch(() => undefined);
    // A server-side gap is invisible to clients; closing their streams sends them through the reconnect refetch.
    hub.closeAll();
    schedule();
  }

  return {
    start() {
      if (stopped || client) return;
      stopped = false;
      void connect();
    },
    async stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = undefined;
      const ending = client;
      client = null;
      if (ending) await ending.end().catch(() => undefined);
    },
  };
}

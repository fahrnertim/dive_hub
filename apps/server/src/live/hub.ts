// The connections of one app process (ADR 0066): each signed-in User may hold a few SSE streams, and a hint goes to the
// streams of the users in its audience. The audience never leaves the server.
import type { ServerResponse } from 'node:http';
import { parseHint } from './emit.js';

/** A User's open streams beyond this are refused with 429: a tab or two, not a reconnect leak. */
export const MAX_STREAMS_PER_USER = 8;
/** A comment line this often keeps proxies from closing an idle stream. */
export const HEARTBEAT_MS = 15_000;

export interface LiveHub {
  /** Registers a stream; false when this User already has MAX_STREAMS_PER_USER open. */
  add(userId: string, socket: ServerResponse): boolean;
  remove(userId: string, socket: ServerResponse): void;
  /** Writes one NOTIFY payload to the streams in its audience. */
  publish(payload: string): void;
  /** Closes every stream: a lost LISTEN connection or a shutdown must force every client through its resync. */
  closeAll(): void;
  /** Starts the one heartbeat timer of the process; idempotent. */
  startHeartbeat(): void;
  stop(): void;
}

export function createHub(options: { heartbeatMs?: number; perUser?: number } = {}): LiveHub {
  const streams = new Map<string, Set<ServerResponse>>();
  const perUser = options.perUser ?? MAX_STREAMS_PER_USER;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const remove = (userId: string, socket: ServerResponse) => {
    const set = streams.get(userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) streams.delete(userId);
  };

  const write = (socket: ServerResponse, text: string) => {
    try {
      socket.write(text);
      return true;
    } catch {
      return false;
    }
  };

  return {
    add(userId, socket) {
      const set = streams.get(userId) ?? new Set<ServerResponse>();
      if (set.size >= perUser) return false;
      set.add(socket);
      streams.set(userId, set);
      return true;
    },
    remove,
    publish(payload) {
      const hint = parseHint(payload);
      if (!hint) return;
      const data = `event: hint\ndata: ${JSON.stringify({ v: 1, kind: hint.kind, id: hint.id })}\n\n`;
      for (const userId of new Set(hint.audience)) {
        for (const socket of streams.get(userId) ?? []) if (!write(socket, data)) remove(userId, socket);
      }
    },
    closeAll() {
      for (const [userId, set] of streams) {
        for (const socket of set) {
          try {
            socket.end();
          } catch {
            // already gone
          }
        }
        streams.delete(userId);
      }
    },
    startHeartbeat() {
      if (heartbeat) return;
      heartbeat = setInterval(() => {
        for (const [userId, set] of streams) {
          for (const socket of set) if (!write(socket, ':hb\n\n')) remove(userId, socket);
        }
      }, options.heartbeatMs ?? HEARTBEAT_MS);
      heartbeat.unref?.();
    },
    stop() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
    },
  };
}

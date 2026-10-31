// Attempts at the public routes that take a token (setup, invitations, password reset links), counted per client IP
// in a fixed window, in memory (ADR 0061). Better Auth limits its own routes; these are ours.
import { isIPv6 } from 'node:net';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { problem } from './problems.js';

/** About 30 attempts per 15 minutes per client IP: plenty for a person, nothing for guessing a token. */
export const TOKEN_ATTEMPTS = { max: 30, windowMs: 15 * 60_000 };

export interface AttemptLimit {
  /** Counts an attempt from `key`; the whole seconds until it may try again when it is over the limit, otherwise null. */
  take(key: string): number | null;
}

export function createAttemptLimit({ max, windowMs }: typeof TOKEN_ATTEMPTS, now: () => number = Date.now): AttemptLimit {
  const windows = new Map<string, { startedAt: number; count: number }>();
  let prunedAt = now();
  /** Drops the windows that are over, at most once a window, so the map holds only the addresses of the last one. */
  const prune = (at: number) => {
    if (at - prunedAt < windowMs) return;
    for (const [key, w] of windows) if (at - w.startedAt >= windowMs) windows.delete(key);
    prunedAt = at;
  };
  return {
    take(key) {
      const at = now();
      prune(at);
      let w = windows.get(key);
      if (!w || at - w.startedAt >= windowMs) {
        w = { startedAt: at, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      return w.count > max ? Math.ceil((w.startedAt + windowMs - at) / 1000) : null;
    },
  };
}

/**
 * The client an attempt counts for: an IPv4 address (also IPv4-mapped), or the /64 of an IPv6 address, the smallest
 * network a provider hands out, so stepping through its addresses neither escapes the limit nor grows the map.
 */
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!isIPv6(ip)) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const front = head ? head.split(':') : [];
  const back = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = [...front, ...Array<string>(8 - front.length - back.length).fill('0'), ...back];
  return `${groups.slice(0, 4).join(':')}::/64`;
}

/** An onRequest hook: counts the request's client and answers 429 too_many_attempts with Retry-After over the limit. */
export const limitAttempts = (limit: AttemptLimit) => async (request: FastifyRequest, reply: FastifyReply) => {
  const wait = limit.take(clientKey(request.ip));
  if (wait !== null) return reply.code(429).header('retry-after', String(wait)).send(problem('too_many_attempts'));
};

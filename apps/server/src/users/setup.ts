import { timingSafeEqual } from 'node:crypto';
import { count } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { user } from '../db/schema.js';
import { newToken, sha256 } from './tokens.js';

const SETUP_TOKEN_TTL_MS = 24 * 3600_000;

/**
 * First-admin bootstrap (ADR 0012). While no User exists, the server holds one setup token in memory
 * (hashed) and prints it to the log; whoever has it may create the first admin. A restart issues a new one.
 */
export function createSetup(db: Db, now: () => number = Date.now) {
  let current: { hash: Buffer; expiresAt: number } | null = null;

  const isNeeded = async () => (await db.select({ n: count() }).from(user))[0]!.n === 0;

  return {
    isNeeded,

    /** A fresh setup token if no User exists yet, else null. Invalidates any earlier token. */
    async issue(): Promise<string | null> {
      if (!(await isNeeded())) return null;
      const token = newToken();
      current = { hash: Buffer.from(sha256(token), 'hex'), expiresAt: now() + SETUP_TOKEN_TTL_MS };
      return token;
    },

    /**
     * Uses up the token if it matches. Returns a function that puts it back, for when creating the
     * admin fails afterwards (e.g. an invalid e-mail) and the operator should be able to retry.
     */
    consume(token: string): (() => void) | null {
      const held = current;
      if (!held || now() > held.expiresAt) return null;
      const given = Buffer.from(sha256(token), 'hex');
      if (!timingSafeEqual(given, held.hash)) return null;
      current = null; // synchronously, so a concurrent second request can't use it too
      return () => { current ??= held; };
    },
  };
}

export type Setup = ReturnType<typeof createSetup>;

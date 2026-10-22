// A User's own signed-in sessions (ADR 0053): the routes pass the User's id and hold no query.
import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { session } from '../db/schema.js';

export function createSessionService(db: Db) {
  return {
    /** The User's unexpired sessions, newest activity first; `currentId` marks the one the request came with. */
    list: async (userId: string, currentId: string | null | undefined) => {
      const rows = await db.select().from(session)
        .where(and(eq(session.userId, userId), gt(session.expiresAt, sql`now()`))).orderBy(desc(session.updatedAt));
      // Never the token: it would let page scripts read what the HttpOnly cookie hides.
      return rows.map((s) => ({
        id: s.id, createdAt: s.createdAt.toISOString(), lastActiveAt: s.updatedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt.toISOString(), ipAddress: s.ipAddress, userAgent: s.userAgent, current: s.id === currentId,
      }));
    },
    /** Signs one of the User's sessions out; false when it isn't theirs or doesn't exist. */
    end: async (userId: string, sessionId: string) => {
      const deleted = await db.delete(session)
        .where(and(eq(session.id, sessionId), eq(session.userId, userId))).returning({ id: session.id });
      return deleted.length > 0;
    },
    endOthers: async (userId: string, currentId: string) => {
      await db.delete(session).where(and(eq(session.userId, userId), ne(session.id, currentId)));
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;

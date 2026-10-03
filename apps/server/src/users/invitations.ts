import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { invitation, user } from '../db/schema.js';
import { newToken, sha256 } from './tokens.js';

const INVITATION_TTL_MS = 7 * 24 * 3600_000;

export type Role = 'user' | 'admin';
export type InvitationRow = typeof invitation.$inferSelect;
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function invitationStatus(row: InvitationRow, now = new Date()): InvitationStatus {
  if (row.acceptedAt) return 'accepted';
  if (row.revokedAt) return 'revoked';
  return row.expiresAt <= now ? 'expired' : 'pending';
}

export class EmailTakenError extends Error {
  constructor() { super('A User with this e-mail already exists'); }
}

/** Invitations (ADR 0012): single-use, expiring, bound to an e-mail; only the token's hash is stored. */
export function createInvitations(db: Db) {
  const pending = (tokenSha256: string) => and(
    eq(invitation.tokenSha256, tokenSha256), isNull(invitation.acceptedAt), isNull(invitation.revokedAt),
    gt(invitation.expiresAt, sql`now()`),
  );

  return {
    /** Creates an invitation; the returned token is the only copy and goes into the link. */
    async create(input: { email: string; role: Role; createdBy: string }) {
      const email = normalizeEmail(input.email);
      const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (taken) throw new EmailTakenError();
      const token = newToken();
      const row = await db.transaction(async (tx) => {
        // A new invitation replaces any still-open one for the same address.
        await tx.update(invitation).set({ revokedAt: new Date() })
          .where(and(eq(invitation.email, email), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)));
        const [created] = await tx.insert(invitation).values({
          tokenSha256: sha256(token), email, role: input.role, createdBy: input.createdBy,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        }).returning();
        return created!;
      });
      return { invitation: row, token };
    },

    list: () => db.select().from(invitation).orderBy(desc(invitation.createdAt)).limit(200),

    async revoke(id: string): Promise<boolean> {
      const rows = await db.update(invitation).set({ revokedAt: new Date() })
        .where(and(eq(invitation.id, id), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
        .returning({ id: invitation.id });
      return rows.length > 0;
    },

    /** The pending invitation for a token, or null if it is unknown, used, revoked or expired. */
    async find(token: string): Promise<InvitationRow | null> {
      const [row] = await db.select().from(invitation).where(pending(sha256(token)));
      return row ?? null;
    },

    /**
     * Marks the invitation accepted in one statement, so a token can't be used twice.
     * Returns it with a function that reopens it if creating the User then fails.
     */
    async claim(token: string) {
      const [row] = await db.update(invitation).set({ acceptedAt: new Date() })
        .where(pending(sha256(token))).returning();
      if (!row) return null;
      return {
        invitation: row,
        reopen: () => db.update(invitation).set({ acceptedAt: null }).where(eq(invitation.id, row.id)),
        acceptedBy: (userId: string) => db.update(invitation).set({ acceptedBy: userId }).where(eq(invitation.id, row.id)),
      };
    },
  };
}

export type Invitations = ReturnType<typeof createInvitations>;

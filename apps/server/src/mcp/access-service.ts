// AI accesses (ADR 0035): a User's named, revocable keys for the MCP endpoint, the instance's switch, and the log of
// what each access read. The keys are Better Auth API keys (hashed, shown once); this module is the only caller of
// that plugin, whose own endpoints stay off HTTP.
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { Auth } from '../auth/auth.js';
import type { Db } from '../db/client.js';
import { aiAccessLog, aiAccessSetting, apikey, user } from '../db/schema.js';

/** What an AI access may read. `logbook:read` is in every access; `logbook:positions` is the User's opt-in (ADR 0020). */
export const AI_ACCESS_SCOPES = ['logbook:read', 'logbook:positions'] as const;
export type AiAccessScope = (typeof AI_ACCESS_SCOPES)[number];

/** How long the log keeps a call (ADR 0035). */
export const LOG_DAYS = 90;
/** Log entries a User is shown at most per page. */
export const LOG_PAGE_MAX = 100;

export class AiAccessError extends Error {
  constructor(readonly code: 'ai_access_not_found' | 'ai_access_off') {
    super(code);
  }
}

/** Why a key was refused; the endpoint turns it into a 401 or 429 that says what to do. */
export type AccessRefusal =
  | { reason: 'off' | 'missing' | 'invalid' | 'user_disabled' }
  | { reason: 'rate_limited'; retryAfterSeconds: number };

/** An AI access as the endpoint uses it: who it acts for and what it may read. */
export interface VerifiedAccess {
  id: string;
  name: string;
  userId: string;
  scopes: AiAccessScope[];
}

export interface LoggedCall {
  tool: string;
  /** Without free text: the caller replaces search words before logging. */
  arguments: Record<string, unknown>;
  rows: number;
  outcome: 'ok' | 'error';
  errorCode?: string;
  durationMs: number;
}

/** Scopes as the key's permissions: `{ logbook: ['read', 'positions'] }`. */
const toPermissions = (scopes: readonly AiAccessScope[]) => ({ logbook: scopes.map((s) => s.slice('logbook:'.length)) });

function toScopes(permissions: string | Record<string, string[]> | null | undefined): AiAccessScope[] {
  let parsed: unknown = permissions;
  if (typeof permissions === 'string') {
    try {
      parsed = JSON.parse(permissions);
    } catch {
      parsed = null;
    }
  }
  const granted = (parsed as { logbook?: unknown } | null)?.logbook;
  return AI_ACCESS_SCOPES.filter((s) => Array.isArray(granted) && granted.includes(s.slice('logbook:'.length)));
}

type KeyRow = typeof apikey.$inferSelect;
const toAccess = (k: KeyRow) => ({
  id: k.id,
  name: k.name ?? '',
  /** The key's first characters, to tell accesses apart; never the key. */
  keyStart: k.start ?? '',
  scopes: toScopes(k.permissions),
  createdAt: k.createdAt,
  lastUsedAt: k.lastRequest,
});

export function createAiAccessService(db: Db, auth: Auth) {
  async function enabled(): Promise<boolean> {
    const [row] = await db.select({ enabled: aiAccessSetting.enabled }).from(aiAccessSetting);
    return row?.enabled ?? false;
  }

  return {
    enabled,

    /** The switch with who set it and when, for admins. */
    async setting() {
      const [row] = await db.select({ enabled: aiAccessSetting.enabled, changedAt: aiAccessSetting.changedAt, changedBy: user.name })
        .from(aiAccessSetting).leftJoin(user, eq(user.id, aiAccessSetting.changedBy));
      const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(apikey);
      return { enabled: row?.enabled ?? false, changedAt: row?.changedAt ?? null, changedBy: row?.changedBy ?? null, accesses: count?.n ?? 0 };
    },

    /** Admins: switches the MCP endpoint on or off for the instance. Off rejects every key at once; none is deleted. */
    async setEnabled(adminId: string, value: boolean): Promise<void> {
      await db.insert(aiAccessSetting).values({ enabled: value, changedBy: adminId })
        .onConflictDoUpdate({ target: aiAccessSetting.id, set: { enabled: value, changedBy: adminId, changedAt: new Date() } });
    },

    /** Admins: revokes every AI access of every User. Returns how many. */
    async revokeAll(): Promise<number> {
      return (await db.delete(apikey).returning({ id: apikey.id })).length;
    },

    /** The User's AI accesses, newest first. */
    async list(userId: string) {
      const rows = await db.select().from(apikey).where(eq(apikey.referenceId, userId)).orderBy(desc(apikey.createdAt), desc(apikey.id));
      return rows.map(toAccess);
    },

    /**
     * A new AI access. `key` is returned only here: Better Auth stores its hash. Refused while the instance has the
     * endpoint switched off, so nobody holds a key the admin never allowed.
     */
    async create(userId: string, name: string, positions: boolean) {
      if (!(await enabled())) throw new AiAccessError('ai_access_off');
      const scopes: AiAccessScope[] = positions ? ['logbook:read', 'logbook:positions'] : ['logbook:read'];
      const created = await auth.api.createApiKey({ body: { name, userId, permissions: toPermissions(scopes) } });
      const [row] = await db.select().from(apikey).where(eq(apikey.id, created.id));
      return { ...toAccess(row!), key: created.key };
    },

    /** Revokes one of the User's accesses: its key stops working at once. Its log entries stay. */
    async revoke(userId: string, id: string): Promise<void> {
      const deleted = await db.delete(apikey).where(and(eq(apikey.id, id), eq(apikey.referenceId, userId))).returning({ id: apikey.id });
      if (deleted.length === 0) throw new AiAccessError('ai_access_not_found');
    },

    /**
     * The access a bearer key stands for, or why not. Counts the request against the access's rate limit and stamps
     * its last use (both done by Better Auth).
     */
    async verify(key: string | undefined): Promise<VerifiedAccess | AccessRefusal> {
      if (!(await enabled())) return { reason: 'off' };
      if (!key) return { reason: 'missing' };
      const result = await auth.api.verifyApiKey({ body: { key } });
      if (!result.valid || !result.key) {
        const error = result.error as { code?: string; details?: { tryAgainIn?: number } } | null;
        if (error?.code === 'RATE_LIMITED') {
          return { reason: 'rate_limited', retryAfterSeconds: Math.max(1, Math.ceil((error.details?.tryAgainIn ?? 1000) / 1000)) };
        }
        return { reason: 'invalid' };
      }
      const [owner] = await db.select({ banned: user.banned }).from(user).where(sql`${user.id}::text = ${result.key.referenceId}`);
      if (!owner || owner.banned) return { reason: 'user_disabled' };
      return { id: result.key.id, name: result.key.name ?? '', userId: result.key.referenceId, scopes: toScopes(result.key.permissions) };
    },

    /** Records one tool call. Never throws: a failed log write must not fail the call it describes. */
    async log(access: VerifiedAccess, call: LoggedCall, onError: (error: unknown) => void = () => {}): Promise<void> {
      try {
        await db.insert(aiAccessLog).values({
          userId: access.userId, accessId: access.id, accessName: access.name, tool: call.tool, arguments: call.arguments,
          rows: call.rows, outcome: call.outcome, errorCode: call.errorCode ?? null, durationMs: Math.round(call.durationMs),
        });
      } catch (error) {
        onError(error);
      }
    },

    /** The User's log, newest first: of all their accesses (revoked ones too) or one, within the last 90 days. */
    async logOf(userId: string, options: { accessId?: string | undefined; limit: number; offset: number }) {
      const where = and(
        eq(aiAccessLog.userId, userId),
        gt(aiAccessLog.at, sql`now() - make_interval(days => ${LOG_DAYS})`),
        options.accessId ? eq(aiAccessLog.accessId, options.accessId) : undefined,
      );
      const [rows, [count]] = await Promise.all([
        db.select().from(aiAccessLog).where(where).orderBy(desc(aiAccessLog.at), desc(aiAccessLog.id)).limit(options.limit).offset(options.offset),
        db.select({ total: sql<number>`count(*)::int` }).from(aiAccessLog).where(where),
      ]);
      return { entries: rows, total: count?.total ?? 0 };
    },

    /** Deletes log entries older than 90 days (the worker runs it daily). Returns how many. */
    async purgeLog(): Promise<number> {
      return (await db.delete(aiAccessLog).where(lt(aiAccessLog.at, sql`now() - make_interval(days => ${LOG_DAYS})`)).returning({ id: aiAccessLog.id })).length;
    },
  };
}

export type AiAccessService = ReturnType<typeof createAiAccessService>;

// Connections to Providers (ADR 0024, 0027): one per User, Diver and Provider. Connecting signs in once; the
// credentials are sealed in one field shaped by the Provider's sign-in kind, the password only when the User chose to
// keep it. When the Provider no longer accepts the access, a kept password signs in again silently; otherwise the
// Connection needs the User to sign in again. Every action on a Connection waits its turn (leases.ts).
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { connection, diver, diverExternalId } from '../db/schema.js';
import { managedDiverIds } from '../dives/dive-service.js';
import type { SecretBox } from '../secrets/secret-box.js';
import { TurnTimeout, type Leases } from './leases.js';
import { ProviderError, type ActionContext, type ProviderAdapter, type SignInInput } from './provider.js';
import { asProblem, named, ProviderServiceError, type ProviderRegistry } from './registry.js';

export type ConnectionRow = typeof connection.$inferSelect;

/** What the User typed; which fields count depends on the Provider's sign-in kind. */
export interface SignInFields {
  login?: string | undefined;
  password?: string | undefined;
  token?: string | undefined;
  /** Keep the password (sealed) so Dive Hub signs in again by itself. Only for password sign-in, only with a key. */
  keepSignedIn: boolean;
}

/** Sealed as one JSON value per Connection. `access` is what calls carry; null once the Provider refused it. */
type Credentials =
  | { kind: 'password'; login: string; access: string | null; password: string | null }
  | { kind: 'token'; access: string | null }
  | { kind: 'none'; access: string | null };

const purpose = (id: string) => `connection:${id}`;

export function createConnectionService(deps: { db: Db; registry: ProviderRegistry; secrets: SecretBox; leases: Leases }) {
  const { db, registry, secrets, leases } = deps;

  /** Runs `fn` on the Connection's turn; a turn that doesn't come in time is `provider_busy`. */
  async function onTurn<T>(adapter: ProviderAdapter, connectionId: string, fn: (row: ConnectionRow | null) => Promise<T>): Promise<T> {
    try {
      return await leases.turn(connectionId, adapter.capabilities.limits.pauseMs, fn);
    } catch (error) {
      throw error instanceof TurnTimeout ? new ProviderServiceError('provider_busy', named(adapter)) : error;
    }
  }

  const seal = (id: string, c: Credentials) => secrets.seal(JSON.stringify(c), purpose(id));
  /** The Connection's credentials; a row from before ADR 0027 has none, and signs in with its account label. */
  const credentialsOf = (row: ConnectionRow): Credentials | null =>
    row.credentials ? JSON.parse(secrets.open(row.credentials, purpose(row.id))) as Credentials : null;

  /** What the User typed, checked against the Provider's sign-in kind. */
  function signInInput(adapter: ProviderAdapter, fields: SignInFields, login?: string): SignInInput {
    const kind = adapter.capabilities.signIn.kind;
    if (fields.keepSignedIn && kind !== 'password') throw new ProviderServiceError('invalid_input', named(adapter));
    if (fields.keepSignedIn && !secrets.available) throw new ProviderServiceError('encryption_key_missing');
    const theLogin = login ?? fields.login;
    if (kind === 'password' && theLogin && fields.password) return { kind, login: theLogin, password: fields.password };
    if (kind === 'token' && fields.token) return { kind, token: fields.token };
    throw new ProviderServiceError('invalid_input', named(adapter));
  }

  function credentialsFrom(input: SignInInput, access: string, keep: boolean): Credentials {
    return input.kind === 'password'
      ? { kind: 'password', login: input.login, access, password: keep ? input.password : null }
      : { kind: 'token', access };
  }

  async function ownConnection(userId: string, connectionId: string): Promise<ConnectionRow> {
    const [row] = await db.select().from(connection).where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
    if (!row) throw new ProviderServiceError('connection_not_found');
    return row;
  }

  async function forDiver(userId: string, diverId: string, provider: string): Promise<ConnectionRow | null> {
    const [row] = await db.select().from(connection)
      .where(and(eq(connection.userId, userId), eq(connection.diverId, diverId), eq(connection.provider, provider)));
    return row ?? null;
  }

  async function signInAt(adapter: ProviderAdapter, input: SignInInput) {
    try {
      return await adapter.signIn(input);
    } catch (error) {
      throw asProblem(error, adapter);
    }
  }

  return {
    /** Whether the server can keep passwords (DIVEHUB_ENCRYPTION_KEY is set). */
    canKeepPasswords: secrets.available,

    /** The User's Connections, any Provider, oldest first. */
    async list(userId: string) {
      const rows = await db.select({
        id: connection.id, provider: connection.provider, diverId: connection.diverId, diverName: diver.name,
        accountId: connection.accountId, accountLabel: connection.accountLabel, keepSignedIn: connection.keepSignedIn,
        state: connection.state, lastUsedAt: connection.lastUsedAt, createdAt: connection.createdAt,
      }).from(connection).innerJoin(diver, eq(diver.id, connection.diverId))
        .where(eq(connection.userId, userId)).orderBy(connection.createdAt);
      // A Provider this instance no longer has stays in the database but isn't offered.
      const known = new Set(registry.list().map((a) => a.id));
      return rows.filter((r) => known.has(r.provider));
    },

    /** The Connection of a Diver at a Provider, if the User has one. */
    forDiver,

    /** One of the User's Connections, or `connection_not_found`. */
    own: ownConnection,

    /** Signs in once and keeps the Connection; the account becomes the Diver's External ID where the Provider has one. */
    async connect(userId: string, provider: string, diverId: string, fields: SignInFields): Promise<string> {
      const adapter = registry.get(provider);
      if (!(await managedDiverIds(db, userId)).has(diverId)) throw new ProviderServiceError('diver_not_found');
      const input = signInInput(adapter, fields);
      if (await forDiver(userId, diverId, provider)) throw new ProviderServiceError('provider_already_connected', named(adapter));
      const signedIn = await signInAt(adapter, input);
      const id = randomUUID();
      await db.transaction(async (tx) => {
        const source = adapter.accountSource;
        if (source) {
          const [taken] = await tx.select().from(diverExternalId)
            .where(and(eq(diverExternalId.source, source), eq(diverExternalId.externalId, signedIn.account.id)));
          if (taken && taken.diverId !== diverId) throw new ProviderServiceError('provider_account_taken', named(adapter));
          if (!taken) {
            // A Diver has one account per Source: connecting another replaces the one it had.
            await tx.delete(diverExternalId).where(and(eq(diverExternalId.diverId, diverId), eq(diverExternalId.source, source)));
            await tx.insert(diverExternalId).values({ diverId, source, externalId: signedIn.account.id });
          }
        }
        await tx.insert(connection).values({
          id, userId, diverId, provider, accountId: signedIn.account.id, accountLabel: signedIn.account.label,
          keepSignedIn: fields.keepSignedIn, credentials: seal(id, credentialsFrom(input, signedIn.access, fields.keepSignedIn)),
          lastUsedAt: new Date(),
        });
      });
      return id;
    },

    /** Signs in again (e.g. after the access expired) with the Connection's login; may change the choice to keep the password. */
    async signInAgain(userId: string, connectionId: string, fields: SignInFields) {
      const row = await ownConnection(userId, connectionId);
      const adapter = registry.get(row.provider);
      const kept = credentialsOf(row);
      const input = signInInput(adapter, fields, kept?.kind === 'password' ? kept.login : row.accountLabel);
      const signedIn = await onTurn(adapter, row.id, () => signInAt(adapter, input));
      if (signedIn.account.id !== row.accountId) throw new ProviderServiceError('provider_other_account', named(adapter));
      await db.update(connection).set({
        credentials: seal(row.id, credentialsFrom(input, signedIn.access, fields.keepSignedIn)),
        keepSignedIn: fields.keepSignedIn, state: 'active', lastUsedAt: new Date(), updatedAt: new Date(),
      }).where(eq(connection.id, row.id));
    },

    /** Forgets the credentials. Pushes stay in the Dives' history; the Provider keeps its dives. */
    async disconnect(userId: string, connectionId: string) {
      await ownConnection(userId, connectionId);
      await db.delete(connection).where(eq(connection.id, connectionId));
    },

    /**
     * Runs one action with the Connection's access, paced. When the Provider no longer accepts it, a kept password
     * signs in again by itself and the action runs once more; otherwise the Connection needs the User
     * (`provider_sign_in_needed`).
     */
    async withAccess<T>(given: ConnectionRow, fn: (context: ActionContext) => Promise<T>): Promise<T> {
      const adapter = registry.get(given.provider);
      // The Connection as it is once it's this action's turn: the one before may have signed in anew, or disconnected.
      return onTurn(adapter, given.id, async (row) => {
        if (!row) throw new ProviderServiceError('provider_not_connected', named(adapter));
        let credentials = credentialsOf(row);
        const password = credentials?.kind === 'password' ? credentials.password : null;
        const needsSignIn = async () => {
          if (credentials) credentials = { ...credentials, access: null };
          await db.update(connection).set({
            state: 'needs_sign_in', credentials: credentials && seal(row.id, credentials), updatedAt: new Date(),
          }).where(eq(connection.id, row.id));
          return new ProviderServiceError('provider_sign_in_needed', named(adapter));
        };
        if (row.state === 'needs_sign_in' && !password) throw new ProviderServiceError('provider_sign_in_needed', named(adapter));
        let access = credentials?.access ?? null;
        for (let attempt = 1; ; attempt++) {
          if (!access) {
            if (!password || credentials?.kind !== 'password') throw await needsSignIn();
            try {
              access = (await adapter.signIn({ kind: 'password', login: credentials.login, password })).access;
            } catch (error) {
              // The kept password no longer works (changed at the Provider): the User has to sign in.
              if (error instanceof ProviderError && error.reason === 'wrong_credentials') throw await needsSignIn();
              throw asProblem(error, adapter);
            }
            credentials = { ...credentials, access };
            await db.update(connection).set({ credentials: seal(row.id, credentials), state: 'active', updatedAt: new Date() })
              .where(eq(connection.id, row.id));
          }
          try {
            const result = await fn({ connectionId: row.id, accountId: row.accountId, access });
            await db.update(connection).set({ lastUsedAt: new Date(), state: 'active' }).where(eq(connection.id, row.id));
            return result;
          } catch (error) {
            if (!(error instanceof ProviderError && error.reason === 'signed_out') || attempt > 1) throw asProblem(error, adapter);
            access = null;
          }
        }
      });
    },
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;

// SSI as a Target over HTTP (ADR 0024): the User's Connections, and a Dive's copy at SSI.
// Passwords and tokens go in, never out: no response carries them.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import type { push } from '../db/schema.js';
import { Problem, problem, PROBLEMS, type ProblemCode } from '../http/problems.js';
import { COMPARED_FIELDS } from './ssi-record.js';
import { SsiServiceError, type SsiService } from './ssi-service.js';

export interface SsiRouteDeps {
  auth: Auth;
  ssi: SsiService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const DateTime = Type.String({ format: 'date-time' });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);
const Code = Type.Enum(Object.keys(PROBLEMS) as ProblemCode[]);
const Password = Type.String({ minLength: 1, maxLength: 500 });
const KeepSignedIn = Type.Boolean({
  description: 'Keep the password, encrypted, so Dive Hub signs in again by itself when SSI\'s token expires. Needs canKeepPasswords',
});

const ConnectionView = Type.Object({
  id: Type.String(),
  diverId: Type.String({ description: 'The Diver whose SSI account this is' }),
  diverName: Type.String(),
  accountId: Type.String({ description: 'SSI\'s user master ID' }),
  accountEmail: Type.String(),
  keepSignedIn: Type.Boolean({ description: 'The password is kept (encrypted); otherwise only SSI\'s token, which can expire' }),
  state: Type.Enum(['active', 'needs_sign_in'], { description: 'needs_sign_in: SSI no longer accepts the token; sign in again' }),
  lastUsedAt: Nullable(DateTime),
  createdAt: DateTime,
});

const PushView = Type.Object({
  id: Type.String(),
  action: Type.Enum(['create', 'update', 'link', 'delete'], { description: 'link: tied to a dive already in SSI, nothing sent' }),
  state: Type.Enum(['pending', 'handed_over', 'confirmed', 'failed'], { description: 'confirmed: SSI accepted it and gave its ID; not SSI\'s dive-center confirmation' }),
  remoteId: Nullable(Type.String({ description: 'SSI\'s dive ID' })),
  remoteNumber: Nullable(Type.Integer({ description: 'SSI\'s own dive number, which differs from the Dive\'s' })),
  failureCode: Nullable(Code),
  differences: Nullable(Type.Array(Type.Object({
    field: Type.Enum([...COMPARED_FIELDS]),
    sent: Nullable(Type.Union([Type.String(), Type.Number()])),
    stored: Nullable(Type.Union([Type.String(), Type.Number()])),
  }), { description: 'Fields SSI stored differently from what was sent; null when the dive could not be read back' })),
  createdAt: DateTime,
});

const StatusView = Type.Object({
  connection: Nullable(Type.Object({ id: Type.String(), state: Type.Enum(['active', 'needs_sign_in']), accountEmail: Type.String() }, {
    description: 'The Connection of the Dive\'s Diver; null when that Diver is not connected to SSI',
  })),
  siteId: Nullable(Type.String({ description: 'The Dive site' })),
  siteSsiId: Nullable(Type.String({ description: 'The Dive site\'s SSI site ID; sending needs one' })),
  current: Nullable(Type.Object({
    remoteId: Type.String(),
    remoteNumber: Nullable(Type.Integer()),
    sentAt: DateTime,
    upToDate: Type.Boolean({ description: 'false: the Dive changed since it was sent (outdated), or it was linked and never sent' }),
  }, { description: 'The SSI dive this Dive has now; null when none (never sent, deleted)' })),
  pushes: Type.Array(PushView, { description: 'Newest first' }),
});

const Existing = Type.Object({
  remoteId: Type.String(),
  number: Nullable(Type.Integer()),
  startsAt: Nullable(Type.String({ description: 'Local time as SSI keeps it, "YYYY-MM-DD HH:MM"' })),
  maxDepthM: Nullable(Type.Number()),
  durationMinutes: Nullable(Type.Number()),
}, { description: 'A dive already in SSI at the same time (±2 min)' });

const SendResultView = Type.Object({
  outcome: Type.Enum(['created', 'updated', 'linked', 'exists'], {
    description: 'exists: nothing was sent; a dive at the same time is in SSI. Send again with onExisting link or create',
  }),
  existing: Nullable(Existing),
  status: StatusView,
});

export const SSI_STATUS: Partial<Record<ProblemCode, number>> = {
  dive_not_found: 404, diver_not_found: 404, connection_not_found: 404,
  encryption_key_missing: 400, ssi_wrong_credentials: 400,
  ssi_already_connected: 409, ssi_account_taken: 409, ssi_other_account: 409, ssi_not_connected: 409, ssi_sign_in_needed: 409,
  ssi_site_missing: 409, ssi_not_sent: 409, ssi_dive_gone: 409, ssi_busy: 409,
  ssi_unavailable: 502, ssi_refused: 502,
};
const errors = { 400: Problem, 404: Problem, 409: Problem, 502: Problem };

const pushView = (p: typeof push.$inferSelect): Static<typeof PushView> => ({
  id: p.id, action: p.action, state: p.state, remoteId: p.remoteId, remoteNumber: p.remoteNumber,
  failureCode: p.errorCode as ProblemCode | null,
  differences: p.differences as Static<typeof PushView>['differences'], createdAt: p.createdAt.toISOString(),
});

export const ssiRoutes: FastifyPluginAsyncTypebox<SsiRouteDeps> = async (app, { auth, ssi }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SsiServiceError) return reply.code(SSI_STATUS[error.code] ?? 500).send(problem(error.code));
    throw error;
  });

  const connectionView = async (userId: string, id: string) => {
    const row = (await ssi.connections(userId)).find((c) => c.id === id)!;
    return { ...row, lastUsedAt: row.lastUsedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
  };
  const statusView = async (userId: string, diveId: string): Promise<Static<typeof StatusView>> => {
    const s = await ssi.status(userId, diveId);
    return { ...s, current: s.current && { ...s.current, sentAt: s.current.sentAt.toISOString() }, pushes: s.pushes.map(pushView) };
  };

  app.get('/connections/ssi', {
    schema: {
      summary: 'The User\'s SSI Connections (one per Diver at most)',
      response: {
        200: Type.Object({
          canKeepPasswords: Type.Boolean({ description: 'The server can keep passwords (DIVEHUB_ENCRYPTION_KEY is set); offer "Keep me signed in" only then' }),
          connections: Type.Array(ConnectionView),
        }),
      },
    },
  }, async (request) => ({
    canKeepPasswords: ssi.canKeepPasswords,
    connections: (await ssi.connections(request.user!.id)).map((c) => ({
      ...c, lastUsedAt: c.lastUsedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
    })),
  }));

  app.post('/connections/ssi', {
    schema: {
      summary: 'Connect a Diver to their SSI account: signs in to SSI once and keeps the token (and the password, if asked)',
      description: 'SSI\'s token can expire at any time. Without keepSignedIn the Connection then needs the User to sign in again.',
      body: Type.Object({
        diverId: Type.String({ format: 'uuid' }),
        email: Type.String({ minLength: 3, maxLength: 320 }),
        password: Password,
        keepSignedIn: KeepSignedIn,
      }, { additionalProperties: false }),
      response: { 201: ConnectionView, ...errors },
    },
  }, async (request, reply) => {
    const id = await ssi.connect(request.user!.id, request.body);
    return reply.code(201).send(await connectionView(request.user!.id, id));
  });

  app.post('/connections/ssi/:id/sign-in', {
    schema: {
      summary: 'Sign in to SSI again with the Connection\'s e-mail (after SSI\'s token expired), and choose again whether to keep the password',
      params: IdParams,
      body: Type.Object({ password: Password, keepSignedIn: KeepSignedIn }, { additionalProperties: false }),
      response: { 200: ConnectionView, ...errors },
    },
  }, async (request) => {
    await ssi.signInAgain(request.user!.id, request.params.id, request.body.password, request.body.keepSignedIn);
    return connectionView(request.user!.id, request.params.id);
  });

  app.delete('/connections/ssi/:id', {
    schema: {
      summary: 'Disconnect: forgets SSI\'s token and the password. Dives already in SSI stay there; their history stays here',
      params: IdParams, response: { 204: Type.Null(), 404: Problem },
    },
  }, async (request, reply) => {
    await ssi.disconnect(request.user!.id, request.params.id);
    return reply.code(204).send(null);
  });

  app.get('/dives/:id/ssi', {
    schema: {
      summary: 'The Dive at SSI: the Connection of its Diver, the SSI site ID, the SSI dive it has now, and every Push',
      params: IdParams, response: { 200: StatusView, 404: Problem },
    },
  }, async (request) => statusView(request.user!.id, request.params.id));

  app.get('/dives/:id/ssi/sites', {
    schema: {
      summary: 'Dive sites from the User\'s own SSI logbook, nearest to the Dive first, to pick the SSI site ID from',
      params: IdParams,
      response: {
        200: Type.Array(Type.Object({
          id: Type.String({ description: 'SSI site ID' }), name: Type.String(),
          latitude: Nullable(Type.Number()), longitude: Nullable(Type.Number()),
          country: Nullable(Type.String({ description: 'As SSI gives it' })),
          distanceM: Nullable(Type.Integer({ description: 'From the Dive site, else the Dive\'s position' })),
        })),
        ...errors,
      },
    },
  }, async (request) => ssi.siteSuggestions(request.user!.id, request.params.id));

  app.post('/dives/:id/ssi', {
    schema: {
      summary: 'Send the Dive to SSI: updates its SSI dive, or creates one',
      description: 'Before creating, a dive at the same time already in SSI is answered with outcome exists and nothing is sent; '
        + 'send again with onExisting link (tie the Dive to it) or create (a second dive). SSI shows dives sent this way as unconfirmed.',
      params: IdParams,
      body: Type.Object({ onExisting: Type.Optional(Type.Enum(['link', 'create'])) }, { additionalProperties: false }),
      response: { 200: SendResultView, ...errors },
    },
  }, async (request) => {
    const sent = await ssi.send(request.user!.id, request.params.id, request.body.onExisting);
    return {
      outcome: sent.result, existing: sent.result === 'exists' ? sent.existing : null,
      status: await statusView(request.user!.id, request.params.id),
    };
  });

  app.delete('/dives/:id/ssi', {
    schema: {
      summary: 'Delete the Dive\'s copy in SSI (SSI hides it; its app has no way back). The Dive stays here',
      params: IdParams, response: { 200: StatusView, ...errors },
    },
  }, async (request) => {
    await ssi.remove(request.user!.id, request.params.id);
    return statusView(request.user!.id, request.params.id);
  });
};

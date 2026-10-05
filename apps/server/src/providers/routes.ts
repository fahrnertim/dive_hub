// Providers over HTTP (ADR 0024, 0027): what each Provider offers, the User's Connections, and a Dive at each Provider.
// Passwords, tokens and other credentials go in, never out: no response carries them.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyReply } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import { Problem, problem, PROBLEMS, providerProblem, type ProblemCode } from '../http/problems.js';
import { SITE_SOURCES } from '../sites/sources.js';
import type { ConnectionService } from './connection-service.js';
import { FIND_BY, OPERATIONS, type ProviderAdapter } from './provider.js';
import type { PushRow, PushService } from './push-service.js';
import { ProviderServiceError, type ProviderRegistry } from './registry.js';

export interface ProviderRouteDeps {
  auth: Auth;
  providers: ProviderRegistry;
  connections: ConnectionService;
  pushes: PushService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const DateTime = Type.String({ format: 'date-time' });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);
const Code = Type.Enum(Object.keys(PROBLEMS) as ProblemCode[]);
const Secret = Type.String({ minLength: 1, maxLength: 4000 });
const KeepSignedIn = Type.Boolean({
  description: 'Keep the password, sealed, so Dive Hub signs in again by itself when the Provider asks. Only for password sign-in, and only when canKeepPassword',
});

const Direction = Type.Object({
  operations: Type.Array(Type.Enum([...OPERATIONS])),
  findBy: Type.Array(Type.Enum([...FIND_BY]), { description: 'How find finds a record: by our reference, by a time window, near a position' }),
});

const ProviderView = Type.Object({
  id: Type.String(),
  name: Type.String({ description: 'Proper name, the same in every UI language' }),
  signIn: Type.Object({
    kind: Type.Enum(['none', 'password', 'token']),
    login: Nullable(Type.Enum(['email', 'username'], { description: 'What the login field asks for (password sign-in)' })),
    canKeepPassword: Type.Boolean({ description: 'Offer "Keep me signed in": password sign-in, and this server can keep passwords (DIVEHUB_ENCRYPTION_KEY)' }),
  }),
  data: Type.Object({
    dives: Nullable(Type.Object({
      export: Nullable(Type.Object({
        ...Direction.properties,
        delivery: Type.Enum(['confirmed', 'handed_over'], { description: 'confirmed: an ID comes back. handed_over: no ID, so no update, delete or link' }),
        needsSiteIdFrom: Nullable(Type.Enum([...SITE_SOURCES], { description: 'Sending needs the Dive site\'s External ID at this Source' })),
        readBackFields: Type.Array(Type.String(), { description: 'Field names read-back differences are reported under; translate them' }),
      })),
      import: Nullable(Direction),
    })),
    diveSites: Nullable(Type.Object({ import: Nullable(Direction) })),
  }),
  notices: Type.Array(Type.Enum(['shows_unconfirmed']), { description: 'Things a client must say: shows_unconfirmed, the Provider shows dives sent this way as unconfirmed' }),
  limits: Type.Object({ pauseMs: Type.Integer({ description: 'Pause between two actions on one Connection; requests wait their turn' }) }),
});

const ConnectionView = Type.Object({
  id: Type.String(),
  provider: Type.String(),
  diverId: Type.String({ description: 'The Diver whose account at the Provider this is' }),
  diverName: Type.String(),
  accountId: Type.String({ description: 'The account at the Provider (SSI: user master ID)' }),
  accountLabel: Type.String({ description: 'What the User recognises the account by (SSI: the e-mail)' }),
  keepSignedIn: Type.Boolean({ description: 'The password is kept (sealed); otherwise only the Provider\'s access, which can expire' }),
  state: Type.Enum(['active', 'needs_sign_in'], { description: 'needs_sign_in: the Provider no longer accepts the sign-in; sign in again' }),
  lastUsedAt: Nullable(DateTime),
  createdAt: DateTime,
});

const PushView = Type.Object({
  id: Type.String(),
  action: Type.Enum(['create', 'update', 'link', 'delete'], { description: 'link: tied to a dive already there, nothing sent' }),
  state: Type.Enum(['pending', 'handed_over', 'confirmed', 'failed'], {
    description: 'confirmed: the Provider accepted it and gave its ID (not SSI\'s dive-center confirmation); handed_over: delivered without an ID',
  }),
  remoteId: Nullable(Type.String({ description: 'The Provider\'s dive ID' })),
  remoteNumber: Nullable(Type.Integer({ description: 'The Provider\'s own dive number, which differs from the Dive\'s' })),
  remoteGone: Type.Boolean({ description: 'The remote dive was found deleted at the Provider' }),
  failureCode: Nullable(Code),
  differences: Nullable(Type.Array(Type.Object({
    field: Type.String({ description: 'One of the Provider\'s readBackFields' }),
    sent: Nullable(Type.Union([Type.String(), Type.Number()])),
    stored: Nullable(Type.Union([Type.String(), Type.Number()])),
  }), { description: 'Fields the Provider stored differently from what was sent; null when the dive could not be read back' })),
  createdAt: DateTime,
});

const StatusView = Type.Object({
  provider: Type.String(),
  connection: Nullable(Type.Object({ id: Type.String(), state: Type.Enum(['active', 'needs_sign_in']), accountLabel: Type.String() }, {
    description: 'The Connection of the Dive\'s Diver; null when that Diver is not connected to this Provider',
  })),
  siteId: Nullable(Type.String({ description: 'The Dive site' })),
  siteExternalId: Nullable(Type.String({ description: 'The Dive site\'s External ID at needsSiteIdFrom; sending needs one' })),
  current: Nullable(Type.Object({
    remoteId: Type.String(),
    remoteNumber: Nullable(Type.Integer()),
    sentAt: DateTime,
    upToDate: Type.Boolean({ description: 'false: the Dive changed since it was sent (outdated), or it was linked and never sent' }),
  }, { description: 'The remote dive this Dive has now; null when none (never sent, deleted)' })),
  pushes: Type.Array(PushView, { description: 'Newest first' }),
});

const Existing = Type.Object({
  remoteId: Type.String(),
  number: Nullable(Type.Integer()),
  startsAt: Nullable(Type.String({ description: 'Local time as the Provider keeps it, "YYYY-MM-DD HH:MM"' })),
  maxDepthM: Nullable(Type.Number()),
  durationMinutes: Nullable(Type.Number()),
}, { description: 'A dive already at the Provider at about the same time' });

export const PROVIDER_STATUS: Partial<Record<ProblemCode, number>> = {
  dive_not_found: 404, diver_not_found: 404, connection_not_found: 404,
  invalid_input: 400, encryption_key_missing: 400, provider_wrong_credentials: 400, provider_unsupported: 400,
  provider_already_connected: 409, provider_account_taken: 409, provider_other_account: 409, provider_not_connected: 409,
  provider_sign_in_needed: 409, provider_site_id_missing: 409, provider_not_sent: 409, provider_dive_gone: 409, provider_busy: 409,
  provider_unavailable: 502, provider_refused: 502,
};
const errors = { 400: Problem, 404: Problem, 409: Problem, 502: Problem };

/** Answers a refusal about a Provider: its status, its code and the Provider named. */
export function replyProviderError(error: ProviderServiceError, reply: FastifyReply) {
  const status = PROVIDER_STATUS[error.code] ?? 500;
  return reply.code(status).send(error.provider ? providerProblem(error.code, error.provider) : problem(error.code));
}

export const pushView = (p: PushRow): Static<typeof PushView> => ({
  id: p.id, action: p.action, state: p.state, remoteId: p.remoteId, remoteNumber: p.remoteNumber, remoteGone: p.remoteGone,
  failureCode: p.errorCode as ProblemCode | null,
  differences: p.differences, createdAt: p.createdAt.toISOString(),
});

export function providerView(a: ProviderAdapter, canKeepPasswords: boolean): Static<typeof ProviderView> {
  const c = a.capabilities;
  const direction = (d: { operations: string[]; findBy?: string[] } | undefined) =>
    d ? { operations: d.operations, findBy: d.findBy ?? [] } as Static<typeof Direction> : null;
  const dives = c.data.dives;
  const exports = dives?.export;
  return {
    id: a.id, name: c.name,
    signIn: {
      kind: c.signIn.kind, login: c.signIn.kind === 'password' ? c.signIn.login : null,
      canKeepPassword: c.signIn.kind === 'password' && canKeepPasswords,
    },
    data: {
      dives: dives ? {
        export: exports ? {
          ...direction(exports)!, delivery: exports.delivery, needsSiteIdFrom: exports.needsSiteIdFrom ?? null,
          readBackFields: exports.readBackFields ?? [],
        } : null,
        import: direction(dives.import),
      } : null,
      diveSites: c.data.diveSites ? { import: direction(c.data.diveSites.import) } : null,
    },
    notices: c.notices, limits: c.limits,
  };
}

export const providerRoutes: FastifyPluginAsyncTypebox<ProviderRouteDeps> = async (app, { auth, providers, connections, pushes }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProviderServiceError) return replyProviderError(error, reply);
    throw error;
  });

  // A string, not an enum: clients take the Providers from GET /api/providers, and the registry refuses others.
  const ProviderParam = Type.String({ pattern: '^[a-z][a-z0-9_]*$', description: 'A Provider\'s id (GET /api/providers); others answer provider_unsupported' });
  const DiveProviderParams = Type.Object({ id: Type.String({ format: 'uuid' }), provider: ProviderParam });

  const connectionView = (c: Awaited<ReturnType<ConnectionService['list']>>[number]): Static<typeof ConnectionView> =>
    ({ ...c, lastUsedAt: c.lastUsedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString() });
  const oneConnection = async (userId: string, id: string) => connectionView((await connections.list(userId)).find((c) => c.id === id)!);
  type Status = Awaited<ReturnType<PushService['status']>>;
  const statusView = (s: Status): Static<typeof StatusView> =>
    ({ ...s, current: s.current && { ...s.current, sentAt: s.current.sentAt.toISOString() }, pushes: s.pushes.map(pushView) });

  app.get('/providers', {
    schema: {
      summary: 'Every Provider of this instance and what it offers: sign-in, kinds of data and operations, delivery, notices, limits',
      description: 'Clients render the Connections and each Dive\'s panels from this (docs/spec/clients.md). It changes only with the server.',
      response: { 200: Type.Array(ProviderView) },
    },
  }, async () => providers.list().map((a) => providerView(a, connections.canKeepPasswords)));

  app.get('/connections', {
    schema: {
      summary: 'The User\'s Connections to Providers (one per Diver and Provider at most)',
      response: { 200: Type.Array(ConnectionView) },
    },
  }, async (request) => (await connections.list(request.user!.id)).map(connectionView));

  app.post('/connections/:provider', {
    schema: {
      summary: 'Connect a Diver to their account at a Provider: signs in once and keeps the access (and the password, if asked)',
      description: 'Send what the Provider\'s sign-in kind asks for: login and password, or token. The access can expire; '
        + 'without keepSignedIn the Connection then needs the User to sign in again.',
      params: Type.Object({ provider: ProviderParam }),
      body: Type.Object({
        diverId: Type.String({ format: 'uuid' }),
        login: Type.Optional(Type.String({ minLength: 1, maxLength: 320, description: 'E-mail or user name (password sign-in)' })),
        password: Type.Optional(Secret),
        token: Type.Optional(Secret),
        keepSignedIn: KeepSignedIn,
      }, { additionalProperties: false }),
      response: { 201: ConnectionView, ...errors },
    },
  }, async (request, reply) => {
    const { diverId, ...fields } = request.body;
    const id = await connections.connect(request.user!.id, request.params.provider, diverId, fields);
    return reply.code(201).send(await oneConnection(request.user!.id, id));
  });

  app.post('/connections/:id/sign-in', {
    schema: {
      summary: 'Sign in to the Provider again with the Connection\'s login (after the access expired), and choose again whether to keep the password',
      params: IdParams,
      body: Type.Object({ password: Type.Optional(Secret), token: Type.Optional(Secret), keepSignedIn: KeepSignedIn }, { additionalProperties: false }),
      response: { 200: ConnectionView, ...errors },
    },
  }, async (request) => {
    await connections.signInAgain(request.user!.id, request.params.id, request.body);
    return oneConnection(request.user!.id, request.params.id);
  });

  app.delete('/connections/:id', {
    schema: {
      summary: 'Disconnect: forgets the credentials. Dives already at the Provider stay there; their history stays here',
      params: IdParams, response: { 204: Type.Null(), 404: Problem },
    },
  }, async (request, reply) => {
    await connections.disconnect(request.user!.id, request.params.id);
    return reply.code(204).send(null);
  });

  app.get('/dives/:id/providers', {
    schema: {
      summary: 'The Dive at every Provider that takes dives: the Connection of its Diver, the site ID needed, the remote dive it has now, every Push',
      params: IdParams, response: { 200: Type.Array(StatusView), 404: Problem },
    },
  }, async (request) => (await pushes.statusAll(request.user!.id, request.params.id)).map(statusView));

  app.get('/dives/:id/providers/:provider', {
    schema: {
      summary: 'The Dive at one Provider: the Connection of its Diver, the site ID needed, the remote dive it has now, every Push',
      params: DiveProviderParams, response: { 200: StatusView, 400: Problem, 404: Problem },
    },
  }, async (request) => statusView(await pushes.status(request.user!.id, request.params.id, request.params.provider)));

  app.get('/dives/:id/providers/:provider/sites', {
    schema: {
      summary: 'Dive sites at the Provider, nearest to the Dive first, to pick the site ID from (SSI: the sites of the User\'s logbook)',
      params: DiveProviderParams,
      response: {
        200: Type.Array(Type.Object({
          id: Type.String({ description: 'The Provider\'s site ID' }), name: Type.String(),
          latitude: Nullable(Type.Number()), longitude: Nullable(Type.Number()),
          country: Nullable(Type.String({ description: 'As the Provider gives it' })),
          distanceM: Nullable(Type.Integer({ description: 'From the Dive site, else the Dive\'s position' })),
        })),
        ...errors,
      },
    },
  }, async (request) => pushes.siteSuggestions(request.user!.id, request.params.id, request.params.provider));

  app.post('/dives/:id/providers/:provider', {
    schema: {
      summary: 'Send the Dive to the Provider: updates its remote dive, or creates one',
      description: 'Before creating, a dive at about the same time already at the Provider is answered with outcome exists and nothing is '
        + 'sent; send again with onExisting link (tie the Dive to it) or create (a second dive). Mind the Provider\'s notices.',
      params: DiveProviderParams,
      body: Type.Object({ onExisting: Type.Optional(Type.Enum(['link', 'create'])) }, { additionalProperties: false }),
      response: {
        200: Type.Object({
          outcome: Type.Enum(['created', 'updated', 'linked', 'exists'], {
            description: 'exists: nothing was sent; a dive at the same time is there. Send again with onExisting link or create',
          }),
          existing: Nullable(Existing),
          status: StatusView,
        }),
        ...errors,
      },
    },
  }, async (request) => {
    const { id, provider } = request.params;
    const sent = await pushes.send(request.user!.id, id, provider, request.body.onExisting);
    return {
      outcome: sent.result, existing: sent.result === 'exists' ? sent.existing : null,
      status: statusView(await pushes.status(request.user!.id, id, provider)),
    };
  });

  app.delete('/dives/:id/providers/:provider', {
    schema: {
      summary: 'Delete the Dive\'s copy at the Provider (SSI hides it; its app has no way back). The Dive stays here',
      params: DiveProviderParams, response: { 200: StatusView, ...errors },
    },
  }, async (request) => {
    const { id, provider } = request.params;
    await pushes.remove(request.user!.id, id, provider);
    return statusView(await pushes.status(request.user!.id, id, provider));
  });
};

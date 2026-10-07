// Providers over HTTP (ADR 0024, 0027): what each Provider offers, the User's Connections, and a Dive at each Provider.
// Passwords, tokens and other credentials go in, never out: no response carries them.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyReply } from 'fastify';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireUser } from '../auth/fastify.js';
import { Problem, problem, PROBLEMS, providerProblem, type ProblemCode } from '../http/problems.js';
import { DIVE_IMPORT_MODES, MATCHING_WINDOWS, PARTICIPANT_ROLES, UTC_OFFSET_SOURCES } from '../db/schema.js';
import { ImportView, toImportView } from '../routes.js';
import { SITE_SOURCES, SOURCE_INFO } from '../sites/sources.js';
import type { BuddyService } from './buddy-service.js';
import type { ConnectionService } from './connection-service.js';
import type { DiveImportService } from './dive-import.js';
import { SYNCED_FIELDS } from './three-way.js';
import { FIND_BY, OPERATIONS, type ProviderAdapter, type Requirement } from './provider.js';
import type { PushRow, PushService } from './push-service.js';
import { ProviderServiceError, type ProviderRegistry } from './registry.js';

export interface ProviderRouteDeps {
  auth: Auth;
  providers: ProviderRegistry;
  connections: ConnectionService;
  pushes: PushService;
  buddies: BuddyService;
  diveImports: DiveImportService;
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

const RoleList = Type.Array(Type.Enum([...PARTICIPANT_ROLES]));

const RequirementView = Type.Object({
  type: Type.String({
    description: 'site_external_id: the Dive site\'s External ID at source. diver_mapping: the Provider can tell who each Participant in '
      + 'roles is. A client that doesn\'t know the type shows description and that it can\'t be fixed there (docs/spec/clients.md)',
  }),
  severity: Type.Enum(['blocking', 'advisory'], { description: 'blocking: sending refuses while unmet. advisory: sent without it; the Push says what was left out' }),
  description: Type.String({ description: 'English; only for a client that doesn\'t know the type' }),
  source: Type.String({ description: 'site_external_id: a site Source. diver_mapping: the service whose account a Diver needs' }),
  typed: Nullable(Type.Boolean({ description: 'site_external_id: Users may type an ID (PUT /api/dive-sites/{id}/external-ids/{source})' })),
  pattern: Nullable(Type.String({ description: 'site_external_id: what the bare ID looks like (a regular expression)' })),
  prefixes: Nullable(Type.Array(Type.String(), { description: 'site_external_id: what may come before the ID as the Source shows it, e.g. "site:"' })),
  roles: Nullable(RoleList),
}, { description: 'What sending needs (ADR 0029)' });

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
        requirements: Type.Array(RequirementView),
        readBackFields: Type.Array(Type.String(), { description: 'Field names read-back differences are reported under; translate them' }),
      })),
      import: Nullable(Direction),
    })),
    diveSites: Nullable(Type.Object({ import: Nullable(Direction) })),
    buddies: Nullable(Type.Object({ import: Nullable(Direction) }, {
      description: 'find: the account\'s own list of people (SSI: the buddy list), GET /api/connections/{id}/buddies',
    })),
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
  diveImport: Nullable(Type.Object({
    mode: Type.Enum([...DIVE_IMPORT_MODES], {
      description: 'off; add: only link and fill Dives here, never create; create: also create Dives Dive Hub doesn\'t have',
    }),
    windowMinutes: Type.Integer({ description: 'How far apart in local time a logbook entry and a Dive here may start, on the same day' }),
  }, { description: 'What importing this account\'s dives may do (ADR 0030); null when the Provider imports no dives' })),
});

const LeftOut = Type.Object({
  diverId: Type.String(),
  name: Type.String(),
  reason: Type.Enum(['no_reference', 'not_at_provider'], {
    description: 'no_reference: nothing tells the Provider who they are (give the Diver an account there). '
      + 'not_at_provider: the Provider doesn\'t have them (SSI: add them to your buddy list in SSI\'s app, then update)',
  }),
});

const UnmetView = Type.Object({
  type: Type.String({ description: 'As in the Provider\'s requirements' }),
  severity: Type.Enum(['blocking', 'advisory']),
  source: Type.String(),
  siteId: Type.Optional(Nullable(Type.String({ description: 'site_external_id: the Dive site to give the ID; null: choose a site first' }))),
  diverId: Type.Optional(Type.String({ description: 'diver_mapping: the Participant' })),
  diverName: Type.Optional(Type.String()),
  role: Type.Optional(Type.Enum([...PARTICIPANT_ROLES])),
  fixes: Type.Optional(Type.Array(Type.String(), {
    description: 'diver_mapping: ways to fix it. diver_external_id: set the Diver\'s account at source (PUT /api/divers/{id}/external-ids/{source})',
  })),
}, { description: 'A requirement this Dive doesn\'t meet, from Dive Hub\'s own data' });

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
  leftOut: Nullable(Type.Array(LeftOut, { description: 'Participants this Push couldn\'t carry; clients say so (ADR 0029)' })),
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
  unmet: Type.Array(UnmetView, { description: 'What the Provider\'s requirements need and the Dive lacks; never asks the Provider' }),
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
  provider_sign_in_needed: 409, provider_requirements_unmet: 409, provider_not_sent: 409, provider_dive_gone: 409, provider_busy: 409,
  provider_unavailable: 502, provider_refused: 502, provider_import_off: 409, provider_account_held: 409,
};
/** A refusal about a Provider; with provider_requirements_unmet, what is unmet. */
const ProviderProblem = Type.Object({
  ...Problem.properties,
  diver: Type.Optional(Type.Object({
    id: Type.String(), name: Type.String(), dives: Type.Integer({ description: 'The Dives it is a Participant on' }),
  }, { description: 'With provider_account_held: the external Diver here with this account; connect again with claim to make it yours' })),
  unmet: Type.Optional(Type.Array(UnmetView, { description: 'With provider_requirements_unmet: every requirement unmet, blocking ones among them' })),
});
const errors = { 400: Problem, 404: Problem, 409: ProviderProblem, 502: Problem };

/** Answers a refusal about a Provider: its status, its code and the Provider named, with `extra` (such as the copies). */
export function replyProviderError(error: ProviderServiceError, reply: FastifyReply, extra: object = {}) {
  const status = PROVIDER_STATUS[error.code] ?? 500;
  return reply.code(status).send({ ...(error.provider ? providerProblem(error.code, error.provider) : problem(error.code)), ...error.extra, ...extra });
}

export const pushView = (p: PushRow): Static<typeof PushView> => ({
  id: p.id, action: p.action, state: p.state, remoteId: p.remoteId, remoteNumber: p.remoteNumber, remoteGone: p.remoteGone,
  failureCode: p.errorCode as ProblemCode | null,
  leftOut: p.leftOut, differences: p.differences, createdAt: p.createdAt.toISOString(),
});

/** A requirement with what clients need to offer its fix: a typed site ID's forms come from its Source. */
function requirementView(r: Requirement): Static<typeof RequirementView> {
  const none = { typed: null, pattern: null, prefixes: null, roles: null };
  if (r.type === 'diver_mapping') return { type: r.type, severity: r.severity, description: r.description, source: r.source, ...none, roles: r.roles };
  const info = SOURCE_INFO[r.source];
  return {
    type: r.type, severity: r.severity, description: r.description, source: r.source, ...none,
    typed: !!info.typed, pattern: info.idPattern.source, prefixes: info.typed?.prefixes ?? [],
  };
}

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
          ...direction(exports)!, delivery: exports.delivery, requirements: exports.requirements.map(requirementView),
          readBackFields: exports.readBackFields ?? [],
        } : null,
        import: direction(dives.import),
      } : null,
      diveSites: c.data.diveSites ? { import: direction(c.data.diveSites.import) } : null,
      buddies: c.data.buddies ? { import: direction(c.data.buddies.import) } : null,
    },
    notices: c.notices, limits: c.limits,
  };
}

export const providerRoutes: FastifyPluginAsyncTypebox<ProviderRouteDeps> = async (app, { auth, providers, connections, pushes, buddies, diveImports }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProviderServiceError) return replyProviderError(error, reply);
    throw error;
  });

  // A string, not an enum: clients take the Providers from GET /api/providers, and the registry refuses others.
  const ProviderParam = Type.String({ pattern: '^[a-z][a-z0-9_]*$', description: 'A Provider\'s id (GET /api/providers); others answer provider_unsupported' });
  const DiveProviderParams = Type.Object({ id: Type.String({ format: 'uuid' }), provider: ProviderParam });

  const importsDives = (provider: string) => !!providers.list().find((a) => a.id === provider)?.capabilities.data.dives?.import?.operations.includes('list');
  const connectionView = (c: Awaited<ReturnType<ConnectionService['list']>>[number]): Static<typeof ConnectionView> => {
    const { importMode, importWindowMinutes, ...rest } = c;
    return {
      ...rest, lastUsedAt: c.lastUsedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
      diveImport: importsDives(c.provider) ? { mode: importMode, windowMinutes: importWindowMinutes } : null,
    };
  };
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
        claim: Type.Optional(Type.Boolean({
          description: 'An external Diver here with this account is this person: merge it into the Diver (ADR 0028). Ask the User first: provider_account_held names it',
        })),
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

  const BuddyView = Type.Object({
    name: Type.String({ description: 'As the Provider has it' }),
    account: Nullable(Type.String({ description: 'The person\'s own account at the Provider; null: none (can\'t be imported yet)' })),
    diver: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, { description: 'The Diver here with that account' })),
  });

  app.get('/connections/:id/buddies', {
    schema: {
      summary: 'The account\'s own list of people at the Provider (SSI: the buddy list), read live, each with the Diver here who has their account',
      description: 'Only names and accounts; nothing else the Provider keeps about them is passed on or stored (ADR 0029).',
      params: IdParams, response: { 200: Type.Object({ buddies: Type.Array(BuddyView) }), ...errors },
    },
  }, async (request) => ({ buddies: await buddies.list(request.user!.id, request.params.id) }));

  app.post('/connections/:id/buddies/import', {
    schema: {
      summary: 'Add the chosen people from the account\'s list as external Divers, with their name and account',
      description: 'Entries whose account a Diver already has, or without an account, are skipped. To link an entry to a Diver here '
        + 'instead, set that Diver\'s account (PUT /api/divers/{id}/external-ids/{source}).',
      params: IdParams,
      body: Type.Object({ accounts: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 500 }) }, { additionalProperties: false }),
      response: { 200: Type.Object({ created: Type.Integer(), buddies: Type.Array(BuddyView) }), ...errors },
    },
  }, async (request) => buddies.import(
    { userId: request.user!.id, isAdmin: request.user!.role === 'admin' }, request.params.id, request.body.accounts,
  ));

  const Choice = Type.Enum(['recordings', 'entries'], {
    description: 'recordings: its dives become Recordings, like a file\'s; entries: only logbook entries that fill Dives here',
  });
  const ComputerChoices = Type.Array(Type.Object({ key: Type.String({ maxLength: 200 }), choice: Choice }, { additionalProperties: false }), {
    maxItems: 100, description: 'Per dive computer found at the Provider (its key from the preview): how its dives are used',
  });

  app.patch('/connections/:id', {
    schema: {
      summary: 'Change what importing the account\'s dives may do, the matching window, and the choice per dive computer (ADR 0030)',
      params: IdParams,
      body: Type.Object({
        diveImport: Type.Object({
          mode: Type.Optional(Type.Enum([...DIVE_IMPORT_MODES])),
          windowMinutes: Type.Optional(Type.Union(MATCHING_WINDOWS.map((m) => Type.Literal(m)), { description: '5, 15, 30 or 60' })),
          computers: Type.Optional(ComputerChoices),
        }, { additionalProperties: false }),
      }, { additionalProperties: false }),
      response: { 200: ConnectionView, ...errors },
    },
  }, async (request) => {
    const { computers, ...set } = request.body.diveImport;
    await diveImports.settings(request.user!.id, request.params.id, {
      ...set, ...(computers && { computers: Object.fromEntries(computers.map((c) => [c.key, c.choice])) }),
    });
    return oneConnection(request.user!.id, request.params.id);
  });

  const Candidate = Type.Object({
    diveId: Type.String(),
    number: Nullable(Type.Integer()),
    startsAt: DateTime,
    utcOffsetSeconds: Nullable(Type.Integer()),
    utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES]),
    durationSeconds: Type.Number(),
    maxDepthM: Nullable(Type.Number()),
    site: Nullable(Type.Object({ id: Type.String(), name: Type.String() })),
  });
  const ConflictValue = Type.Union([Type.String(), Type.Number(), Type.Array(Type.String())], {
    description: 'site: its name; buddies: the names of Divers here (people Dive Hub doesn\'t know are left out); startsAt: local "YYYY-MM-DD HH:MM"',
  });
  const Preview = Type.Object({
    mode: Type.Enum([...DIVE_IMPORT_MODES]),
    windowMinutes: Type.Integer(),
    computers: Type.Array(Type.Object({
      key: Type.String({ description: 'Send it back with the choice' }),
      manufacturer: Type.String(), product: Nullable(Type.String()), serialNumber: Type.String(),
      dives: Type.Integer(),
      choice: Choice,
      suggested: Choice,
      fromFiles: Type.Boolean({ description: 'Dive Hub has recordings of this computer from files: they are better (so the suggestion is entries)' }),
      otherDiver: Type.Boolean({ description: 'The computer is another User\'s Diver\'s: its dives come in as logbook entries whatever the choice' }),
    }), { description: 'The dive computers found, most dives first; the User chooses once per computer (kept on the Connection)' }),
    counts: Type.Object({
      total: Type.Integer(),
      unreadable: Type.Integer({ description: 'Records that are no dive Dive Hub can read' }),
      ours: Type.Integer({ description: 'Sent by Dive Hub: never imported back' }),
      linked: Type.Integer({ description: 'Linked to a Dive here already: only filled where still empty' }),
      deleted: Type.Integer({ description: 'On a Dive deleted here: stays deleted' }),
      recordings: Type.Integer({ description: 'From a computer: become Recordings' }),
      link: Type.Integer({ description: 'One Dive here in the window: linked and filled' }),
      decide: Type.Integer({ description: 'Several Dives here in the window: in decisions' }),
      create: Type.Integer({ description: 'No Dive here: a Dive without a Recording (mode create)' }),
      noMatch: Type.Integer({ description: 'No Dive here, and the mode only adds: left out' }),
      changed: Type.Integer({ description: 'Linked dives changed at the Provider since Dive Hub last saw them: the Dive takes the changes' }),
    }),
    sites: Type.Object({
      known: Type.Integer({ description: 'A site here has the Provider\'s site ID' }),
      match: Type.Integer({ description: 'A site here is the same by name and position (within 100 m): it gets the ID' }),
      create: Type.Integer({ description: 'New: made from the Provider\'s site data (allowed by an admin)' }),
      missing: Type.Integer({ description: 'New, but not allowed (or the Provider says nothing about it): the Dive gets no site' }),
    }, { description: 'The distinct sites the dives name, for Dives that have no site yet (ADR 0030)' }),
    sitesAllowed: Type.Boolean({ description: 'An admin allowed creating sites from this Provider\'s site data' }),
    conflicts: Type.Array(Type.Object({
      remoteId: Type.String(),
      remoteNumber: Nullable(Type.Integer()),
      diveId: Type.String(),
      number: Nullable(Type.Integer()),
      startsAt: DateTime,
      utcOffsetSeconds: Nullable(Type.Integer()),
      utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES]),
      field: Type.Enum([...SYNCED_FIELDS], { description: 'values (startsAt, …) only on Dives without a Recording' }),
      hub: Nullable(ConflictValue),
      provider: Nullable(ConflictValue),
    }), { description: 'Fields changed both at the Provider and here since Dive Hub last saw the dive: the User chooses; Dive Hub\'s stays unless told' }),
    decisions: Type.Array(Type.Object({
      remoteId: Type.String(),
      remoteNumber: Nullable(Type.Integer()),
      localStart: Type.String({ description: 'Local wall-clock time as the Provider keeps it, without a time zone' }),
      durationSeconds: Type.Number(),
      maxDepthM: Nullable(Type.Number()),
      candidates: Type.Array(Candidate, { description: 'The Dives here it may be, closest first' }),
    }), { description: 'Logbook entries with several Dives here in the window: one of them, a new Dive (mode create), or leave it out' }),
  });

  const DiveTimes = Type.Object({
    provider: Type.String(),
    dives: Type.Array(Type.Object({
      remoteId: Type.String(),
      remoteNumber: Nullable(Type.Integer()),
      localStart: Type.String({ description: 'Local wall-clock time as the Provider keeps it, without a time zone' }),
      durationSeconds: Type.Number(),
      maxDepthM: Nullable(Type.Number()),
      madeBy: Type.Enum(['ours', 'computer', 'logbook'], { description: 'ours: Dive Hub sent it; computer: synced from a dive computer; logbook: typed by hand' }),
      createdAt: Nullable(Type.String({ description: 'When the Provider made the record, as it keeps it' })),
      confirmedByCentre: Type.Boolean(),
      confirmedByLeader: Type.Boolean(),
    })),
  });

  app.get('/connections/:id/dive-times', {
    schema: {
      summary: 'How each dive at the Provider came about and when it starts, oldest first (to find why times differ); stores nothing',
      description: 'Works whatever the import mode of the Connection is. One paced action at the Provider. No names of people or places.',
      params: IdParams, response: { 200: DiveTimes, ...errors },
    },
  }, async (request) => diveImports.diveTimes(request.user!.id, request.params.id));

  app.get('/connections/:id/dive-import', {
    schema: {
      summary: 'Preview importing the account\'s dives (ADR 0030): reads them from the Provider and says what would happen; stores nothing',
      description: 'provider_import_off while the Connection\'s import mode is off. One paced action at the Provider.',
      params: IdParams, response: { 200: Preview, ...errors },
    },
  }, async (request) => {
    const p = await diveImports.preview(request.user!.id, request.params.id);
    return {
      ...p,
      decisions: p.decisions.map((d) => ({ ...d, candidates: d.candidates.map((c) => ({ ...c, startsAt: c.startsAt.toISOString() })) })),
      conflicts: p.conflicts.map((c) => ({ ...c, startsAt: c.startsAt.toISOString() })),
    };
  });

  app.post('/connections/:id/dive-import', {
    schema: {
      summary: 'Import the account\'s dives (ADR 0030): reads them again, stores one Original per dive, and starts an Import',
      description: 'Send the choice per computer and the decisions from the preview. The Import runs in the background like an upload '
        + '(GET /api/imports/{id}); an entry that turned ambiguous since the preview is left out (reason ambiguous). It can be run again.',
      params: IdParams,
      body: Type.Object({
        computers: ComputerChoices,
        decisions: Type.Array(Type.Object({
          remoteId: Type.String({ maxLength: 40 }),
          choice: Type.String({ pattern: '^(new|leave_out|[0-9a-f-]{36})$', description: 'A candidate\'s diveId, new, or leave_out' }),
        }, { additionalProperties: false }), { maxItems: 2000 }),
        conflicts: Type.Optional(Type.Array(Type.Object({
          remoteId: Type.String({ maxLength: 40 }),
          field: Type.Enum([...SYNCED_FIELDS]),
          choice: Type.Enum(['hub', 'provider'], { description: 'hub: the Dive keeps its value; provider: it takes the Provider\'s' }),
        }, { additionalProperties: false }), { maxItems: 2000 })),
      }, { additionalProperties: false }),
      response: { 202: ImportView, ...errors },
    },
  }, async (request, reply) => {
    const created = await diveImports.start(request.user!.id, request.params.id, {
      computers: Object.fromEntries(request.body.computers.map((c) => [c.key, c.choice])),
      decisions: Object.fromEntries(request.body.decisions.map((d) => [d.remoteId, d.choice])),
      conflicts: Object.fromEntries((request.body.conflicts ?? []).map((c) => [`${c.remoteId}:${c.field}`, c.choice])),
    });
    return reply.code(202).send(toImportView(created));
  });

  const SiteDataView = Type.Object({
    provider: Type.String(),
    name: Type.String(),
    allowedAt: Nullable(DateTime),
    allowedBy: Nullable(Type.String({ description: 'The admin who allowed it, by name' })),
  });
  const siteDataView = (r: Awaited<ReturnType<DiveImportService['siteData']>>[number]) => ({ ...r, allowedAt: r.allowedAt?.toISOString() ?? null });

  app.get('/admin/provider-site-data', {
    onRequest: requireAdmin,
    schema: {
      summary: 'Admins: per Provider whose dives Users import, whether new Dive sites may be made from its site data (ADR 0030)',
      response: { 200: Type.Object({ providers: Type.Array(SiteDataView) }), 403: Problem },
    },
  }, async () => ({ providers: (await diveImports.siteData()).map(siteDataView) }));

  app.put('/admin/provider-site-data/:provider', {
    onRequest: requireAdmin,
    schema: {
      summary: 'Admins: allow or stop making Dive sites from a Provider\'s site data when Users import dives',
      description: 'SSI gives no licence for its site data (ADR 0024): allowing needs confirm true, after showing the same '
        + 'explanation as the SSI site import (provider_site_data_not_confirmed). Without it, imports only link sites already here.',
      params: Type.Object({ provider: ProviderParam }),
      body: Type.Object({ allowed: Type.Boolean(), confirm: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      response: { 200: Type.Object({ providers: Type.Array(SiteDataView) }), 400: Problem, 403: Problem },
    },
  }, async (request, reply) => {
    if (request.body.allowed && request.body.confirm !== true) return reply.code(400).send(problem('provider_site_data_not_confirmed'));
    await diveImports.allowSiteData(request.user!.id, request.params.provider, request.body.allowed);
    return { providers: (await diveImports.siteData()).map(siteDataView) };
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
      summary: 'The Dive at every Provider that takes dives: the Connection of its Diver, what is unmet, the remote dive it has now, every Push',
      params: IdParams, response: { 200: Type.Array(StatusView), 404: Problem },
    },
  }, async (request) => (await pushes.statusAll(request.user!.id, request.params.id)).map(statusView));

  app.get('/dives/:id/providers/:provider', {
    schema: {
      summary: 'The Dive at one Provider: the Connection of its Diver, what is unmet, the remote dive it has now, every Push',
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

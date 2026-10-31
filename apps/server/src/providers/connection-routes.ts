// The Providers and the User's Connections over HTTP (ADR 0024, 0027): what each Provider offers, connecting, signing in again,
// the settings of a Connection and disconnecting. Registered inside the provider routes, so the sign-in hook and the error handler are theirs.
// Passwords, tokens and other credentials go in, never out: no response carries them.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from 'typebox';
import { userOf } from '../auth/fastify.js';
import { Problem } from '../http/problems.js';
import { DIVE_IMPORT_MODES, MATCHING_WINDOWS, PARTICIPANT_ROLES } from '../db/schema.js';
import { SOURCE_INFO } from '../sites/sources.js';
import { IdParams, Nullable } from '../http/schemas.js';
import { automationOffers, type ConnectionService } from './connection-service.js';
import type { ConflictService } from './conflicts/conflict-service.js';
import type { DiveImportService } from './dive-import/dive-import.js';
import { FIND_BY, OPERATIONS, type ProviderAdapter, type Requirement } from './provider.js';
import type { ProviderRegistry } from './registry.js';
import { ComputerChoices, errors, ProviderParam } from './route-parts.js';
import { ConnectionView } from './connection-view.js';
import type { ScheduledFetch } from './dive-import/scheduled-fetch.js';
import type { WaitingPushService } from './waiting-push/waiting-push-service.js';

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
  createdBySend: Nullable(Type.Boolean({ description: 'site_external_id: a send finds or creates the site at the Provider when the site has a position' })),
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
        numbers: Nullable(Type.Object({
          set: Type.Array(Type.Enum(['create', 'update']), { description: 'The operations on which a client sets the dive\'s number here; update goes with POST /api/dives/{id}/providers/{provider}/number' }),
          changeRemovesVerification: Type.Boolean({ description: 'Changing the number of a dive already there can remove a verification it has: warn before' }),
        }, { description: 'ADR 0048: null when the Provider numbers by itself. Else a Connection can be set to number dives here as in Dive Hub (diveNumbers.follow)' })),
      })),
      import: Nullable(Direction),
      fields: Type.Optional(Type.Record(Type.String(), Type.Array(Type.Union([Type.Literal('import'), Type.Literal('export')])), {
        description: 'Which way each value of a dive travels; absent: every value travels both ways as far as the Provider\'s operations allow (imported if it imports, sent if it exports); present: a value missing from the map is not imported',
      })),
    })),
    diveSites: Nullable(Type.Object({ import: Nullable(Direction) })),
    buddies: Nullable(Type.Object({ import: Nullable(Direction) }, {
      description: 'find: the account\'s own list of people (SSI: the buddy list), GET /api/connections/{id}/buddies',
    })),
    certifications: Nullable(Type.Object({ import: Nullable(Direction) }, {
      description: 'find: the account\'s certification cards (SSI: get_ccards), POST /api/connections/{id}/certifications/import (ADR 0050)',
    })),
  }),
  notices: Type.Array(Type.Enum(['shows_unconfirmed', 'presents_as_app']), { description: 'Things a client must say: shows_unconfirmed, the Provider shows dives sent this way as unconfirmed; presents_as_app, Dive Hub introduces itself to the Provider as its own app (ADR 0049)' }),
  limits: Type.Object({
    pauseMs: Type.Integer({ description: 'Pause between two actions on one Connection; requests wait their turn' }),
    run: Nullable(Type.Object({
      pauseMs: Type.Integer({ description: 'Pause between two Dives of a Push run' }),
      maxDives: Type.Integer({ description: 'The most Dives one Push run sends; start again for the rest' }),
    }, { description: 'ADR 0047; null: the Provider takes no Push runs' })),
    fetchEveryMinutes: Nullable(Type.Integer({
      description: 'The shortest interval of a scheduled fetch of its dives, in minutes; null: no scheduled fetch. A Connection\'s `offers.fetchEvery` is already narrowed by it',
    })),
  }),
});

/** A requirement with what clients need to offer its fix: a typed site ID's forms come from its Source. */
function requirementView(r: Requirement): Static<typeof RequirementView> {
  const none = { typed: null, pattern: null, prefixes: null, createdBySend: null, roles: null };
  if (r.type === 'diver_mapping') return { type: r.type, severity: r.severity, description: r.description, source: r.source, ...none, roles: r.roles };
  const info = SOURCE_INFO[r.source];
  return {
    type: r.type, severity: r.severity, description: r.description, source: r.source, ...none,
    typed: !!info.typed, pattern: info.idPattern.source, prefixes: info.typed?.prefixes ?? [], createdBySend: !!r.createdBySend,
  };
}

function providerView(a: ProviderAdapter, canKeepPasswords: boolean): Static<typeof ProviderView> {
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
          readBackFields: exports.readBackFields ?? [], numbers: exports.numbers ?? null,
        } : null,
        import: direction(dives.import),
        ...(dives.fields && { fields: dives.fields }),
      } : null,
      diveSites: c.data.diveSites ? { import: direction(c.data.diveSites.import) } : null,
      buddies: c.data.buddies ? { import: direction(c.data.buddies.import) } : null,
      certifications: c.data.certifications ? { import: direction(c.data.certifications.import) } : null,
    },
    notices: c.notices, limits: c.limits,
  };
}

export interface ConnectionRouteDeps {
  providers: ProviderRegistry;
  connections: ConnectionService;
  diveImports: DiveImportService;
  waitingPushes: WaitingPushService;
  conflicts: ConflictService;
  scheduledFetch: ScheduledFetch;
}

export const connectionRoutes: FastifyPluginAsyncTypebox<ConnectionRouteDeps> = async (app, { providers, connections, diveImports, waitingPushes, conflicts, scheduledFetch }) => {
  const importsDives = (provider: string) => !!providers.list().find((a) => a.id === provider)?.capabilities.data.dives?.import?.operations.includes('list');
  const hasNumbers = (provider: string) => !!providers.list().find((a) => a.id === provider)?.capabilities.data.dives?.export?.numbers;
  type ListedConnection = Awaited<ReturnType<ConnectionService['list']>>[number];
  /** The Connections with what they show besides the row: offers, the queue's counts, the last fetch and the unsent Dives. */
  const connectionViews = async (userId: string, rows: ListedConnection[]): Promise<Static<typeof ConnectionView>[]> => {
    const shown = await waitingPushes.overview(rows);
    // Conflicts that wait for the User, whenever they were found: apart from what a manual import asks about.
    const clashes = new Map((await conflicts.waiting(userId)).map((c) => [c.connectionId, c.entries.filter((e) => e.kind === 'conflict').length]));
    return rows.map((c) => {
      const { importMode, importWindowMinutes, followNumbers, lastFetchImportId: _, ...rest } = c;
      const { waiting, lastFetch, unsentDives } = shown.get(c.id)!;
      const { fetchMinimum: __, ...offers } = automationOffers(providers.get(c.provider));
      return {
        // The column's check keeps it to the three intervals.
        ...rest, fetchEveryMinutes: c.fetchEveryMinutes as 60 | 360 | 1440 | null, lastUsedAt: c.lastUsedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
        diveNumbers: hasNumbers(c.provider) ? { follow: followNumbers } : null,
        diveImport: importsDives(c.provider) ? { mode: importMode, windowMinutes: importWindowMinutes } : null,
        offers, waiting, unsentDives,
        lastFetch: lastFetch && {
          at: lastFetch.at.toISOString(), created: lastFetch.created, updated: lastFetch.updated,
          waitingForYou: lastFetch.skipped, conflicts: clashes.get(c.id) ?? 0,
        },
      };
    });
  };
  const oneConnection = async (userId: string, id: string) =>
    (await connectionViews(userId, (await connections.list(userId)).filter((c) => c.id === id)))[0]!;

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
  }, async (request) => connectionViews(userOf(request).id, await connections.list(userOf(request).id)));

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
    const id = await connections.connect(userOf(request).id, request.params.provider, diverId, fields);
    return reply.code(201).send(await oneConnection(userOf(request).id, id));
  });

  app.post('/connections/:id/sign-in', {
    schema: {
      summary: 'Sign in to the Provider again with the Connection\'s login (after the access expired), and choose again whether to keep the password',
      params: IdParams,
      body: Type.Object({ password: Type.Optional(Secret), token: Type.Optional(Secret), keepSignedIn: KeepSignedIn }, { additionalProperties: false }),
      response: { 200: ConnectionView, ...errors },
    },
  }, async (request) => {
    await connections.signInAgain(userOf(request).id, request.params.id, request.body);
    return oneConnection(userOf(request).id, request.params.id);
  });

  app.patch('/connections/:id', {
    schema: {
      summary: 'Change what importing the account\'s dives may do, the matching window, the choice per dive computer (ADR 0030), whether dives are numbered at the Provider as in Dive Hub (ADR 0048), and what the Connection does by itself (ADR 0056)',
      description: 'diveNumbers.follow turns on numbering at the Provider; it sends nothing by itself. 400 provider_unsupported at a Provider that declares no numbers. '
        + 'sendChanges, sendNewDives and deleteAtProvider turn on sending, sending new Dives and deleting by itself; fetchEveryMinutes (60, 360, 1440, or null for off) the scheduled fetch. '
        + 'Turning one on queues nothing that changed before. Only what `offers` of the Connection lists: 400 provider_unsupported otherwise (turning off is always allowed), '
        + '400 fetch_interval_too_short for an interval below the minimum of the Provider. At least one property.',
      params: IdParams,
      body: Type.Object({
        diveImport: Type.Optional(Type.Object({
          mode: Type.Optional(Type.Enum([...DIVE_IMPORT_MODES])),
          windowMinutes: Type.Optional(Type.Union(MATCHING_WINDOWS.map((m) => Type.Literal(m)), { description: '5, 15, 30 or 60' })),
          computers: Type.Optional(ComputerChoices),
        }, { additionalProperties: false })),
        diveNumbers: Type.Optional(Type.Object({ follow: Type.Boolean() }, { additionalProperties: false })),
        sendChanges: Type.Optional(Type.Boolean()),
        sendNewDives: Type.Optional(Type.Boolean()),
        deleteAtProvider: Type.Optional(Type.Boolean()),
        fetchEveryMinutes: Type.Optional(Nullable(Type.Union([Type.Literal(60), Type.Literal(360), Type.Literal(1440)], {
          description: '60, 360 or 1440; null turns the scheduled fetch off',
        }))),
      }, { additionalProperties: false, minProperties: 1 }),
      response: { 200: ConnectionView, ...errors },
    },
  }, async (request) => {
    const { diveImport, diveNumbers, ...automation } = request.body;
    const userId = userOf(request).id;
    // Every part is checked before any is written: a refusal in one changes nothing.
    const parts = Object.keys(automation).length > 0;
    await connections.checkChanges(userId, request.params.id, { ...(parts && { automation }), ...(diveNumbers && { follow: diveNumbers.follow }) });
    if (diveImport) await diveImports.checkSettings(userId, request.params.id);
    if (parts) await connections.setAutomation(userId, request.params.id, automation);
    if (diveImport) {
      const { computers, ...set } = diveImport;
      await diveImports.settings(userOf(request).id, request.params.id, {
        ...set, ...(computers && { computers: Object.fromEntries(computers.map((c) => [c.key, c.choice])) }),
      });
    }
    if (diveNumbers) await connections.setFollowNumbers(userOf(request).id, request.params.id, diveNumbers.follow);
    return oneConnection(userOf(request).id, request.params.id);
  });

  app.post('/connections/fetch-due', {
    schema: {
      summary: 'The User opened Dive Hub: fetch from each of their Connections with "Fetch from <Provider>" on whose last fetch is more than an hour old (ADR 0056)',
      description: 'Clients call it once when they start. Each fetch runs in the background as an unattended Import, never sooner than the '
        + 'Provider\'s minimum; a Connection that needs a sign-in, has its import off, or has an import waiting or running is left out. '
        + 'Answers how many fetches were queued.',
      response: { 200: Type.Object({ queued: Type.Integer() }), 401: Problem },
    },
  }, async (request) => ({ queued: await scheduledFetch.fetchDue(userOf(request).id) }));

  app.post('/connections/:id/unsent-dives/dismiss', {
    schema: {
      summary: 'Dismiss the offer to send the new Dives of a large Import (ADR 0056)',
      description: "The Dives stay as they are and can be sent later. The Connection's owner only (others: 404).",
      params: IdParams, response: { 204: Type.Null(), 404: Problem },
    },
  }, async (request, reply) => {
    await waitingPushes.dismissOffer(userOf(request).id, request.params.id);
    return reply.code(204).send(null);
  });

  app.delete('/connections/:id', {
    schema: {
      summary: 'Disconnect: forgets the credentials. Dives already at the Provider stay there; their history stays here',
      params: IdParams, response: { 204: Type.Null(), 404: Problem },
    },
  }, async (request, reply) => {
    await connections.disconnect(userOf(request).id, request.params.id);
    return reply.code(204).send(null);
  });
};

// Providers over HTTP (ADR 0024, 0027): what each Provider offers, the User's Connections, and a Dive at each Provider.
// Passwords, tokens and other credentials go in, never out: no response carries them.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyReply } from 'fastify';
import { Type, type Static, type TOptional } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireUser, userOf } from '../auth/fastify.js';
import { Problem, problem, PROBLEMS, providerProblem, type ProblemCode } from '../http/problems.js';
import { CYLINDER_MATERIALS, DIVE_IMPORT_MODES, MATCHING_WINDOWS, PARTICIPANT_ROLES, UTC_OFFSET_SOURCES } from '../db/schema.js';
import { ImportView, toImportView } from '../routes.js';
import { SOURCE_INFO } from '../sites/sources.js';
import { SITE_WATER_TYPES } from '../vocabulary.js';
import type { BuddyService } from './buddy-service.js';
import { automationOffers, type ConnectionService } from './connection-service.js';
import type { DiveImportService } from './dive-import.js';
import type { ConflictService } from './conflicts.js';
import type { GoneDiveService } from './gone-dives.js';
import type { WaitingPushService } from './waiting-push-service.js';
import { UnmetView } from './unmet-view.js';
import { WaitingPushViewSchema } from './waiting-push-view.js';
import type { ScheduledFetch } from './scheduled-fetch.js';
import { SYNCED_FIELDS, type SyncedField } from './three-way.js';
import { FIND_BY, OPERATIONS, type ProviderAdapter, type Requirement } from './provider.js';
import { pushRunRoutes } from './push-run-routes.js';
import type { PushRunService } from './push-run-service.js';
import type { PushService } from './push-service.js';
import type { SitePickService } from './site-pick.js';
import type { PushRow } from './remote-state.js';
import { ProviderServiceError, type ProviderRegistry } from './registry.js';
import { CertificationError, type CertificationService } from '../certifications/certification-service.js';
import { replyCertificationError } from '../certifications/routes.js';
import { DateTime, IdParams, Nullable } from '../http/schemas.js';

export interface ProviderRouteDeps {
  auth: Auth;
  providers: ProviderRegistry;
  connections: ConnectionService;
  pushes: PushService;
  pushRuns: PushRunService;
  buddies: BuddyService;
  sitePicks: SitePickService;
  diveImports: DiveImportService;
  goneDives: GoneDiveService;
  waitingPushes: WaitingPushService;
  scheduledFetch: ScheduledFetch;
  conflicts: ConflictService;
  certifications: CertificationService;
}

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
  diveNumbers: Nullable(Type.Object({
    follow: Type.Boolean({ description: 'Dives are numbered here as in Dive Hub (off until the User turns it on; it sends nothing by itself)' }),
  }, { description: 'ADR 0048; null when the Provider declares no numbers' })),
  diveImport: Nullable(Type.Object({
    mode: Type.Enum([...DIVE_IMPORT_MODES], {
      description: 'off; add: only link and fill Dives here, never create; create: also create Dives Dive Hub doesn\'t have',
    }),
    windowMinutes: Type.Integer({ description: 'How far apart in local time a logbook entry and a Dive here may start, on the same day' }),
  }, { description: 'What importing this account\'s dives may do (ADR 0030); null when the Provider imports no dives' })),
  sendChanges: Type.Boolean({ description: 'Send a changed Dive by itself, 30 seconds after its last change (ADR 0056)' }),
  sendNewDives: Type.Boolean({ description: 'Send a new Dive of the Diver by itself' }),
  deleteAtProvider: Type.Boolean({
    description: 'Delete the Dive\'s copy at the Provider by itself, 5 minutes after the Dive is deleted here (Undo cancels it)',
  }),
  fetchEveryMinutes: Nullable(Type.Union([Type.Literal(60), Type.Literal(360), Type.Literal(1440)], {
    description: 'Fetch the account\'s dives by itself every 60, 360 or 1440 minutes; null: not',
  })),
  offers: Type.Object({
    sendChanges: Type.Boolean(), sendNewDives: Type.Boolean(), deleteAtProvider: Type.Boolean(),
    fetchEvery: Type.Array(Type.Integer(), { description: 'The intervals to offer, in minutes; none: the Provider has no scheduled fetch' }),
  }, { description: 'Which settings to show: only what the Provider can' }),
  waiting: Type.Object({ waiting: Type.Integer(), held: Type.Integer(), stopped: Type.Integer() }, {
    description: 'How many Waiting pushes of the Connection are in each state',
  }),
  lastFetch: Nullable(Type.Object({
    at: DateTime,
    created: Type.Integer({ description: 'New Dives' }),
    updated: Type.Integer({ description: 'Dives changed or filled' }),
    waitingForYou: Type.Integer({
      description: 'Ambiguous entries and dives of a computer with no choice yet: they wait for the User (a manual import asks about them)',
    }),
    conflicts: Type.Integer({
      description: 'Conflicts of the Connection that wait, whenever they were found: decided under "Needs your decision" (GET /api/provider-conflicts), not by an import',
    }),
  }, {
    description: 'The last scheduled fetch whose Import finished, as that Import came out: a fetch under way or failed doesn\'t replace it; '
      + 'null before the first',
  })),
  unsentDives: Type.Array(Type.String(), {
    description: 'The new Dives of a large Import (more than 20) that were not sent by themselves: offer to send them (a Push run for these ids: '
      + 'POST /api/connections/{id}/push-runs/preview with dives.ids) or Dismiss (POST /api/connections/{id}/unsent-dives/dismiss). Empty: no offer',
  }),
});

const LeftOut = Type.Object({
  diverId: Type.String(),
  name: Type.String(),
  reason: Type.Enum(['no_reference', 'not_at_provider'], {
    description: 'no_reference: nothing tells the Provider who they are (give the Diver an account there). '
      + 'not_at_provider: the Provider doesn\'t have them (SSI: add them to your buddy list in SSI\'s app, then update)',
  }),
});

const PushView = Type.Object({
  id: Type.String(),
  action: Type.Enum(['create', 'update', 'link', 'delete', 'number'], { description: 'link: tied to a dive already there, nothing sent. number: only its number there was changed (ADR 0048)' }),
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

const ConflictCylinder = Type.Object({
  volumeL: Nullable(Type.Number()),
  material: Nullable(Type.Enum([...CYLINDER_MATERIALS])),
  startPressureBar: Nullable(Type.Number()),
  endPressureBar: Nullable(Type.Number()),
  gas: Nullable(Type.Object({ o2: Type.Number(), he: Type.Number() }, { description: 'O₂ and He as percent' })),
});
const ConflictValue = Type.Union([Type.String(), Type.Number(), Type.Array(Type.String()), ConflictCylinder], {
  description: 'site: its name; buddies: the names of Divers here (people Dive Hub doesn\'t know are left out); startsAt: local "YYYY-MM-DD HH:MM"; '
    + 'cylinder: the tank typed at the Provider, or the Dive\'s only Cylinder in the same values (null: none); '
    + 'lead: the weight typed at the Provider, or the total of the Dive\'s Lead, in kg (null: none)',
});
/** A User's choice for one Conflict: the Dive's value goes out (hub), or the Provider's comes in (provider). */
const ConflictChoice = Type.Enum(['hub', 'provider']);
/** The choice per field of a Conflict (a key per synced field); a field that is no Conflict any more is ignored. */
const ConflictChoices = Type.Object(
  Object.fromEntries(SYNCED_FIELDS.map((f) => [f, Type.Optional(ConflictChoice)])) as Record<SyncedField, TOptional<typeof ConflictChoice>>, {
  additionalProperties: false,
  description: "Per Conflict: hub sends the Dive's value, provider takes the Provider's. A field that is no Conflict any more is ignored",
});

/** One field changed on both sides, differently: both values as the import preview says them (ADR 0056). */
const ConflictFieldView = Type.Object({
  field: Type.Enum([...SYNCED_FIELDS], { description: 'The field the two sides differ on' }),
  hub: Nullable(ConflictValue),
  provider: Nullable(ConflictValue),
});

const StatusView = Type.Object({
  provider: Type.String(),
  deletesItself: Type.Boolean({
    description: 'The Dive\'s Connection deletes at the Provider by itself (5 minutes after the Dive is deleted here; Undo cancels it): '
      + 'don\'t ask about deleting the copy there, and don\'t send `alsoAt` for it (docs/spec/clients.md)',
  }),
  waiting: Type.Union([Type.Null(), WaitingPushViewSchema], { description: 'The Dive\'s entry in the queue of Waiting pushes for this Provider (ADR 0056); null when none' }),
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
    updateRemovesVerification: Type.Boolean({
      description: 'An update now would remove the dive centre\'s verification of the dive at the Provider (SSI: it changes the start time there, '
        + 'or the dive was linked and never sent, so the start time there isn\'t known). Say so before sending (docs/spec/clients.md, ADR 0043)',
    }),
    number: Nullable(Type.Object({
      wanted: Type.Integer({ description: 'The Dive\'s number here' }),
      differs: Type.Boolean({ description: 'The Provider\'s number (remoteNumber) is another. Not "changed since sent": don\'t offer an update for it' }),
      canSet: Type.Boolean({ description: 'The Provider sets numbers on an update: offer "Set number" (POST /api/dives/{id}/providers/{provider}/number)' }),
      removesVerification: Type.Boolean({ description: 'Setting it can remove a verification the dive has there: warn before' }),
    }, { description: 'ADR 0048; null when the Connection doesn\'t follow, the Provider declares no numbers or the Dive has no number' })),
  }, { description: 'The remote dive this Dive has now; null when none (never sent, deleted)' })),
  conflicts: Nullable(Type.Array(ConflictFieldView, {
    description: 'The open entry of Conflicts about the current remote dive (a Push run left these fields as the Provider has them): '
      + "say so and offer to decide (send with conflicts). `hub` is the Dive's value now, `provider` the Provider's as the run found it. "
      + 'A field whose two values became equal is left out; null when no field is left',
  })),
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
  invalid_input: 400, encryption_key_missing: 400, provider_wrong_credentials: 400, provider_unsupported: 400, fetch_interval_too_short: 400,
  provider_already_connected: 409, provider_account_taken: 409, provider_other_account: 409, provider_not_connected: 409,
  provider_sign_in_needed: 409, provider_requirements_unmet: 409, provider_not_sent: 409, provider_dive_gone: 409, provider_busy: 409,
  push_run_active: 409, push_run_nothing_to_send: 409, push_run_not_found: 404, push_run_not_active: 409, push_run_going: 409, push_run_not_stopped: 409, waiting_push_not_found: 404,
  provider_number_taken: 409, provider_numbers_off: 409, provider_number_nothing_to_set: 409,
  site_not_found: 404, external_id_taken: 409, provider_site_unknown: 422, provider_buddy_not_found: 404,
  diver_external_id_taken: 409, diver_external_id_connected: 409, diver_not_editable: 403,
  provider_unavailable: 502, provider_refused: 502, provider_not_stored: 502, provider_import_off: 409, provider_account_held: 409,
};
/** A refusal about a Provider; with provider_requirements_unmet, what is unmet. */
const ProviderProblem = Type.Object({
  ...Problem.properties,
  diver: Type.Optional(Type.Object({
    id: Type.String(), name: Type.String(), dives: Type.Integer({ description: 'The Dives it is a Participant on' }),
  }, { description: 'With provider_account_held: the external Diver here with this account; connect again with claim to make it yours' })),
  unmet: Type.Optional(Type.Array(UnmetView, { description: 'With provider_requirements_unmet: every requirement unmet, blocking ones among them' })),
  existing: Type.Optional(Type.Object({
    remoteId: Type.String(), number: Nullable(Type.Integer()), startsAt: Nullable(Type.String()),
    maxDepthM: Nullable(Type.Number()), durationMinutes: Nullable(Type.Number()),
  }, { description: 'With provider_number_taken: the dive at the Provider that has the number' })),
  runId: Type.Optional(Type.String({ description: 'With push_run_active: the run that is going' })),
  diveId: Type.Optional(Nullable(Type.String({ description: 'With provider_number_taken: the Dive here that dive is, if Dive Hub knows it' }))),
});
const errors = { 400: Problem, 404: Problem, 409: ProviderProblem, 422: Problem, 502: Problem };

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
  const none = { typed: null, pattern: null, prefixes: null, createdBySend: null, roles: null };
  if (r.type === 'diver_mapping') return { type: r.type, severity: r.severity, description: r.description, source: r.source, ...none, roles: r.roles };
  const info = SOURCE_INFO[r.source];
  return {
    type: r.type, severity: r.severity, description: r.description, source: r.source, ...none,
    typed: !!info.typed, pattern: info.idPattern.source, prefixes: info.typed?.prefixes ?? [], createdBySend: !!r.createdBySend,
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

export const providerRoutes: FastifyPluginAsyncTypebox<ProviderRouteDeps> = async (app, { auth, providers, connections, pushes, pushRuns, buddies, sitePicks, diveImports, goneDives, waitingPushes, scheduledFetch, conflicts, certifications }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProviderServiceError) return replyProviderError(error, reply);
    if (error instanceof CertificationError) return replyCertificationError(error, reply);
    throw error;
  });

  // A string, not an enum: clients take the Providers from GET /api/providers, and the registry refuses others.
  const ProviderParam = Type.String({ pattern: '^[a-z][a-z0-9_]*$', description: 'A Provider\'s id (GET /api/providers); others answer provider_unsupported' });
  const DiveProviderParams = Type.Object({ id: Type.String({ format: 'uuid' }), provider: ProviderParam });

  const importsDives = (provider: string) => !!providers.list().find((a) => a.id === provider)?.capabilities.data.dives?.import?.operations.includes('list');
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
  const hasNumbers = (provider: string) => !!providers.list().find((a) => a.id === provider)?.capabilities.data.dives?.export?.numbers;
  const oneConnection = async (userId: string, id: string) =>
    (await connectionViews(userId, (await connections.list(userId)).filter((c) => c.id === id)))[0]!;
  type Status = Awaited<ReturnType<PushService['status']>>;
  const statusView = (s: Status): Static<typeof StatusView> =>
    ({ ...s, current: s.current && { ...s.current, sentAt: s.current.sentAt.toISOString() }, pushes: s.pushes.map(pushView) });

  await app.register(pushRunRoutes, { pushRuns });

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

  const BuddyView = Type.Object({
    entryId: Type.String({ description: 'The entry\'s ID at the Provider: what link and import name it by' }),
    name: Type.String({ description: 'As the Provider has it' }),
    account: Nullable(Type.String({ description: 'The person\'s own account at the Provider; null: none (link or import it by entryId)' })),
    diver: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, {
      description: 'The Diver here with that account; for an entry without one, the Diver it was linked, added or imported for',
    })),
    matches: Type.Boolean({ description: 'With ?for: the entry\'s name or e-mail is that Diver\'s (folded, trimmed). Only a sort; the e-mail is never answered' }),
  });
  /** A refusal of a link or add; with diver_external_id_taken, the Diver that has the account. */
  const LinkProblem = Type.Object({
    ...ProviderProblem.properties,
    diver: Type.Optional(Type.Object({ id: Type.String(), name: Type.String() }, { description: 'With diver_external_id_taken: the Diver that has the account' })),
  });
  const linkErrors = { ...errors, 403: Problem, 409: LinkProblem };

  app.get('/connections/:id/buddies', {
    schema: {
      summary: 'The account\'s own list of people at the Provider (SSI: the buddy list), read live, each with the Diver here who has their account',
      description: 'Only names and accounts are answered. An import also stores what the person\'s code says (ADR 0043); nothing else the Provider keeps about them. '
        + 'With ?for=<diverId>, the entries whose name or e-mail is that Diver\'s come first (matches), then the rest by name.',
      params: IdParams,
      querystring: Type.Object({ for: Type.Optional(Type.String({ format: 'uuid', description: 'The Diver to be linked or added: sorts its likely entries first' })) }),
      response: { 200: Type.Array(BuddyView), ...errors },
    },
  }, async (request) => buddies.list(userOf(request).id, request.params.id, request.query.for ? { forDiverId: request.query.for } : {}));

  app.post('/connections/:id/buddies/link', {
    schema: {
      summary: 'Link an entry of the account\'s list to a Diver here',
      description: 'An entry with an account gives the Diver that account (the rules of PUT /api/divers/{id}/external-ids/{source}: 409 diver_external_id_taken names the Diver that has it); '
        + 'an entry without one is only remembered for the Diver. The last link of an entry wins. 404 provider_buddy_not_found: the entry is not in the list (anymore).',
      params: IdParams,
      body: Type.Object({ entryId: Type.String({ minLength: 1, maxLength: 200 }), diverId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
      response: { 200: Type.Object({ diverId: Type.String() }), ...linkErrors },
    },
  }, async (request) => buddies.link(
    { userId: userOf(request).id, isAdmin: userOf(request).role === 'admin' }, request.params.id, request.body.entryId, request.body.diverId,
  ));

  app.post('/connections/:id/buddies/add', {
    schema: {
      summary: 'Add a person to the account\'s list for a Diver here, and remember the entry for it',
      description: 'A typed person (names, optional e-mail), or a scanned code (also account): the Diver then gets that account, and the entry is added by it; '
        + 'an account already in the list links that entry instead. What the Diver lacks of first name, last name and e-mail is filled in. '
        + 'added.name is the entry as the Provider answered it; knownAs is that name when it differs from the Diver\'s, else null: show it.',
      params: IdParams,
      body: Type.Object({
        diverId: Type.String({ format: 'uuid' }),
        firstName: Type.String({ minLength: 1, maxLength: 100 }),
        lastName: Type.String({ minLength: 1, maxLength: 100 }),
        email: Type.Optional(Nullable(Type.String({ format: 'email', maxLength: 254 }))),
        account: Type.Optional(Nullable(Type.String({ pattern: '^[1-9]\\d{0,9}$', description: 'The person\'s SSI account from a scanned code: digits only' }))),
      }, { additionalProperties: false }),
      response: {
        200: Type.Object({ added: Type.Object({ diverId: Type.String(), name: Type.String() }), knownAs: Nullable(Type.String()) }),
        ...linkErrors,
      },
    },
  }, async (request) => {
    const { diverId, firstName, lastName, email, account } = request.body;
    return buddies.add(
      { userId: userOf(request).id, isAdmin: userOf(request).role === 'admin' }, request.params.id, diverId,
      { firstName, lastName, email: email ?? null, account: account ?? null },
    );
  });

  app.post('/connections/:id/buddies/import', {
    schema: {
      summary: 'Add the chosen people from the account\'s list as external Divers, with their name, account and what their code says',
      description: 'First and last name, e-mail and leader number come along (ADR 0043). A chosen entry whose account a Diver already has '
        + 'fills what that Diver lacks of these and overwrites nothing. `entries` names entries without an account: each becomes an external Diver '
        + 'from its name and is remembered for it (one remembered already is skipped). To link an entry to a Diver here '
        + 'instead, use POST /api/connections/{id}/buddies/link.',
      params: IdParams,
      body: Type.Object({
        accounts: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 500 }),
        entries: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 500, description: 'Entry IDs of entries without an account' })),
      }, { additionalProperties: false }),
      response: { 200: Type.Object({ created: Type.Integer(), updated: Type.Integer({ description: 'Divers already here that got details they lacked' }), buddies: Type.Array(BuddyView) }), ...errors },
    },
  }, async (request) => buddies.import(
    { userId: userOf(request).id, isAdmin: userOf(request).role === 'admin' }, request.params.id, request.body.accounts, request.body.entries,
  ));

  app.post('/connections/:id/certifications/import', {
    schema: {
      summary: 'Read the account\'s certification cards and bring the Connection\'s Diver up to date (ADR 0050)',
      description: 'No preview: a new card is created verified_with_agency (read-only apart from notes), a card already here is updated from the '
        + 'Provider\'s data, a card the User deleted stays deleted (deleted_earlier), a card the Provider no longer lists stays '
        + '(not_at_provider). Pictures are fetched afterwards by a job: imageState pending, then stored or failed. 400 provider_unsupported '
        + 'at a Provider without certifications; 404 diver_not_found when the User no longer keeps the Connection\'s Diver.',
      params: IdParams,
      response: {
        200: Type.Object({
          created: Type.Integer(), updated: Type.Integer(), unchanged: Type.Integer(),
          items: Type.Array(Type.Object({
            result: Type.Enum(['created', 'updated', 'unchanged', 'deleted_earlier', 'not_at_provider']),
            level: Type.String({ description: 'The card\'s course or level, to name it in the report' }),
            certificationId: Nullable(Type.String({ description: 'The card here; null for deleted_earlier' })),
          })),
        }), ...errors,
      },
    },
  }, async (request) => certifications.importFrom(userOf(request).id, request.params.id));

  const Choice = Type.Enum(['recordings', 'entries'], {
    description: 'recordings: its dives become Recordings, like a file\'s; entries: only logbook entries that fill Dives here',
  });
  const ComputerChoices = Type.Array(Type.Object({ key: Type.String({ maxLength: 200 }), choice: Choice }, { additionalProperties: false }), {
    maxItems: 100, description: 'Per dive computer found at the Provider (its key from the preview): how its dives are used',
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

  const Candidate = Type.Object({
    diveId: Type.String(),
    number: Nullable(Type.Integer()),
    startsAt: DateTime,
    utcOffsetSeconds: Nullable(Type.Integer()),
    utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES]),
    durationSeconds: Type.Number(),
    maxDepthM: Nullable(Type.Number()),
    site: Nullable(Type.Object({ id: Type.String(), name: Type.String() })),
    probablyNoDive: Type.Boolean({
      description: 'A Recording under 2 minutes that stayed above 3 m (a false start): the entry never links to it by itself, so it is asked about even as the only Dive',
    }),
  });
  const GoneSummary = Type.Object({
    empty: Type.Boolean({ description: 'The Provider\'s logbook came back empty: nothing was compared, and an empty logbook is never a finding' }),
    compared: Type.Integer({ description: 'Dives compared: live, and sent or linked through this Connection' }),
    gone: Type.Integer({ description: 'Dives whose remote dive is not in the logbook and wait for the User\'s choice (GET /api/gone-dives)' }),
    warning: Type.Boolean({ description: 'More than half of at least five compared Dives are gone: say so, and to look at the Provider\'s app first' }),
  }, { description: 'Dives gone at the Provider (ADR 0051), found by this fresh, complete read; stored, nothing else changes' });
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
      field: Type.Enum([...SYNCED_FIELDS], { description: 'values (startsAt, …) only on Dives without a Recording; cylinder only on Dives with at most one Cylinder; lead only on Dives with at most one Lead entry' }),
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
    goneDives: GoneSummary,
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
  }, async (request) => diveImports.diveTimes(userOf(request).id, request.params.id));

  app.get('/connections/:id/dive-import', {
    schema: {
      summary: 'Preview importing the account\'s dives (ADR 0030): reads them from the Provider and says what would happen; stores nothing',
      description: 'provider_import_off while the Connection\'s import mode is off. One paced action at the Provider.',
      params: IdParams, response: { 200: Preview, ...errors },
    },
  }, async (request) => {
    const p = await diveImports.preview(userOf(request).id, request.params.id);
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
    const created = await diveImports.start(userOf(request).id, request.params.id, {
      computers: Object.fromEntries(request.body.computers.map((c) => [c.key, c.choice])),
      decisions: Object.fromEntries(request.body.decisions.map((d) => [d.remoteId, d.choice])),
      conflicts: Object.fromEntries((request.body.conflicts ?? []).map((c) => [`${c.remoteId}:${c.field}`, c.choice])),
    });
    return reply.code(202).send(toImportView(created));
  });

  const GoneDivesView = Type.Object({
    connectionId: Type.String(),
    provider: Type.String(),
    diverId: Type.String(),
    diverName: Type.String(),
    accountLabel: Type.String(),
    compared: Type.Integer({ description: 'Dives of this Diver sent or linked through the Connection' }),
    warning: Type.Boolean({ description: 'More than half of at least five Dives are gone: say to look at the Provider\'s app first' }),
    dives: Type.Array(Type.Object({
      diveId: Type.String(),
      version: Type.Integer({ description: 'The version to send when deleting the Dive (DELETE /api/dives/{id})' }),
      number: Nullable(Type.Integer()),
      startsAt: DateTime,
      utcOffsetSeconds: Nullable(Type.Integer()),
      utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES]),
      durationSeconds: Type.Number(),
      maxDepthM: Nullable(Type.Number()),
      site: Nullable(Type.Object({ id: Type.String(), name: Type.String() })),
      remoteId: Type.String(),
      remoteNumber: Nullable(Type.Integer()),
      foundAt: DateTime,
    })),
  });

  app.get('/gone-dives', {
    schema: {
      summary: 'Dives whose remote dive is gone at a Provider and wait for the User\'s choice (ADR 0051), per Connection; no call to a Provider',
      description: 'Clients show them with two choices each, "Keep here" and "Delete here too", never a default, never "all". '
        + 'Both first confirm: POST /api/connections/{id}/gone-dives/confirm. "Delete here too" then deletes the one Dive with its own dialog.',
      response: { 200: Type.Array(GoneDivesView), ...errors },
    },
  }, async (request) => (await goneDives.waiting(userOf(request).id)).map((c) => ({
    ...c, dives: c.dives.map((d) => ({ ...d, startsAt: d.startsAt.toISOString(), foundAt: d.foundAt.toISOString() })),
  })));

  const ConflictsView = Type.Object({
    connectionId: Type.String(),
    provider: Type.String(),
    providerName: Type.String(),
    entries: Type.Array(Type.Object({
      diveId: Type.String(),
      number: Nullable(Type.Integer()),
      startsAt: DateTime,
      utcOffsetSeconds: Nullable(Type.Integer()),
      utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES]),
      durationSeconds: Type.Number(),
      maxDepthM: Nullable(Type.Number()),
      site: Nullable(Type.Object({ id: Type.String(), name: Type.String() })),
      kind: Type.Enum(['conflict', 'exists'], {
        description: 'conflict: fields changed on both sides, the User chooses per field. exists: the Provider already has a dive at the Dive\'s time and the send waits (fields is empty): '
          + '"<Provider> already has a dive at this time" with "Link to it" and "Create a new one"',
      }),
      remoteId: Type.String({ description: 'conflict: the remote dive the Conflict is about. exists: the dive at the Provider' }),
      fields: Type.Array(ConflictFieldView, { description: "`hub` is the Dive's value now, `provider` the Provider's as the run found it; a field whose two values became equal is left out. An entry with no field left is not listed (nor counted in the Connection's or a run's conflicts)" }),
      existing: Nullable(Type.Object({
        remoteId: Type.String(), remoteNumber: Nullable(Type.Integer()),
        startsAt: Type.String({ description: 'Local time as the Provider keeps it, "YYYY-MM-DD HH:MM"' }),
      }, { description: 'With kind exists: that dive at the Provider' })),
      foundAt: DateTime,
      queued: Type.Boolean({ description: 'conflict: the User chose and the Dive waits to be sent with the choices; the entry stays listed until the send settles. A Conflict found again after the choice is not queued' }),
    })),
  });

  app.get('/provider-conflicts', {
    schema: {
      summary: 'What waits for the choice of the User ("Needs your decision"), per Connection; no call to a Provider',
      description: 'A Conflict (kind conflict) is a field changed on both sides, differently, found while sending or fetching a Dive. One entry per Dive and Provider, '
        + 'with both values of each field. The User chooses per field, the Dive Hub value preselected; the choice goes to POST /api/dives/{id}/providers/{provider}/decision '
        + 'with `conflicts` (or sends the Dive from its page with `conflicts`). A Dive the Provider already has a dive for (kind exists) waits for "Link to it" or '
        + '"Create a new one": the same route with `onExisting`. A choice queues the Dive, due now: an exists entry leaves the list, a conflict entry stays with queued true until the send settles. '
        + 'An entry whose Dive is deleted, or whose remote dive is no longer the current one of the Dive, is not listed.',
      response: { 200: Type.Array(ConflictsView), ...errors },
    },
  }, async (request) => (await conflicts.waiting(userOf(request).id)).map((c) => ({
    ...c, providerName: providers.get(c.provider).capabilities.name,
    entries: c.entries.map((e) => ({ ...e, startsAt: e.startsAt.toISOString(), foundAt: e.foundAt.toISOString() })),
  })));

  app.post('/connections/:id/gone-dives/check', {
    schema: {
      summary: 'Check the Provider\'s logbook for Dives that are gone there (ADR 0051): one fresh read, stores findings, changes no Dive',
      description: 'Works whatever the Connection\'s import mode is. One paced action at the Provider. An empty logbook is never a finding (empty true). '
        + 'The Connection\'s owner only (others: 404).',
      params: IdParams, response: { 200: GoneSummary, ...errors },
    },
  }, async (request) => goneDives.check(userOf(request).id, request.params.id));

  app.post('/connections/:id/gone-dives/confirm', {
    schema: {
      summary: 'Confirm findings with one more fresh read before the User\'s choice (ADR 0051): gone again, the Dive has no remote dive there from now on',
      description: 'Send the Dives the User chose. gone: a confirmed delete Push with remoteGone was recorded (the Dive stays here until deleted '
        + 'or kept). there: the dive is in the logbook after all; nothing was recorded, the finding is gone: tell the User. '
        + 'not_waiting: no such finding any more. unconfirmed: the logbook came back empty (empty true); nothing was recorded. '
        + 'Each Dive is under its lease: provider_busy while another action holds one. Never call it for Dives the User didn\'t choose.',
      params: IdParams,
      body: Type.Object({
        diveIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 50 }),
      }, { additionalProperties: false }),
      response: {
        200: Type.Object({
          empty: Type.Boolean(),
          results: Type.Array(Type.Object({ diveId: Type.String(), confirmation: Type.Enum(['gone', 'there', 'not_waiting', 'unconfirmed']) })),
        }),
        ...errors,
      },
    },
  }, async (request) => goneDives.confirm(userOf(request).id, request.params.id, request.body.diveIds));

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
      response: { 200: Type.Array(SiteDataView), 403: Problem },
    },
  }, async () => (await diveImports.siteData()).map(siteDataView));

  app.put('/admin/provider-site-data/:provider', {
    onRequest: requireAdmin,
    schema: {
      summary: 'Admins: allow or stop making Dive sites from a Provider\'s site data when Users import dives',
      description: 'SSI gives no licence for its site data (ADR 0024): allowing needs confirm true, after showing the same '
        + 'explanation as the SSI site import (provider_site_data_not_confirmed). Without it, imports only link sites already here.',
      params: Type.Object({ provider: ProviderParam }),
      body: Type.Object({ allowed: Type.Boolean(), confirm: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      response: { 200: Type.Array(SiteDataView), 400: Problem, 403: Problem },
    },
  }, async (request, reply) => {
    if (request.body.allowed && request.body.confirm !== true) return reply.code(400).send(problem('provider_site_data_not_confirmed'));
    await diveImports.allowSiteData(userOf(request).id, request.params.provider, request.body.allowed);
    return (await diveImports.siteData()).map(siteDataView);
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

  const DecisionBody = Type.Object({
    onExisting: Type.Optional(Type.Enum(['link', 'create'], { description: 'link: tie the Dive to the dive at the Provider. create: a second dive' })),
    conflicts: Type.Optional(ConflictChoices),
  }, { additionalProperties: false, minProperties: 1 });

  app.post('/dives/:id/providers/:provider/retry', {
    schema: {
      summary: 'Retry a Waiting push that is stopped or held: it waits again, due now (ADR 0056)',
      description: '404 dive_not_found for a Dive that is none of the User\'s Divers\' (also for one that does not exist), 404 waiting_push_not_found when '
        + 'the Dive has no entry for the Provider (an entry that waits already answers 204 and stays as it is), 404 connection_not_found when the entry is on another User\'s Connection '
        + '(sends go out as the Connection\'s User).',
      params: DiveProviderParams, response: { 204: Type.Null(), 404: Problem },
    },
  }, async (request, reply) => {
    await waitingPushes.retry(userOf(request).id, request.params.id, request.params.provider);
    return reply.code(204).send(null);
  });

  app.post('/dives/:id/providers/:provider/decision', {
    schema: {
      summary: 'The User\'s decision for a Dive at a Provider: it is queued as a send, due now, with this choice (ADR 0056)',
      description: 'From "Needs your decision", by the entry\'s kind. `exists` (the Provider already has a dive at the Dive\'s time): `onExisting` '
        + 'link ties the Dive to that dive and updates it, create makes a second dive there. `conflict` (a field changed on both sides): '
        + '`conflicts` per field, hub sends the Dive\'s value over the Provider\'s, provider takes the Provider\'s value into the Dive here (a '
        + 'Revision of the User\'s) and leaves that field as it is there; the other fields go out as usual. It sends nothing at once: the worker sends, one Dive after another, paced for the Provider '
        + '(the Dive\'s page keeps POST /api/dives/{id}/providers/{provider}, which sends at once). At least one property; 404 dive_not_found, '
        + '404 connection_not_found as for Retry.',
      params: DiveProviderParams, body: DecisionBody, response: { 204: Type.Null(), 400: Problem, 404: Problem },
    },
  }, async (request, reply) => {
    const { onExisting, conflicts: choices } = request.body;
    await waitingPushes.decide(userOf(request).id, request.params.id, request.params.provider, {
      ...(onExisting && { onExisting }), ...(choices && { conflicts: choices }),
    });
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

  app.get('/dives/:id/providers', {
    schema: {
      summary: 'The Dive at every Provider that takes dives: the Connection of its Diver, what is unmet, the remote dive it has now, every Push',
      params: IdParams, response: { 200: Type.Array(StatusView), 404: Problem },
    },
  }, async (request) => (await pushes.statusAll(userOf(request).id, request.params.id)).map(statusView));

  app.get('/dives/:id/providers/:provider', {
    schema: {
      summary: 'The Dive at one Provider: the Connection of its Diver, what is unmet, the remote dive it has now, every Push',
      params: DiveProviderParams, response: { 200: StatusView, 400: Problem, 404: Problem },
    },
  }, async (request) => statusView(await pushes.status(userOf(request).id, request.params.id, request.params.provider)));

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
          visibility: Type.Enum(['public', 'private', 'unknown'], {
            description: 'private: private to the Connection\'s account (show it as such); unknown: the Provider does not say',
          }),
          waterType: Nullable(Type.Enum([...SITE_WATER_TYPES], { description: 'As the Provider gives it' })),
        })),
        ...errors,
      },
    },
  }, async (request) => pushes.siteSuggestions(userOf(request).id, request.params.id, request.params.provider));

  app.put('/connections/:id/dive-sites/:siteId', {
    schema: {
      summary: "Set or clear a Dive site's ID at the Connection's Provider: picked from its sites or typed, after asking the Provider",
      description: "The Provider is asked about the ID first. One it calls public is stored public (with a Revision); the account's own "
        + "private one is stored private to the Connection's account; an ID it has no site for (also another account's private site) is "
        + '422 provider_site_unknown and nothing is stored. When it does not say or cannot be asked, the ID is stored private, never public. '
        + "null clears the account's private ID of the site only (the public ID is cleared with PUT /api/dive-sites/{id}/external-ids/{source}). "
        + '409 external_id_taken when another site has the ID.',
      params: Type.Object({ id: Type.String({ format: 'uuid' }), siteId: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        externalId: Nullable(Type.String({ minLength: 1, maxLength: 40, description: 'As the User typed or picked it; null clears the private ID' })),
      }, { additionalProperties: false }),
      response: {
        200: Type.Object({
          externalId: Nullable(Type.String({ description: 'The bare ID stored; null after a clear' })),
          private: Type.Boolean({ description: 'Whether it is stored private to the account' }),
        }),
        ...errors,
      },
    },
  }, async (request) => sitePicks.set(userOf(request).id, request.params.id, request.params.siteId, request.body.externalId));

  app.post('/dives/:id/providers/:provider', {
    schema: {
      summary: 'Send the Dive to the Provider: updates its remote dive, or creates one',
      description: 'Before creating, a dive at about the same time already at the Provider is answered with outcome exists and nothing is '
        + 'sent; send again with onExisting link (tie the Dive to it) or create (a second dive). Mind the Provider\'s notices. '
        + 'An update is three-way (ADR 0056): what changed only at the Provider is taken into the Dive first (taken), a value removed here '
        + 'is removed there, and a field changed on both sides is a Conflict: outcome conflicts, nothing sent. Send again with conflicts, '
        + 'a choice per field (hub preselected).',
      params: DiveProviderParams,
      body: Type.Object({
        onExisting: Type.Optional(Type.Enum(['link', 'create'])),
        conflicts: Type.Optional(ConflictChoices),
      }, { additionalProperties: false }),
      response: {
        200: Type.Object({
          outcome: Type.Enum(['created', 'updated', 'linked', 'exists', 'conflicts'], {
            description: 'exists: nothing was sent; a dive at the same time is there. Send again with onExisting link or create. '
              + 'conflicts: nothing was sent; list the fields with both values and send again with conflicts',
          }),
          existing: Nullable(Existing),
          conflicts: Nullable(Type.Array(ConflictFieldView, { description: 'With outcome conflicts: the fields changed on both sides' })),
          taken: Nullable(Type.Array(Type.Enum([...SYNCED_FIELDS]), { description: 'With outcome updated: the fields taken from the Provider into the Dive first' })),
          deferred: Nullable(Type.Array(Type.Enum([...SYNCED_FIELDS]), { description: 'With outcome updated: the fields left as the Provider has them' })),
          buddies: Nullable(Type.Object({
            added: Type.Array(Type.Object({ diverId: Type.String(), name: Type.String({ description: 'The entry name as the Provider answered it' }) }), { description: 'Entries the send made in the list of people at the Provider' }),
            knownAs: Type.Array(Type.Object({ diverId: Type.String(), diverName: Type.String(), name: Type.String() }), { description: 'Entries whose name at the Provider differs from the Diver name: whom the Provider knows the account as' }),
          }, { description: 'What the send did to the list of people at the Provider; null when it added nothing and nothing is known by another name' })),
          status: StatusView,
        }),
        ...errors,
      },
    },
  }, async (request) => {
    const { id, provider } = request.params;
    const { onExisting, conflicts: choices } = request.body;
    const sent = await pushes.send(userOf(request).id, id, provider, { ...(onExisting && { onExisting }), ...(choices && { conflicts: choices }) });
    return {
      outcome: sent.result, existing: sent.result === 'exists' ? sent.existing : null,
      conflicts: sent.result === 'conflicts' ? sent.conflicts : null,
      taken: sent.result === 'updated' ? sent.taken : null,
      deferred: sent.result === 'updated' ? sent.deferred : null,
      buddies: sent.buddies ?? null,
      status: statusView(await pushes.status(userOf(request).id, id, provider)),
    };
  });

  app.post('/dives/:id/providers/:provider/number', {
    schema: {
      summary: 'Set the number of the Dive\'s remote dive to the Dive\'s own number, and change nothing else there (ADR 0048)',
      description: 'Makes a Push with the action number. The Dive\'s state stays what it was: one changed since it was sent still is. '
        + '409 provider_numbers_off (the Connection doesn\'t follow), provider_number_nothing_to_set (no number, or the Provider has it already: fetch the status again), '
        + 'provider_number_taken (another dive there has the number; existing names it, diveId the Dive here if known: set that one first), and the codes a send has.',
      params: DiveProviderParams,
      response: { 200: Type.Object({ status: StatusView }), ...errors },
    },
  }, async (request) => {
    const { id, provider } = request.params;
    await pushes.setNumber(userOf(request).id, id, provider);
    return { status: statusView(await pushes.status(userOf(request).id, id, provider)) };
  });

  app.delete('/dives/:id/providers/:provider', {
    schema: {
      summary: 'Delete the Dive\'s copy at the Provider (SSI hides it; its app has no way back). The Dive stays here',
      params: DiveProviderParams, response: { 200: StatusView, ...errors },
    },
  }, async (request) => {
    const { id, provider } = request.params;
    await pushes.remove(userOf(request).id, id, provider);
    return statusView(await pushes.status(userOf(request).id, id, provider));
  });
};

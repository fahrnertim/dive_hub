// A Dive at each Provider over HTTP: its status, sending, setting its number, deleting its copy there, and the Provider's
// sites to pick a site ID from. Registered inside the provider routes, so the sign-in hook and the error handler are theirs.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from 'typebox';
import { userOf } from '../auth/fastify.js';
import { refreshAssessmentsAfterChange, type AssessmentRefresh } from '../dives/assessment-refresh.js';
import { Problem, storedProblemCode } from '../http/problems.js';
import { DateTime, IdParams, Nullable } from '../http/schemas.js';
import { SITE_WATER_TYPES } from '../vocabulary.js';
import { ConflictChoices, ConflictFieldView } from './conflict-view.js';
import type { PushService } from './push-service.js';
import type { PushRow } from './remote-state.js';
import { Code, DiveProviderParams, errors } from './route-parts.js';
import type { SitePickService } from './site-pick.js';
import { SYNCED_FIELDS } from './three-way.js';
import { UnmetView } from './unmet-view.js';
import { WaitingPushViewSchema } from '../dives/waiting-push-view.js';

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

const pushView = (p: PushRow): Static<typeof PushView> => ({
  id: p.id, action: p.action, state: p.state, remoteId: p.remoteId, remoteNumber: p.remoteNumber, remoteGone: p.remoteGone,
  failureCode: storedProblemCode(p.errorCode),
  leftOut: p.leftOut, differences: p.differences, createdAt: p.createdAt.toISOString(),
});

type Status = Awaited<ReturnType<PushService['status']>>;
const statusView = (s: Status): Static<typeof StatusView> =>
  ({ ...s, current: s.current && { ...s.current, sentAt: s.current.sentAt.toISOString() }, pushes: s.pushes.map(pushView) });

export interface DiveProviderRouteDeps {
  pushes: PushService;
  sitePicks: SitePickService;
  assessments: AssessmentRefresh;
}

export const diveProviderRoutes: FastifyPluginAsyncTypebox<DiveProviderRouteDeps> = async (app, { pushes, sitePicks, assessments }) => {
  // A send can take the Provider's values into the Dive.
  refreshAssessmentsAfterChange(app, assessments);

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
      response: { 200: StatusView, ...errors },
    },
  }, async (request) => {
    const { id, provider } = request.params;
    await pushes.setNumber(userOf(request).id, id, provider);
    return statusView(await pushes.status(userOf(request).id, id, provider));
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

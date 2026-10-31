// Importing a Connection's dives over HTTP (ADR 0030): the dive times, the preview, the import itself, and the admins' choice
// whether Dive sites may be made from a Provider's site data. Registered inside the provider routes, so the sign-in hook and the error handler are theirs.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { requireAdmin, userOf } from '../../auth/fastify.js';
import { Problem, problem } from '../../http/problems.js';
import { DIVE_IMPORT_MODES, UTC_OFFSET_SOURCES } from '../../db/schema.js';
import { DiveSummaryFields } from '../../dives/dive-summary-view.js';
import { ImportView, toImportView } from '../../imports/import-view.js';
import { DateTime, IdParams, Nullable } from '../../http/schemas.js';
import { ConflictValue } from '../conflicts/conflict-view.js';
import type { DiveImportService } from './dive-import.js';
import { Choice, ComputerChoices, errors, GoneSummary, ProviderParam } from '../route-parts.js';
import { SYNCED_FIELDS } from './three-way.js';

const Candidate = Type.Object({
  diveId: Type.String(),
  ...DiveSummaryFields,
  probablyNoDive: Type.Boolean({
    description: 'A Recording under 2 minutes that stayed above 3 m (a false start): the entry never links to it by itself, so it is asked about even as the only Dive',
  }),
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

const SiteDataView = Type.Object({
  provider: Type.String(),
  name: Type.String(),
  allowedAt: Nullable(DateTime),
  allowedBy: Nullable(Type.String({ description: 'The admin who allowed it, by name' })),
});
const siteDataView = (r: Awaited<ReturnType<DiveImportService['siteData']>>[number]) => ({ ...r, allowedAt: r.allowedAt?.toISOString() ?? null });

export const diveImportRoutes: FastifyPluginAsyncTypebox<{ diveImports: DiveImportService }> = async (app, { diveImports }) => {
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
};

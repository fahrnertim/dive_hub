// An Import over HTTP: an upload's and a Provider's (ADR 0030, 0044).
import { Type, type Static } from 'typebox';
import { DIVE_KINDS, IMPORT_ERROR_CODES, OUTCOME_REASONS, importJob } from '../db/schema.js';
import { DateTime, Nullable, refTo } from '../http/schemas.js';

/** Registered with app.addSchema; routes answer ImportView, the reference. */
export const ImportViewSchema = Type.Object({
  id: Type.String(),
  status: Type.Enum(['pending', 'processing', 'done', 'failed', 'awaiting_choice', 'cancelled'], {
    description: 'awaiting_choice: the upload holds several kinds of dive and nothing is imported until the User starts it with the kinds '
      + 'to import (ADR 0044); cancelled: the User ended that wait, or nobody answered for seven days (errorCode choice_expired)',
  }),
  uploadName: Type.String({ description: 'The uploaded file\'s name; for an import from a Provider, the Provider\'s name' }),
  provider: Nullable(Type.String({ description: 'An import of this Provider\'s dives (ADR 0030); null for an upload' })),
  createdAt: DateTime,
  finishedAt: Nullable(DateTime),
  errorCode: Nullable(Type.Enum([...IMPORT_ERROR_CODES], { description: 'Why the Import failed or ended; clients translate it. The detail stays in the server log' })),
  found: Nullable(Type.Object({
    scuba: Type.Integer({ description: 'Dives with a gas: open circuit, rebreather, gauge' }),
    apnea: Type.Integer({ description: 'Apnea sessions' }),
    otherFiles: Type.Integer({ description: 'Files that are no dive (other sports, health data, anything else); they are not kept' }),
  }, { description: 'What an upload holds, once it is analysed (ADR 0044); null before, and for an import from a Provider' })),
  kinds: Nullable(Type.Array(Type.Enum([...DIVE_KINDS]), { description: 'The kinds of dive the User chose to import; null when nobody was asked (all were imported)' })),
  unsentTo: Type.Array(Type.Object({
    connectionId: Type.String(),
    provider: Type.String(),
    count: Type.Integer({ minimum: 1, description: 'How many of the Import’s new Dives still have no remote dive there' }),
  }), {
    description: 'The User’s Connections that send new dives by themselves but left this Import’s out (more than 20 at once, ADR 0056) '
      + 'and offer them instead (the Connection’s unsentDives); link to that Connection’s settings. Empty: none',
  }),
  outcome: Type.Array(Type.Object({
    fileName: Type.String(),
    result: Type.Enum(['created', 'attached', 'linked', 'updated', 'unchanged', 'duplicate-candidate', 'skipped', 'failed'], {
      description: 'linked: a Provider\'s logbook entry tied to a Dive here and filled where it was empty (ADR 0030)',
    }),
    diveId: Type.Optional(Type.String()),
    recordingId: Type.Optional(Type.String()),
    remoteId: Type.Optional(Type.String({ description: 'A Provider\'s dive: its ID there' })),
    remoteNumber: Type.Optional(Type.Integer({ description: 'A Provider\'s dive: its own number there' })),
    reason: Type.Optional(Type.Enum([...OUTCOME_REASONS], { description: 'Why; clients translate it. A failure’s detail stays in the server log' })),
    decision: Type.Optional(Type.Enum(['open', 'attached', 'new_dive', 'discarded'], {
      description: 'For a duplicate-candidate: what has been decided since. diveId is then the Dive it went to',
    })),
  })),
}, { $id: 'ImportView' });
export const ImportView = refTo(ImportViewSchema);

export const toImportView = (j: typeof importJob.$inferSelect): Static<typeof ImportView> => ({
  id: j.id, status: j.status, uploadName: j.uploadName, provider: j.provider, createdAt: j.createdAt.toISOString(),
  // A parser's own words (English, internals) stay in the database and the server log (client contract §6).
  finishedAt: j.finishedAt?.toISOString() ?? null, outcome: j.outcome.map(({ message: _detail, ...o }) => o),
  errorCode: j.errorCode,
  found: j.found, kinds: j.kinds, unsentTo: [],
});

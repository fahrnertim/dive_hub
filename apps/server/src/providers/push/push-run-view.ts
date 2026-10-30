// A Push run over HTTP (ADR 0047): the view its routes answer, registered with app.addSchema, and what a run leaves out.
import { Type } from 'typebox';
import { DateTime, Nullable, refTo } from '../../http/schemas.js';
import { Code } from '../route-parts.js';

export const LeftOut = Type.Object({
  upToDate: Type.Integer(), requirementsUnmet: Type.Integer(), updateNotChosen: Type.Integer(), removesVerification: Type.Integer(),
  updateUnsupported: Type.Integer(), beyondCeiling: Type.Integer(), notFound: Type.Integer(),
  numberNotChosen: Type.Integer({ description: 'Dives whose number differs and that a run with numbers would set' }),
  numberTaken: Type.Integer({ description: 'Number changes that wait for a dive the run doesn\'t move (a Dive here left out, or one with no number); set them from their own pages' }),
  numberHeldAtProvider: Type.Integer({ description: 'Number changes whose number a dive only at the Provider holds; import that dive (ADR 0052)' }),
}, { description: 'What the run left out when it was planned, as counts' });

/** Registered with app.addSchema; routes answer PushRunView, the reference. */
export const PushRunViewSchema = Type.Object({
  id: Type.String(),
  connectionId: Type.String(),
  provider: Type.String(),
  diverId: Type.String(),
  status: Type.Enum(['queued', 'running', 'done', 'cancelled', 'stopped']),
  stopCode: Nullable(Code),
  updates: Type.Boolean(),
  updatesRemovingVerification: Type.Boolean(),
  numbers: Type.Boolean(),
  numbersRemovingVerification: Type.Boolean(),
  cancelRequested: Type.Boolean({ description: 'Stop was asked for; the Dive being sent is finished first' }),
  counts: Type.Object({ total: Type.Integer(), waiting: Type.Integer(), sent: Type.Integer(), skipped: Type.Integer(), failed: Type.Integer() }),
  conflicts: Type.Integer({ description: 'Conflicts of this run that still wait in Needs your decision (GET /api/provider-conflicts); an entry a later send closed is not counted, one a later run found again counts in that run' }),
  leftOut: LeftOut,
  pauseMs: Type.Integer({ description: 'Pause between two Dives; 0 when this instance no longer has the Provider' }),
  createdAt: DateTime,
  startedAt: Nullable(DateTime),
  finishedAt: Nullable(DateTime),
  dismissedAt: Nullable(DateTime),
}, { $id: 'PushRunView' });
export const PushRunView = refTo(PushRunViewSchema);

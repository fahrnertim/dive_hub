// A Connection over HTTP (ADR 0024, 0027): the view the Connection routes answer. Credentials never go out.
import { Type } from 'typebox';
import { DIVE_IMPORT_MODES } from '../db/schema.js';
import { DateTime, Nullable, refTo } from '../http/schemas.js';

/** Registered with app.addSchema; routes answer ConnectionView, the reference. */
export const ConnectionViewSchema = Type.Object({
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
}, { $id: 'ConnectionView' });
export const ConnectionView = refTo(ConnectionViewSchema);

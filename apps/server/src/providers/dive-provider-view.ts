// A Dive's status at a Provider over HTTP: the view the Dive-at-Provider routes answer, registered with app.addSchema.
import { Type, type Static } from 'typebox';
import { storedProblemCode } from '../http/problems.js';
import { DateTime, Nullable, refTo } from '../http/schemas.js';
import { ConflictFieldView } from './conflicts/conflict-view.js';
import type { PushService } from './push/push-service.js';
import type { PushRow } from './remote-state.js';
import { Code } from './route-parts.js';
import { UnmetView } from './unmet-view.js';
import { WaitingPushView } from '../dives/waiting-push-view.js';

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

/** Registered with app.addSchema; routes answer DiveProviderStatus, the reference. */
export const DiveProviderStatusSchema = Type.Object({
  provider: Type.String(),
  deletesItself: Type.Boolean({
    description: 'The Dive\'s Connection deletes at the Provider by itself (5 minutes after the Dive is deleted here; Undo cancels it): '
      + 'don\'t ask about deleting the copy there, and don\'t send `alsoAt` for it (docs/spec/clients.md)',
  }),
  waiting: Type.Union([Type.Null(), WaitingPushView], { description: 'The Dive\'s entry in the queue of Waiting pushes for this Provider (ADR 0056); null when none' }),
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
}, { $id: 'DiveProviderStatus' });
export const DiveProviderStatus = refTo(DiveProviderStatusSchema);

const pushView = (p: PushRow): Static<typeof PushView> => ({
  id: p.id, action: p.action, state: p.state, remoteId: p.remoteId, remoteNumber: p.remoteNumber, remoteGone: p.remoteGone,
  failureCode: storedProblemCode(p.errorCode),
  leftOut: p.leftOut, differences: p.differences, createdAt: p.createdAt.toISOString(),
});

type Status = Awaited<ReturnType<PushService['status']>>;
export const statusView = (s: Status): Static<typeof DiveProviderStatus> =>
  ({ ...s, current: s.current && { ...s.current, sentAt: s.current.sentAt.toISOString() }, pushes: s.pushes.map(pushView) });

// A Diver over HTTP (ADR 0016, 0028, 0043): the views the Diver routes answer, each registered with app.addSchema.
import { Type } from 'typebox';
import { Nullable, refTo } from '../http/schemas.js';

export const DiverSource = Type.Enum(['ssi', 'padi'], { description: 'A service a person has an account at' });

export const DiverDetailsViewSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  external: Type.Boolean({ description: 'No User keeps its logbook' }),
  canEdit: Type.Boolean({ description: 'Whether the signed-in User may change the details: an external Diver, or one whose logbook they keep' }),
  firstName: Nullable(Type.String()), lastName: Nullable(Type.String()),
  email: Nullable(Type.String({ description: 'Personal data every User of the instance sees (ADR 0043)' })),
  leaderNumber: Nullable(Type.String()),
  accounts: Type.Array(Type.Object({ source: DiverSource, externalId: Type.String({ description: 'e.g. the SSI account, as the code holds it' }) })),
  codes: Type.Array(Type.Object({
    kind: Type.Enum(['buddy', 'professional'], {
      description: 'buddy: another diver scans it in the Provider\'s app to add the person to their buddy list. professional: a diver scans it on a logbook entry to verify the dive',
    }),
    provider: Type.Enum(['ssi']),
    text: Type.String({ description: 'Draw this text, unchanged, as a QR code; never build or parse it (docs/spec/clients.md)' }),
  }), { description: 'Empty while the account, a name or the e-mail is missing; the professional\'s only with a leader number' }),
}, {
  $id: 'DiverDetailsView',
  description: 'What a Diver\'s SSI buddy code says about the person, and the codes built from it. Seen by every User (ADR 0043, amending ADR 0028)',
});
export const DiverDetailsView = refTo(DiverDetailsViewSchema);

export const ExternalDiverViewSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  accounts: Type.Array(DiverSource, { description: 'Services this person has an account at here (the account itself isn\'t shown)' }),
  inUse: Type.Boolean({ description: 'A Dive (of any User) lists this Diver; then it can\'t be deleted' }),
  canDelete: Type.Boolean({ description: 'Whether the signed-in User may delete it: whoever added it, or an admin' }),
}, { $id: 'ExternalDiverView' });
export const ExternalDiverView = refTo(ExternalDiverViewSchema);

const CertificationSummary = Type.Object({
  count: Type.Integer(),
  newest: Nullable(Type.Object({ agency: Type.String(), level: Type.String() })),
  expired: Type.Integer({ description: 'Cards whose expiry date has passed' }),
  expiringSoon: Type.Integer({ description: 'Cards expiring within 90 days (not yet expired)' }),
}, { description: 'What the Divers list shows of a Diver\'s certification cards (ADR 0050); the cards are GET /divers/{id}/certifications' });

export const DiverViewSchema = Type.Object({
  id: Type.String(), name: Type.String(),
  isOwn: Type.Boolean({ description: 'The User\'s own Diver' }),
  divesBefore: Type.Integer({ description: 'The dives made before the first one in this logbook (ADR 0048): the first Dive here gets the next number' }),
  apneaCounts: Type.Boolean({ description: 'Whether apnea sessions count in the Dive numbers (ADR 0048)' }),
  diveCount: Type.Integer(), deviceCount: Type.Integer(),
  mutedRules: Type.Array(Type.String(), {
    description: 'Rules of the dive assessment not shown for this Diver (ADR 0036); show them again with PUT /divers/{id}/muted-rules/{rule}',
  }),
  certifications: CertificationSummary,
}, { $id: 'DiverView' });
export const DiverView = refTo(DiverViewSchema);

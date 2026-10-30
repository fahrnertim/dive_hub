// A certification card over HTTP (ADR 0050).
import { Type } from 'typebox';
import { CERTIFICATION_IMAGE_STATES, CERTIFICATION_VERIFICATIONS } from '../db/schema.js';
import { DateTime, Nullable, refTo } from '../http/schemas.js';

export const Day = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' });

/** Registered with app.addSchema; routes answer CertificationView, the reference. */
export const CertificationViewSchema = Type.Object({
  id: Type.String(), diverId: Type.String(),
  agency: Type.String({ description: 'Free text (SSI, PADI, CMAS, …)' }),
  level: Type.String({ description: 'The course or level, free text; for an imported card as the agency names it' }),
  number: Nullable(Type.String({ description: 'The card or diver number (a typed card); an imported card has its card ID in cardId' })),
  issuedOn: Nullable(Day), expiresOn: Nullable(Day),
  divesAtIssue: Nullable(Type.Integer()),
  instructorName: Nullable(Type.String()), instructorNumber: Nullable(Type.String()),
  centreName: Nullable(Type.String()), centreNumber: Nullable(Type.String()), centreCity: Nullable(Type.String()), centreCountry: Nullable(Type.String()),
  verification: Type.Enum([...CERTIFICATION_VERIFICATIONS], {
    description: 'self_declared: typed by the User; card_seen: the User says they looked at the card; verified_with_agency: read from the agency\'s own record by an import (never settable by hand)',
  }),
  expiry: Type.Enum(['none', 'valid', 'soon', 'expired'], {
    description: 'none: no expiry date; soon: expires within 90 days (the day itself is still valid); expired: the date has passed. Expired cards come last in the list',
  }),
  notes: Nullable(Type.String()),
  source: Nullable(Type.String({ description: 'The Provider the card was imported from (`ssi`). Not null: the card\'s fields can\'t be changed, only its notes' })),
  cardId: Nullable(Type.String({ description: 'The Provider\'s ID of the card' })),
  category: Nullable(Type.String({ description: 'The Provider\'s category code, e.g. `scubadiving`; not a translation' })),
  imageState: Type.Enum([...CERTIFICATION_IMAGE_STATES], { description: 'pending: a job will fetch the picture; failed: show "Fetch again" (POST …/image)' }),
  imageUrl: Nullable(Type.String({ description: 'API path of the picture (needs the session); set only while imageState is stored' })),
  importedAt: Nullable(DateTime),
  version: Type.Integer({ description: 'Send it back with a change; 409 certification_changed when the card changed meanwhile' }),
  createdAt: DateTime,
}, { $id: 'CertificationView', description: 'A certification card of a Diver (ADR 0050)' });
export const CertificationView = refTo(CertificationViewSchema);

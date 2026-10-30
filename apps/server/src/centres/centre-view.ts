// A Dive centre over HTTP (ADR 0043): the view the centre routes answer.
import { Type, type Static } from 'typebox';
import { CENTRE_SOURCE_NAME, CENTRE_SOURCES, type CentreService } from './centre-service.js';
import { Nullable, refTo } from '../http/schemas.js';
import { VerificationCodeView } from './verification-code-view.js';

export const Source = Type.Enum([...CENTRE_SOURCES]);

/** Registered with app.addSchema; routes answer CentreView, the reference. */
export const CentreViewSchema = Type.Object({
  id: Type.String(),
  name: Type.String({ description: 'The whole name, as its Source spells it (SSI: with the town). This is what is edited, and what the code holds' }),
  displayName: Type.String({ description: 'The name to show: the whole name shortened by the rule of the Source the centre has an ID at (SSI: without the town)' }),
  externalIds: Type.Array(Type.Object({
    source: Source,
    name: Type.String({ description: 'The Source\'s name, e.g. "SSI"' }),
    externalId: Type.String({ description: 'e.g. the SSI centre number' }),
  })),
  sites: Type.Array(Type.Object({ id: Type.String(), name: Type.String() }), { description: 'The Dive sites the centre is responsible for, by name' }),
  verificationCode: Nullable(VerificationCodeView),
  version: Type.Integer({ description: 'Send it back with a rename; it changes with every rename' }),
  canDelete: Type.Boolean({ description: 'Whether the signed-in User may delete it: its creator or an admin' }),
}, { $id: 'CentreView' });
export const CentreView = refTo(CentreViewSchema);

type Row = Awaited<ReturnType<CentreService['get']>>;
export const toCentreView = ({ centre: c, externalIds, sites, canDelete, displayName, verificationCode }: Row): Static<typeof CentreView> => ({
  id: c.id, name: c.name, displayName,
  externalIds: externalIds.map((e) => ({ source: e.source, name: CENTRE_SOURCE_NAME[e.source], externalId: e.externalId })),
  sites, verificationCode, version: c.version, canDelete,
});

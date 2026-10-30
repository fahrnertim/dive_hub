// How a Conflict (ADR 0056) is shown and chosen over HTTP: in a Dive's status, a send, an import preview and "Needs your decision".
import { Type, type TOptional } from 'typebox';
import { CYLINDER_MATERIALS } from '../../db/schema.js';
import { Nullable, refTo } from '../../http/schemas.js';
import { SYNCED_FIELDS, type SyncedField } from '../dive-import/three-way.js';

const ConflictCylinder = Type.Object({
  volumeL: Nullable(Type.Number()),
  material: Nullable(Type.Enum([...CYLINDER_MATERIALS])),
  startPressureBar: Nullable(Type.Number()),
  endPressureBar: Nullable(Type.Number()),
  gas: Nullable(Type.Object({ o2: Type.Number(), he: Type.Number() }, { description: 'O₂ and He as percent' })),
});
export const ConflictValue = Type.Union([Type.String(), Type.Number(), Type.Array(Type.String()), ConflictCylinder], {
  description: 'site: its name; buddies: the names of Divers here (people Dive Hub doesn\'t know are left out); startsAt: local "YYYY-MM-DD HH:MM"; '
    + 'cylinder: the tank typed at the Provider, or the Dive\'s only Cylinder in the same values (null: none); '
    + 'lead: the weight typed at the Provider, or the total of the Dive\'s Lead, in kg (null: none)',
});
/** A User's choice for one Conflict: the Dive's value goes out (hub), or the Provider's comes in (provider). */
const ConflictChoice = Type.Enum(['hub', 'provider']);
/** The choice per field of a Conflict (a key per synced field); a field that is no Conflict any more is ignored. */
export const ConflictChoices = Type.Object(
  Object.fromEntries(SYNCED_FIELDS.map((f) => [f, Type.Optional(ConflictChoice)])) as Record<SyncedField, TOptional<typeof ConflictChoice>>, {
  additionalProperties: false,
  description: "Per Conflict: hub sends the Dive's value, provider takes the Provider's. A field that is no Conflict any more is ignored",
});

/** One field changed on both sides, differently: both values as the import preview says them (ADR 0056). */
export const ConflictFieldViewSchema = Type.Object({
  field: Type.Enum([...SYNCED_FIELDS], { description: 'The field the two sides differ on' }),
  hub: Nullable(ConflictValue),
  provider: Nullable(ConflictValue),
}, { $id: 'ConflictFieldView' });
export const ConflictFieldView = refTo(ConflictFieldViewSchema);

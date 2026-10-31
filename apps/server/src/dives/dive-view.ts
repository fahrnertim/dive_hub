// One Dive over HTTP (ADR 0015): the view its routes answer (DiveView, registered with app.addSchema), and the parts of
// it an edit sends back (values, Cylinders, Lead, weighting, suit).
import { Type } from 'typebox';
import {
  CYLINDER_MATERIALS, LEAD_PLACEMENTS, OVERRIDABLE_FIELDS, SUIT_TYPES, SUIT_UNDERGARMENTS, WEIGHTING_FELT, PARTICIPANT_ROLES, UTC_OFFSET_SOURCES,
} from '../db/schema.js';
import { DECO_MODELS, DIVE_MODES, GAS_CIRCUITS, SITE_WATER_TYPES, WATER_TYPES } from '../vocabulary.js';
import { SAC_MISSING } from './calc/sac.js';
import { PositionSchema } from '../sites/position-view.js';
import { VerificationCodeView } from '../centres/verification-code-view.js';
import { DateTime, Nullable, refTo } from '../http/schemas.js';

export const Field = Type.Enum([...OVERRIDABLE_FIELDS], { description: 'A Dive value that can be overridden' });
/** Start time with the local UTC offset at the dive (gap A8). */
const StartsAt = Type.Object({
  at: DateTime,
  utcOffsetSeconds: Nullable(Type.Integer({ minimum: -12 * 3600, maximum: 14 * 3600, multipleOf: 900 })),
});

export const valueProperties = {
  startsAt: StartsAt,
  durationSeconds: Type.Number({ minimum: 0, maximum: 48 * 3600 }),
  maxDepthM: Nullable(Type.Number({ minimum: 0, maximum: 400 })),
  avgDepthM: Nullable(Type.Number({ minimum: 0, maximum: 400 })),
  waterTemperatureC: Nullable(Type.Number({ minimum: -5, maximum: 50 })),
};
/** The values a User can set or a Recording gives. The Dive's number is neither (ADR 0048): a request naming it is 400. */
export const ValuesSchema = Type.Object(valueProperties, { additionalProperties: false });
/** The values in effect: the Dive's number is computed, shown with them. */
const DiveValuesView = Type.Object({
  number: Nullable(Type.Integer({ description: "The Dive's place in its Diver's logbook plus the Diver's dives before it (ADR 0048): computed, never set; null for a Dive that doesn't count" })),
  ...valueProperties,
});

const SummaryView = Type.Object({
  diveNumber: Type.Optional(Type.Integer()),
  diveMode: Type.Optional(Type.Enum([...DIVE_MODES])),
  decoModel: Type.Optional(Type.Enum([...DECO_MODELS])),
  gfLow: Type.Optional(Type.Number()),
  gfHigh: Type.Optional(Type.Number()),
  waterType: Type.Optional(Type.Enum([...WATER_TYPES], { description: 'The computer\'s salinity setting, not the water of the Dive (that is the site\'s)' })),
  waterDensity: Type.Optional(Type.Number({ description: 'Density the computer computed depths with, kg/m³' })),
  gases: Type.Optional(Type.Array(Type.Object({
    o2: Type.Number(), he: Type.Number(), circuit: Type.Optional(Type.Enum([...GAS_CIRCUITS])),
    tankVolumeL: Type.Optional(Type.Number({ description: 'With a tank pod: the size of the tank, litres' })),
    startPressureBar: Type.Optional(Type.Number()),
    endPressureBar: Type.Optional(Type.Number()),
  }))),
  minTemperatureC: Type.Optional(Type.Number()),
  maxTemperatureC: Type.Optional(Type.Number()),
  avgHeartRate: Type.Optional(Type.Number()),
  surfaceIntervalSeconds: Type.Optional(Type.Number()),
  cnsStart: Type.Optional(Type.Number()),
  cnsEnd: Type.Optional(Type.Number()),
  otuStart: Type.Optional(Type.Number({ description: 'Oxygen dose, OTU' })),
  otuEnd: Type.Optional(Type.Number()),
  sacLpm: Type.Optional(Type.Number({ description: 'Gas consumption at the surface as a tank pod measured it, L/min' })),
  conservatism: Type.Optional(Type.Number({ description: 'The personal setting of the computer where its model has one (Suunto: -2 to +2)' })),
  surfacePressureBar: Type.Optional(Type.Number()),
  extras: Type.Optional(Type.Record(Type.String(), Type.String(), {
    description: 'Source values without a word in our vocabulary, by source field name',
  })),
});

export const Role = Type.Enum([...PARTICIPANT_ROLES], { description: 'buddy: dived together; guide: led the dive; instructor: taught on it' });
const Participant = Type.Object({
  diverId: Type.String(),
  name: Type.String({ description: 'The Diver\'s name, as every User sees it' }),
  role: Role,
});

const SeriesRef = Type.Object({
  recordingId: Type.String({ format: 'uuid' }),
  channel: Type.String({ maxLength: 40, description: 'A tank pod\'s pressure channel of that Recording: tankPressure, further pods tankPressure:<n>' }),
}, { additionalProperties: false, description: 'The pressure series of one of the Dive\'s Recordings that measured this Cylinder' });
export const CylinderValues = {
  volumeL: Nullable(Type.Number({ exclusiveMinimum: 0, maximum: 100, description: 'Water volume in litres' })),
  workingPressureBar: Nullable(Type.Number({ exclusiveMinimum: 0, maximum: 500 })),
  material: Nullable(Type.Enum([...CYLINDER_MATERIALS])),
  gas: Nullable(Type.Object({
    o2: Type.Number({ minimum: 1, maximum: 100 }), he: Type.Number({ minimum: 0, maximum: 99 }),
  }, { additionalProperties: false, description: 'Oxygen and helium in percent' })),
  startPressureBar: Nullable(Type.Number({ minimum: 0, maximum: 500 })),
  endPressureBar: Nullable(Type.Number({ minimum: 0, maximum: 500, description: 'Not above the start pressure' })),
};
export const CylinderView = Type.Object({
  ...CylinderValues,
  fromPod: Type.Boolean({ description: 'An import made it from a tank pod\'s data and it still has the pod\'s series: clients say so (docs/spec/clients.md)' }),
  series: Nullable(SeriesRef),
});
export const CylinderInput = Type.Object({
  ...Type.Partial(Type.Object(CylinderValues)).properties,
  series: Type.Optional(Nullable(SeriesRef)),
}, { additionalProperties: false });

export const LeadEntry = Type.Object({
  amountKg: Type.Number({ minimum: 0, maximum: 60, description: 'In kilograms; 0 as the only entry means no lead' }),
  placement: Nullable(Type.Enum([...LEAD_PLACEMENTS], { description: 'Where it was carried; null when not given' })),
});
export const LeadInput = Type.Object({
  amountKg: LeadEntry.properties.amountKg, placement: Type.Optional(LeadEntry.properties.placement),
}, { additionalProperties: false });
export const WeightingFeedbackValues = {
  felt: Type.Enum([...WEIGHTING_FELT], { description: 'How the weighting felt' }),
  amountKg: Nullable(Type.Number({ exclusiveMinimum: 0, maximum: 30, description: 'By how many kilograms it was too heavy or too light, where the User said' })),
};
export const SuitValues = {
  type: Type.Enum([...SUIT_TYPES], { description: '`none` is a dive without a suit' }),
  thicknessMm: Nullable(Type.Number({ exclusiveMinimum: 0, maximum: 20, description: 'For a wetsuit or a semidry suit' })),
  // One `type` with both names, not Nullable: null first would turn a request's `false` into null (the validator coerces).
  hood: Type.Unsafe<boolean | null>({ type: ['boolean', 'null'], description: 'Whether a hood was worn; null when not said' }),
  undergarment: Nullable(Type.Enum([...SUIT_UNDERGARMENTS], { description: 'Under a drysuit' })),
};
export const WeightingFeedbackInput = Type.Object({
  felt: WeightingFeedbackValues.felt, amountKg: Type.Optional(WeightingFeedbackValues.amountKg),
}, {
  additionalProperties: false,
  description: 'How the weighting felt, or null for nothing said. 400 weighting_feedback_invalid for an amount with `right`',
});
export const SuitInput = Type.Object({
  type: SuitValues.type, thicknessMm: Type.Optional(SuitValues.thicknessMm), hood: Type.Optional(SuitValues.hood),
  undergarment: Type.Optional(SuitValues.undergarment),
}, {
  additionalProperties: false,
  description: 'The exposure suit, or null for unknown; a value left out is unknown. 400 suit_invalid for a thickness on anything but a wetsuit '
    + 'or a semidry suit, or an undergarment under anything but a drysuit',
});

const RecordingView = Type.Object({
  id: Type.String(),
  isPrimary: Type.Boolean(),
  device: Nullable(Type.Object({ manufacturer: Type.String(), product: Nullable(Type.String()), serialNumber: Type.String() })),
  startsAt: DateTime,
  durationSeconds: Type.Number(),
  maxDepthM: Nullable(Type.Number()),
  parser: Type.String(),
  summary: SummaryView,
  channels: Type.Array(Type.String()),
});

/** Registered with app.addSchema; routes answer DiveView, the reference. */
export const DiveViewSchema = Type.Object({
  id: Type.String(),
  diverId: Type.String({ description: 'The Diver whose logbook this Dive is in' }),
  version: Type.Integer({ description: 'Send it back with an edit; it changes with every change' }),
  values: DiveValuesView,
  overrides: Type.Array(Field, { description: 'Values the User set by hand' }),
  utcOffsetSource: Type.Enum([...UTC_OFFSET_SOURCES], {
    description: 'Where the start\'s UTC offset came from (ADR 0030): device, position (the time zone where the dive was), nearby (the '
      + 'Diver\'s Dives within 7 days) or unknown (startsAt is the local wall-clock time kept as if UTC: show it in UTC without an '
      + 'offset). Clients say where it came from when it isn\'t the device (docs/spec/clients.md)',
  }),
  fromProvider: Nullable(Type.String({
    description: 'The Provider whose logbook entry this Dive was made from (ADR 0030); with no recordings, its values are that entry\'s',
  })),
  fromRecording: Nullable(ValuesSchema, ),
  notes: Nullable(Type.String()),
  site: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, { description: 'The Dive site (ADR 0020)' })),
  waterType: Nullable(Type.Enum([...SITE_WATER_TYPES], {
    description: 'The Dive site\'s water type (ADR 0025); null without a site, or when the site has none. Not editable on the Dive',
  })),
  waterMismatch: Nullable(Type.Object({
    computer: Type.Enum([...WATER_TYPES], { description: 'What the Primary recording\'s computer was set to' }),
    site: Type.Enum([...SITE_WATER_TYPES]),
    depthPercent: Nullable(Type.Number({ description: 'Recorded vs true depth in percent: negative reads shallow, positive deep; null where a density is unknown' })),
  }, { description: 'Set when the computer was set to other water than the site\'s: clients say so (docs/spec/clients.md)' })),
  position: Nullable(Type.Object(PositionSchema.properties, {
    description: 'Where the Device of the Primary recording placed the dive: its exit, else its entry. Private like the Dive',
  })),
  recordings: Type.Array(RecordingView),
  cylinders: Type.Array(CylinderView, { description: 'The Dive\'s Cylinders in their order (ADR 0045)' }),
  lead: Type.Array(LeadEntry, { description: 'The Lead the Dive was dived with, as placed entries in their order (ADR 0031); none means unknown' }),
  leadTotalKg: Nullable(Type.Number({ description: 'The sum of the Lead entries; null when there are none (unknown), 0 for a Dive without lead' })),
  weightingFeedback: Nullable(Type.Object(WeightingFeedbackValues, { description: 'How the weighting felt on this Dive (ADR 0031); null when nothing was said' })),
  suit: Nullable(Type.Object(SuitValues, { description: 'The exposure suit (ADR 0031); null when unknown' })),
  sac: Nullable(Type.Object({
    litresPerMinute: Type.Number({ description: 'Litres per minute at the surface, summed over all the Dive\'s Cylinders, with real gas' }),
    barPerMinute: Nullable(Type.Number({ description: 'The pressure drop per minute at the surface; only for a Dive with exactly one Cylinder' })),
  }, { description: 'SAC on this dive, computed from its Cylinders, its average depth and its duration, never stored (ADR 0045)' })),
  sacMissing: Nullable(Type.Enum([...SAC_MISSING], {
    description: 'Why a Dive with Cylinders has no SAC: shorter than 15 minutes, no average depth, or a Cylinder without both pressures and a volume',
  })),
  participants: Type.Array(Participant, { description: 'Buddies first, then guides and instructors (ADR 0028)' }),
  verificationCodes: Type.Array(Type.Object({
    kind: Type.Enum(['centre', 'professional'], { description: 'Whose code it is: a Dive centre\'s (centre is set) or a professional\'s (diver is set)' }),
    centre: Nullable(Type.Object({ id: Type.String(), name: Type.String(), displayName: Type.String({ description: 'The name to show' }) }, { description: 'The Dive centre the code belongs to; name it beside the code' })),
    diver: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, { description: 'The professional the code belongs to, a Participant of the Dive; name them beside the code' })),
    ...VerificationCodeView.properties,
  }), {
    description: 'The codes that verify the Dive at a Provider (ADR 0043): those of the Dive centres responsible for its site, by centre name, '
      + 'then those of its Participants with a leader number, whatever their role, by name. No other condition: not a Push, not the Diver. '
      + 'Draw each text as a QR code (docs/spec/clients.md)',
  }),
}, { $id: 'DiveView' });
export const DiveView = refTo(DiveViewSchema);

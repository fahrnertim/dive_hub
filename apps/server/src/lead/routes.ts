// The lead estimate (ADR 0031, slice 20b): computed on request, nothing stored. A starting point with its range, its
// reasons and a weight check, never a certain number; clients must show all of it (docs/spec/clients.md).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import type { Db } from '../db/client.js';
import { CYLINDER_MATERIALS, SUIT_TYPES, SUIT_UNDERGARMENTS } from '../db/schema.js';
import type { Suit } from '../dives/weighting.js';
import { Problem, problem } from '../http/problems.js';
import { SITE_WATER_TYPES } from '../vocabulary.js';
import { leadEstimateOf, managesDiver } from './service.js';
import type { EstimateBasis } from './types.js';

export interface LeadRouteDeps {
  db: Db;
  auth: Auth;
}

/** The weight check every answer asks for: what to do, as codes clients translate (research note, "Safety"). */
const WEIGHT_CHECK_STEPS = ['eye_level_empty_bc', 'neutral_at_5m_at_reserve'] as const;

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);
const Water = Type.Enum([...SITE_WATER_TYPES]);

const PlannedCylinders = Type.Array(Type.Object({
  volumeL: Type.Number({ exclusiveMinimum: 0, maximum: 40, description: 'Water volume in litres; a twin set as the sum of both' }),
  material: Type.Optional(Nullable(Type.Enum([...CYLINDER_MATERIALS]))),
}, { additionalProperties: false }), { minItems: 1, maxItems: 4 });

const EstimateQuery = Type.Object({
  water: Water,
  suit: Type.Enum([...SUIT_TYPES], { description: '`none` is a dive without a suit' }),
  suitThicknessMm: Type.Optional(Type.Number({ minimum: 0, maximum: 15, description: 'Wetsuit or semidry only' })),
  suitHood: Type.Optional(Type.Boolean()),
  suitUndergarment: Type.Optional(Type.Enum([...SUIT_UNDERGARMENTS], { description: 'Drysuit only' })),
  cylinders: Type.String({
    description: 'JSON: [{"volumeL": litres, "material": "aluminium" | "steel" | "carbon" (optional)}], 1 to 4; the catalogue gives both',
  }),
  unit: Type.Optional(Type.Enum(['kg', 'lb'], { default: 'kg', description: 'The unit of every amount in the answer, rounded to 0.5 kg or 1 lb (ADR 0014)' })),
});

const Amount = Type.Number({ description: 'In the answer\'s `unit`' });

const EstimateView = Type.Object({
  unit: Type.Enum(['kg', 'lb']),
  total: Nullable(Type.Number({ description: 'Rounded to 0.5 kg or 1 lb. Null when it can\'t be told: no body weight and no Dive with this suit' })),
  range: Nullable(Type.Object({ low: Type.Number(), high: Type.Number() }, { description: 'Always shown with the total; null together with it' })),
  confidence: Type.Enum(['low', 'medium', 'high']),
  basis: Nullable(Type.Union([
    Type.Object({
      kind: Type.Literal('dives'),
      dives: Type.Array(Type.Object({
        diveId: Type.String({ description: 'Link to the Dive: GET /dives/{id}' }),
        startsAt: Type.String({ format: 'date-time' }),
        number: Nullable(Type.Integer()),
        carried: Amount,
        needed: Type.Number({ description: 'What it needed: carried, corrected by its feedback; in the answer\'s `unit`' }),
        weight: Type.Number({ description: 'How much it counts: felt right twice, older Dives less' }),
      })),
      personal: Amount,
    }),
    Type.Object({
      kind: Type.Literal('rule_of_thumb'),
      rule: Amount,
      personalOffset: Nullable(Amount),
      offsetFromSuits: Type.Integer(),
    }),
  ])),
  adjustments: Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal('cylinder'), amount: Amount }),
    Type.Object({ kind: Type.Literal('water'), amount: Amount, water: Water }),
    Type.Object({ kind: Type.Literal('personal_offset'), amount: Amount }),
  ]), { description: 'Each is part of the total; show them with their reason' }),
  missing: Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal('body_weight') }),
    Type.Object({ kind: Type.Literal('cylinder_material'), diveIds: Type.Array(Type.String()), planned: Type.Boolean() }),
    Type.Object({ kind: Type.Literal('cylinder'), diveIds: Type.Array(Type.String()) }),
    Type.Object({ kind: Type.Literal('suit_thickness') }),
    Type.Object({ kind: Type.Literal('suit_undergarment') }),
  ]), { description: 'What the answer had to assume or couldn\'t use; tell the User where to add it' }),
  reserve: Type.Object({
    bar: Type.Number({ description: 'The cylinder pressure the estimate is for: neutral at 5 m with this much left' }),
    fromDives: Type.Boolean({ description: 'The median of the Diver\'s logged end pressures, else 50 bar' }),
  }),
  leftOut: Type.Object({
    noWaterType: Type.Integer({ description: 'Dives with lead and a suit that could not be used: no site, or a site without a water type (ADR 0025)' }),
  }),
  weightCheck: Type.Object({
    steps: Type.Array(Type.Enum([...WEIGHT_CHECK_STEPS]), { description: 'Always both, in this order; clients show them with every answer' }),
    reserveBar: Type.Number({ description: 'The pressure for the second step: the same as `reserve.bar`' }),
  }, { description: 'The estimate is a starting point, never a substitute for this' }),
});

export const leadRoutes: FastifyPluginAsyncTypebox<LeadRouteDeps> = async (app, deps) => {
  const { db } = deps;
  app.addHook('onRequest', requireUser(deps.auth));

  app.get('/divers/:id/lead-estimate', {
    schema: {
      summary: 'How much lead a Diver should carry in planned conditions: a starting point with a range and its reasons (ADR 0031)',
      description: 'From the Diver\'s own Dives with the same suit set-up, adjusted for the cylinder and the water, else a rule of thumb '
        + 'from their body weight. Only for a User who keeps the Diver\'s logbook; others get 404 `diver_not_found`, as for body weights. '
        + 'Never certain: the answer always carries `range`, `basis`, `adjustments`, `missing` and the `weightCheck`; `total` and `range` are '
        + 'null when there is no Dive with the suit and no body weight. Nothing is stored. 400 `suit_invalid` for a thickness on a suit that has none, '
        + 'or an undergarment under anything but a drysuit.',
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      querystring: EstimateQuery,
      response: { 200: EstimateView, 400: Problem, 404: Problem },
    },
  }, async (request, reply) => {
    if (!(await managesDiver(db, request.user!.id, request.params.id))) return reply.code(404).send(problem('diver_not_found'));
    const { water, suit, suitThicknessMm, suitHood, suitUndergarment, cylinders, unit = 'kg' } = request.query;
    if ((suitThicknessMm !== undefined && suit !== 'wetsuit' && suit !== 'semidry') || (suitUndergarment !== undefined && suit !== 'drysuit')) {
      return reply.code(400).send(problem('suit_invalid'));
    }
    let planned: unknown;
    try { planned = JSON.parse(cylinders); } catch { return reply.code(400).send(problem('invalid_input')); }
    if (!Value.Check(PlannedCylinders, planned)) return reply.code(400).send(problem('invalid_input'));

    const plannedSuit: Suit = { type: suit, thicknessMm: suitThicknessMm ?? null, hood: suitHood ?? null, undergarment: suitUndergarment ?? null };
    const answer = await leadEstimateOf(db, request.params.id, {
      water, suit: plannedSuit, cylinders: planned.map((c) => ({ volumeL: c.volumeL, material: c.material ?? null })),
    }, unit);
    const { estimate } = answer;

    const basis = estimate.basis && withDiveLinks(estimate.basis, answer.dives);
    return { ...estimate, basis, leftOut: { noWaterType: answer.noWaterType }, weightCheck: { steps: [...WEIGHT_CHECK_STEPS], reserveBar: estimate.reserve.bar } };
  });
};

/** The engine names Dives by ID; the answer gives each its date and number to be shown, and the ID to link. */
function withDiveLinks(basis: EstimateBasis, known: Map<string, { startsAt: Date; number: number | null }>) {
  if (basis.kind === 'rule_of_thumb') return basis;
  return {
    ...basis,
    dives: basis.dives.map(({ id, ...rest }) => {
      const d = known.get(id)!;
      return { diveId: id, startsAt: d.startsAt.toISOString(), number: d.number, ...rest };
    }),
  };
}

// The Tools page's gas numbers and bottom time (ADR 0032, slice 21): computed on request, nothing stored. They are
// limits from the Diver's own input and settings, not advice; clients must show the assumptions (docs/spec/clients.md).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser, userOf } from '../auth/fastify.js';
import { answerErrors, answers, Problem } from '../http/problems.js';
import { Nullable } from '../http/schemas.js';
import type { PlanningService } from './planning-service.js';
import { BOTTOM_TIME_RULES } from './bottom-time-service.js';
import { gasNumbers } from './gas-numbers.js';
import { PLAN_RULES } from './gas-plan-service.js';
import { PLANNING_WATERS } from './gas.js';
import { PlanningError } from './planning-error.js';

export interface PlanningRouteDeps {
  auth: Auth;
  planning: PlanningService;
}

const Fraction = Type.Number({ minimum: 0, maximum: 100 });
const Water = Type.Enum([...PLANNING_WATERS]);
const Depth = Type.Number({ minimum: 0, maximum: 300, description: 'Metres' });

const GasQuery = Type.Object({
  o2: Type.Number({ minimum: 1, maximum: 100, description: 'Oxygen, percent' }),
  he: Type.Optional(Fraction),
  depth: Type.Optional(Depth),
  water: Type.Optional(Water),
  altitude: Type.Optional(Type.Number({ minimum: 0, maximum: 5000, description: 'Metres above sea level' })),
  ppo2Working: Type.Optional(Type.Number({ minimum: 1, maximum: 2 })),
  ppo2Contingency: Type.Optional(Type.Number({ minimum: 1, maximum: 2 })),
  oxygenNarcotic: Type.Optional(Type.Boolean({ description: 'Count oxygen as narcotic for END (default true)' })),
});

const GasView = Type.Object({
  gas: Type.Object({ o2: Type.Number(), he: Type.Number() }),
  hypoxic: Type.Boolean({ description: 'Under 18 % oxygen at the surface' }),
  ppO2Limits: Type.Object({ working: Type.Number(), contingency: Type.Number() }),
  modWorkingM: Type.Number({ description: 'Rounded down to 0.1 m' }),
  modContingencyM: Type.Number({ description: 'Rounded down to 0.1 m' }),
  atDepth: Nullable(Type.Object({
    depthM: Type.Number(), ppO2: Type.Number(), bestMixPercent: Type.Integer(), eadM: Type.Number(), endM: Type.Number(),
  }), { description: 'Null without a depth' }),
  conditions: Type.Object({ water: Water, altitudeM: Type.Number() }),
  oxygenNarcotic: Type.Boolean(),
});

const BottomTimeQuery = Type.Object({
  depth: Type.Number({ minimum: 1, maximum: 300, description: 'Metres' }),
  o2: Type.Number({ minimum: 1, maximum: 100 }),
  he: Type.Optional(Fraction),
  volume: Type.Optional(Type.Number({ minimum: 1, maximum: 60, description: 'Cylinder volume, litres' })),
  pressure: Type.Optional(Type.Number({ minimum: 1, maximum: 350, description: 'Cylinder fill pressure, bar' })),
  sac: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: 'L/min at the surface' })),
  rule: Type.Optional(Type.Enum([...BOTTOM_TIME_RULES], { description: 'Where the gas ends (ADR 0033). Default rock_bottom: ascend at rock bottom, never below 50 bar' })),
  bar: Type.Optional(Type.Number({ minimum: 0, maximum: 350, description: 'Bar for rule reserve (left at the end) or ascent_pressure (where the ascent starts)' })),
  gfHigh: Type.Optional(Type.Number({ minimum: 20, maximum: 100 })),
  water: Type.Optional(Water),
  altitude: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
  ppo2Working: Type.Optional(Type.Number({ minimum: 1, maximum: 2 })),
  ppo2Contingency: Type.Optional(Type.Number({ minimum: 1, maximum: 2 })),
  diverId: Type.Optional(Type.String({ format: 'uuid', description: 'Start from this Diver\'s computer GF, SAC and last Dive' })),
  siteId: Type.Optional(Type.String({ format: 'uuid', description: 'Plan at this site: its water type' })),
});

const GasPlanBody = Type.Object({
  o2: Type.Number({ minimum: 1, maximum: 100 }),
  he: Type.Optional(Fraction),
  levels: Type.Array(Type.Object({
    depth: Type.Number({ minimum: 1, maximum: 300, description: 'Metres' }),
    minutes: Type.Number({ minimum: 0, maximum: 600, description: 'At that depth after arriving' }),
  }), { minItems: 1, maxItems: 8 }),
  divers: Type.Array(Type.Object({
    name: Type.String({ maxLength: 80 }),
    volume: Type.Number({ minimum: 1, maximum: 60, description: 'Cylinder volume, litres' }),
    pressure: Type.Number({ minimum: 1, maximum: 350, description: 'Cylinder fill pressure, bar' }),
    sac: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: 'L/min at the surface' })),
    diverId: Type.Optional(Type.String({ format: 'uuid', description: 'Any Diver; one the User manages brings their planning SAC' })),
  }), { minItems: 1, maxItems: 8 }),
  rule: Type.Optional(Type.Enum([...PLAN_RULES], { description: 'Default rock_bottom: ascend at rock bottom, never below 50 bar' })),
  bar: Type.Optional(Type.Number({ minimum: 0, maximum: 350, description: 'Bar for rule reserve (left at the end) or ascent_pressure (where the ascent starts)' })),
  water: Type.Optional(Water),
  altitude: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
  ppo2Contingency: Type.Optional(Type.Number({ minimum: 1, maximum: 2 })),
  siteId: Type.Optional(Type.String({ format: 'uuid', description: 'Plan at this site: its water type' })),
  descentRate: Type.Optional(Type.Number({ minimum: 3, maximum: 30, description: 'Metres a minute, default 18' })),
  ascentRate: Type.Optional(Type.Number({ minimum: 3, maximum: 18, description: 'Metres a minute, default 9; rock bottom follows a slower one' })),
});

const Used = <T extends Parameters<typeof Type.Union>[0][number]>(value: T) => Type.Object({
  value,
  source: Type.Enum(['request', 'recording', 'logbook', 'site', 'default'], {
    description: 'Where the value came from: the request, the Diver\'s latest Recording with a GF, the median of their Recordings\' SAC, the site, or the stated default',
  }),
});

const PlanRule = Type.Object({ kind: Type.Enum([...PLAN_RULES]), bar: Nullable(Type.Number()) });
const PlanCommon = {
  gas: Type.Object({ o2: Type.Number(), he: Type.Number() }),
  used: Type.Object({
    water: Used(Water), altitudeM: Used(Type.Number()), gasRule: Used(PlanRule),
    descentRateMPerMin: Used(Type.Number()), ascentRateMPerMin: Used(Type.Number()),
  }),
  rule: PlanRule,
};

const GasPlanView = Type.Union([
  Type.Object({
    status: Type.Literal('ok'),
    ...PlanCommon,
    runtimeMinutes: Type.Number(),
    segments: Type.Array(Type.Object({
      kind: Type.Enum(['descent', 'level', 'ascent', 'safety_stop']),
      fromDepthM: Type.Number(), depthM: Type.Number({ description: 'Where it ends; the same as fromDepthM for a level and the stop' }),
      minutes: Type.Number(), ambientBar: Type.Number({ description: 'Mean over the stretch' }),
    }), { description: 'Every stretch in the order it is dived' }),
    divers: Type.Array(Type.Object({
      name: Type.String(), diverId: Nullable(Type.String()),
      sacLpm: Type.Intersect([Used(Type.Number()), Type.Object({ basedOn: Type.Optional(Type.Integer({ description: 'How many Dives the planning SAC rests on' })) })]),
      volumeL: Type.Number(), startPressureBar: Type.Number(), litres: Type.Number(), endPressureBar: Type.Number(),
      rockBottom: Type.Array(Type.Object({ depthM: Type.Number(), pressureBar: Type.Number() }), { description: 'At every level' }),
      ascentPressureBar: Type.Number(),
      turnPressureBar: Nullable(Type.Number({ description: 'Under halves, thirds and sixths' })),
      belowRockBottom: Type.Boolean(), atAscentStartBar: Type.Number(), marginBar: Type.Number(),
      marginMinutes: Type.Number({ description: 'Negative when the plan stays too long' }),
      controlling: Type.Boolean(),
      recentDiveEndedAt: Nullable(Type.String({ description: 'A Dive within 48 hours: the real limit is shorter than shown' })),
      pressuresBar: Type.Array(Type.Number(), { description: 'At the start and at the end of every segment' }),
    })),
    controllingIndex: Type.Integer(), fits: Type.Boolean(),
    leaveLastLevelAtMinute: Type.Number({ description: 'Run time at which the controlling Diver must leave the last level' }),
  }),
  Type.Object({
    status: Type.Literal('outside_limits'),
    ...PlanCommon,
    reason: Type.Enum(['depth', 'mod', 'gas']),
    levelIndex: Nullable(Type.Integer({ description: 'The level outside the limits; null for the gas' })),
  }),
]);

const BottomTimeView = Type.Object({
  status: Type.Enum(['ok', 'outside_limits']),
  reason: Type.Optional(Type.Enum(['depth', 'mod', 'gas'], { description: 'Why there is no number: deeper than 40 m, beyond the MOD at the contingency ppO2, or a mix other than air and nitrox 21-40 %' })),
  modM: Type.Optional(Nullable(Type.Number())),
  minutes: Type.Optional(Type.Integer({ description: 'Whole minutes from leaving the surface to leaving the depth' })),
  binding: Type.Optional(Type.Array(Type.Enum(['ndl', 'oxygen', 'gas']), { description: 'The limits that decide; several when they bind together' })),
  limits: Type.Optional(Type.Object({
    ndl: Nullable(Type.Number(), { description: 'Minutes; null when the depth does not limit' }),
    oxygen: Nullable(Type.Number()),
    gas: Nullable(Type.Number(), { description: 'Null without a Cylinder' }),
  })),
  otu: Type.Optional(Type.Number()),
  ppO2AtDepth: Type.Optional(Type.Number()),
  ppO2AboveWorking: Type.Optional(Type.Boolean()),
  ascentPressureBar: Type.Optional(Nullable(Type.Number(), { description: 'The pressure the gas limit ends at; null without a Cylinder' })),
  used: Type.Object({
    gfHigh: Used(Type.Number()),
    sacLpm: Type.Intersect([Used(Type.Number()), Type.Object({ basedOn: Type.Optional(Type.Integer({ description: 'How many Dives the planning SAC rests on' })) })]),
    water: Used(Water), altitudeM: Used(Type.Number()),
    gasRule: Used(Type.Object({ kind: Type.Enum([...BOTTOM_TIME_RULES]), bar: Nullable(Type.Number()) })),
  }),
  gas: Type.Object({ o2: Type.Number(), he: Type.Number() }),
  depthM: Type.Number(),
  recentDiveEndedAt: Nullable(Type.String(), { description: 'When the Diver\'s Dive within the last 48 hours ended; the real limit is then shorter than shown' }),
});

const STATUS: Record<PlanningError['code'], number> = {
  invalid_input: 400, gas_not_breathable: 400, diver_not_found: 404, site_not_found: 404,
};

export const planningRoutes: FastifyPluginAsyncTypebox<PlanningRouteDeps> = async (app, deps) => {
  app.addHook('onRequest', requireUser(deps.auth));

  app.setErrorHandler(answerErrors(answers(PlanningError, STATUS)));

  app.get('/tools/gas', {
    schema: {
      summary: 'MOD and gas numbers for a mix (ADR 0032): a limit from the inputs, not advice',
      querystring: GasQuery, response: { 200: GasView, 400: Problem },
    },
  }, async (request) => gasNumbers(request.query));

  app.get('/tools/bottom-time', {
    schema: {
      summary: 'Bottom time for a planned dive: the shortest of the no-decompression, oxygen and gas limits, and which binds (ADR 0032)',
      description: 'An estimate from the Diver\'s own input and settings, not advice; the dive computer and training govern. '
        + 'Air and nitrox 21-40 % only, no-stop only, at most 40 m; otherwise status `outside_limits`.',
      querystring: BottomTimeQuery, response: { 200: BottomTimeView, 400: Problem, 404: Problem },
    },
  }, async (request) => deps.planning.bottomTime(userOf(request).id, request.query));

  app.post('/tools/gas-plan', {
    schema: {
      summary: 'A gas plan for one Diver or a group: litres, pressures, rock bottom and the ascent pressure of a gas rule (ADR 0033)',
      description: 'An estimate from the Diver\'s own input and settings, not advice; the dive computer and training govern. '
        + 'Air and nitrox 21-40 % only, no-stop only, at most 40 m and within the MOD at the contingency ppO2; otherwise status `outside_limits` with the level. '
        + 'Rock bottom is always in the answer. Any Diver can be named by `diverId`; only of one the User manages the planning SAC and the last Dive are read.',
      body: GasPlanBody, response: { 200: GasPlanView, 400: Problem, 404: Problem },
    },
  }, async (request) => deps.planning.gasPlan(userOf(request).id, request.body));
};

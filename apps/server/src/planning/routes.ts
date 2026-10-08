// The Tools page's gas numbers and bottom time (ADR 0032, slice 21): computed on request, nothing stored. They are
// limits from the Diver's own input and settings, not advice; clients must show the assumptions (docs/spec/clients.md).
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import type { Db } from '../db/client.js';
import { diverManagement } from '../db/schema.js';
import { Problem, problem } from '../http/problems.js';
import { PLANNING_WATERS, gasNumbers, planBottomTime } from './service.js';

export interface PlanningRouteDeps {
  db: Db;
  auth: Auth;
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
  atDepth: Type.Union([Type.Null(), Type.Object({
    depthM: Type.Number(), ppO2: Type.Number(), bestMixPercent: Type.Integer(), eadM: Type.Number(), endM: Type.Number(),
  })], { description: 'Null without a depth' }),
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
  reserve: Type.Optional(Type.Number({ minimum: 0, maximum: 200, description: 'Bar left in the Cylinder' })),
  gfHigh: Type.Optional(Type.Number({ minimum: 20, maximum: 100 })),
  water: Type.Optional(Water),
  altitude: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
  ppo2Working: Type.Optional(Type.Number({ minimum: 1, maximum: 2 })),
  ppo2Contingency: Type.Optional(Type.Number({ minimum: 1, maximum: 2 })),
  diverId: Type.Optional(Type.String({ format: 'uuid', description: 'Start from this Diver\'s computer GF, SAC and last Dive' })),
  siteId: Type.Optional(Type.String({ format: 'uuid', description: 'Plan at this site: its water type' })),
});

const Used = <T extends Parameters<typeof Type.Union>[0][number]>(value: T) => Type.Object({
  value,
  source: Type.Enum(['request', 'recording', 'recordings', 'site', 'default'], {
    description: 'Where the value came from: the request, the Diver\'s latest Recording with a GF, the median of their Recordings\' SAC, the site, or the stated default',
  }),
});

const BottomTimeView = Type.Object({
  status: Type.Enum(['ok', 'outside_limits']),
  reason: Type.Optional(Type.Enum(['depth', 'mod', 'gas'], { description: 'Why there is no number: deeper than 40 m, beyond the MOD at the contingency ppO2, or a mix other than air and nitrox 21-40 %' })),
  modM: Type.Optional(Type.Union([Type.Null(), Type.Number()])),
  minutes: Type.Optional(Type.Integer({ description: 'Whole minutes from leaving the surface to leaving the depth' })),
  binding: Type.Optional(Type.Array(Type.Enum(['ndl', 'oxygen', 'gas']), { description: 'The limits that decide; several when they bind together' })),
  limits: Type.Optional(Type.Object({
    ndl: Type.Union([Type.Null(), Type.Number()], { description: 'Minutes; null when the depth does not limit' }),
    oxygen: Type.Union([Type.Null(), Type.Number()]),
    gas: Type.Union([Type.Null(), Type.Number()], { description: 'Null without a Cylinder' }),
  })),
  otu: Type.Optional(Type.Number()),
  ppO2AtDepth: Type.Optional(Type.Number()),
  ppO2AboveWorking: Type.Optional(Type.Boolean()),
  used: Type.Object({
    gfHigh: Used(Type.Number()), sacLpm: Used(Type.Number()), water: Used(Water),
    altitudeM: Used(Type.Number()), reserveBar: Used(Type.Number()),
  }),
  gas: Type.Object({ o2: Type.Number(), he: Type.Number() }),
  depthM: Type.Number(),
  recentDiveEndedAt: Type.Union([Type.Null(), Type.String()], { description: 'When the Diver\'s Dive within the last 48 hours ended; the real limit is then shorter than shown' }),
});

export const planningRoutes: FastifyPluginAsyncTypebox<PlanningRouteDeps> = async (app, deps) => {
  const { db } = deps;
  app.addHook('onRequest', requireUser(deps.auth));

  app.get('/tools/gas', {
    schema: {
      summary: 'MOD and gas numbers for a mix (ADR 0032): a limit from the inputs, not advice',
      querystring: GasQuery, response: { 200: GasView, 400: Problem },
    },
  }, async (request, reply) => {
    const answer = gasNumbers(request.query);
    return answer.ok ? answer.value : reply.code(400).send(problem(answer.code));
  });

  app.get('/tools/bottom-time', {
    schema: {
      summary: 'Bottom time for a planned dive: the shortest of the no-decompression, oxygen and gas limits, and which binds (ADR 0032)',
      description: 'An estimate from the Diver\'s own input and settings, not advice; the dive computer and training govern. '
        + 'Air and nitrox 21-40 % only, no-stop only, at most 40 m; otherwise status `outside_limits`.',
      querystring: BottomTimeQuery, response: { 200: BottomTimeView, 400: Problem, 404: Problem },
    },
  }, async (request, reply) => {
    const managed = (await db.select({ id: diverManagement.diverId }).from(diverManagement)
      .where(eq(diverManagement.userId, request.user!.id))).map((r) => r.id);
    const answer = await planBottomTime(db, managed, request.query);
    if (answer.ok) return answer.value;
    return reply.code(answer.code === 'diver_not_found' || answer.code === 'site_not_found' ? 404 : 400).send(problem(answer.code));
  });
};

// The dive assessment over the API (ADR 0036): a Dive's findings with their evidence and sources, the computer's own
// events, putting a finding aside on a Dive and a rule aside for a Diver.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireUser } from '../auth/fastify.js';
import { Problem, problem } from '../http/problems.js';
import { COMPUTER_EVENTS } from '../vocabulary.js';
import { AssessmentError, type AssessmentService, type AssessmentView } from './assessment-service.js';
import { EVIDENCE, RULES, RULE_IDS, SEVERITIES, SOURCES } from './rules.js';

export interface AssessmentRouteDeps {
  auth: Auth;
  assessments: AssessmentService;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);
const Rule = Type.Enum([...RULE_IDS], { description: 'Which check found it; clients have a title and texts per rule (docs/spec/clients.md)' });

const FindingView = Type.Object({
  rule: Rule,
  severity: Type.Enum([...SEVERITIES], { description: 'info: good to know; note: differs from guidance; caution: differs clearly. Never a verdict on the dive' }),
  startSeconds: Nullable(Type.Number({ description: 'The stretch of the Primary recording\'s profile, from its start; null for a finding about the dive as a whole' })),
  endSeconds: Nullable(Type.Number()),
  values: Type.Record(Type.String(), Type.Union([Type.Number(), Type.String(), Type.Boolean(), Type.Null()]), {
    description: 'What was measured and the threshold it is held against, in metres, minutes (m_min: m/min), seconds, bar, percent; clients render the text from them',
  }),
  evidence: Type.Array(Type.Enum([...EVIDENCE]), { description: 'How strong the evidence behind the rule is' }),
  sources: Type.Array(Type.Object({ title: Type.String(), url: Type.String() }), { description: 'Where the guidance comes from' }),
  dismissed: Type.Boolean({ description: 'The User put it aside on this Dive' }),
  muted: Type.Boolean({ description: 'The User put this rule aside for the Dive\'s Diver' }),
});

const AssessmentViewSchema = Type.Object({
  engineVersion: Type.Integer({ description: 'The version of the rules the findings were computed with' }),
  current: Type.Boolean({ description: 'False while the Dive waits to be assessed with the current rules (after an update)' }),
  applies: Type.Boolean({ description: 'False for dives the rules don\'t cover (apnea, rebreathers): no findings' }),
  recordingId: Nullable(Type.String({ description: 'The Recording whose profile the findings\' stretches refer to (the Primary recording)' })),
  sampleIntervalSeconds: Nullable(Type.Number({ description: 'Typical time between depth samples; at 5 s and more, short bursts can be missing' })),
  ascentBands: Type.Array(Type.Tuple([Type.Number(), Type.Number(), Type.Integer({ minimum: 1, maximum: 3 })]), {
    description: 'Stretches of the ascent [start s, end s, band]: 1 above 4, 2 above 9, 3 above 18 m/min, for colouring the profile',
  }),
  findings: Type.Array(FindingView, { description: 'In the order of the dive; at most one per rule. There is no score' }),
  noFly: Nullable(Type.Object({
    hours: Type.Integer({ description: '12 after a single dive without stops, 18 after several dives or days of diving, 24 after decompression (DAN: "substantially longer than 18")' }),
    reason: Type.Enum(['single', 'several', 'decompression']),
    until: Type.String({ format: 'date-time', description: 'From when the guideline is met' }),
    source: Type.Object({ title: Type.String(), url: Type.String() }),
  }, { description: 'DAN\'s no-fly time, on the last dive of a diving day; null on the others. Information beside the findings, not one of them' })),
  computerEvents: Type.Array(Type.Object({
    atSeconds: Type.Integer(),
    event: Type.Enum([...COMPUTER_EVENTS], { description: 'What the dive computer itself noted; shown beside the findings, never merged' }),
  })),
});

const toView = (a: AssessmentView): Static<typeof AssessmentViewSchema> => ({
  engineVersion: a.engineVersion, current: a.current, applies: a.applies, recordingId: a.recordingId, sampleIntervalSeconds: a.sampleIntervalS,
  ascentBands: a.ascentBands,
  findings: a.findings.map((f) => ({
    rule: f.rule, severity: f.severity, startSeconds: f.startS, endSeconds: f.endS, values: f.values,
    evidence: [...RULES[f.rule].evidence], sources: RULES[f.rule].sources.map((s) => SOURCES[s]), dismissed: f.dismissed, muted: f.muted,
  })),
  noFly: a.noFly && { ...a.noFly, source: SOURCES.dan_flying },
  computerEvents: a.computerEvents.map((e) => ({ atSeconds: e.atS, event: e.event })),
});

export const assessmentRoutes: FastifyPluginAsyncTypebox<AssessmentRouteDeps> = async (app, { auth, assessments }) => {
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AssessmentError) return reply.code(404).send(problem(error.code));
    throw error;
  });

  app.get('/dives/:id/assessment', {
    schema: {
      summary: 'A Dive\'s assessment: findings from fixed rules with their values, evidence and sources; the computer\'s own events',
      description: 'Not medical advice and not a score: clients show the fixed note with it and word findings as facts (docs/spec/clients.md).',
      params: IdParams, response: { 200: AssessmentViewSchema, 404: Problem },
    },
  }, async (request) => toView(await assessments.of(request.user!.id, request.params.id)));

  app.put('/dives/:id/findings/:rule/dismissal', {
    schema: {
      summary: 'Put a finding aside on this Dive, or bring it back; what was computed stays',
      params: Type.Object({ id: Type.String({ format: 'uuid' }), rule: Rule }),
      body: Type.Object({ dismissed: Type.Boolean() }, { additionalProperties: false }),
      response: { 200: AssessmentViewSchema, 404: Problem },
    },
  }, async (request) => {
    await assessments.dismiss(request.user!.id, request.params.id, request.params.rule, request.body.dismissed);
    return toView(await assessments.of(request.user!.id, request.params.id));
  });

  app.put('/divers/:id/muted-rules/:rule', {
    schema: {
      summary: 'Hide a rule\'s findings on every Dive of a Diver the User keeps, or show them again',
      params: Type.Object({ id: Type.String({ format: 'uuid' }), rule: Rule }),
      body: Type.Object({ muted: Type.Boolean() }, { additionalProperties: false }),
      response: { 204: Type.Null(), 404: Problem },
    },
  }, async (request, reply) => {
    await assessments.mute(request.user!.id, request.params.id, request.params.rule, request.body.muted);
    return reply.code(204).send(null);
  });
};

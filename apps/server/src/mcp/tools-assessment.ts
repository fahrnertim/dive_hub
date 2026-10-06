// The MCP tool for a Dive's assessment (ADR 0036): the stored findings in sentences, each with its guidance, evidence
// and sources, and the fixed note in every result, so a model gets the caveats with the numbers (ADR 0035).
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Type } from 'typebox';
import { read } from '../assessment/assessment-service.js';
import { EVIDENCE, RULES, RULE_IDS, SEVERITIES, SOURCES } from '../assessment/rules.js';
import { ASSESSMENT_NOTE, FINDING_TEXT, NO_FLY_TEXT } from '../assessment/texts.js';
import { dive } from '../db/schema.js';
import { COMPUTER_EVENTS } from '../vocabulary.js';
import { Id, Nullable, ToolError, defineTool, round } from './tool.js';

const minute = (seconds: number | null) => (seconds === null ? null : round(seconds / 60, 1));

export const getDiveAssessment = defineTool({
  name: 'logbook_get_dive_assessment',
  title: 'Get a Dive\'s assessment',
  description: `Returns what Dive Hub's dive assessment found on one of the user's Dives: findings from fixed rules that compare the logged profile with published guidance (ascent rate, the last metres, the safety stop, the no-decompression limit, ceilings, oxygen, sawtooth profiles) and the dive with the Diver's dives around it (reverse profiles, short surface intervals, many dives a day, deep days in a row). It also gives DAN's no-fly time after the last dive of a diving day. Use it when the user asks how a dive went or what they could improve; get the dive_id from logbook_search_dives.

Returns { dive_id, assessed, covered, findings: [{ rule, severity, start_min, end_min, summary, guidance, recommendation, evidence, sources: [{ title, url }], values, dismissed, muted }], no_fly: { hours, until, summary, guidance, source } | null, computer_events: [{ at_min, event }], note }. severity is info (good to know), note (differs from guidance) or caution (differs clearly). An empty findings list means the rules found nothing to remark, not that the dive was safe. computer_events are what the dive computer itself noted, separate from the findings.

There is no score, and you must not make one up or call a dive safe or unsafe. State findings as facts with their guidance and source, without blame, and pass on the note: this is not medical advice, and with symptoms after a dive the user should call DAN or the emergency services. dismissed and muted findings are ones the user put aside: mention them only if asked.

Error "dive not found": the id is wrong, the Dive was deleted, or it is not the user's; search again with logbook_search_dives.`,
  scope: 'logbook:read',
  input: Type.Object({ dive_id: Id('The Dive\'s id, from logbook_search_dives') }, { additionalProperties: false }),
  output: () => Type.Object({
    dive_id: Type.String(),
    assessed: Type.Boolean({ description: 'false: the Dive waits to be assessed with the current rules; ask again later' }),
    covered: Type.Boolean({ description: 'false: the rules don\'t cover this kind of dive (apnea, rebreather), so there are no findings' }),
    findings: Type.Array(Type.Object({
      rule: Type.Enum([...RULE_IDS]),
      severity: Type.Enum([...SEVERITIES]),
      start_min: Nullable(Type.Number({ description: 'Where on the profile, minutes into the dive; null for a finding about the dive as a whole' })),
      end_min: Nullable(Type.Number()),
      summary: Type.String({ description: 'What was measured' }),
      guidance: Type.String({ description: 'The guidance it is held against, and how well founded it is' }),
      recommendation: Type.String(),
      evidence: Type.Array(Type.Enum([...EVIDENCE]), { description: 'The kind of evidence behind the rule' }),
      sources: Type.Array(Type.Object({ title: Type.String(), url: Type.String() })),
      values: Type.Record(Type.String(), Type.Union([Type.Number(), Type.String(), Type.Boolean(), Type.Null()]), { description: 'The measured values and thresholds: metres, seconds, m/min, bar, percent' }),
      dismissed: Type.Boolean({ description: 'The user put this finding aside on this Dive' }),
      muted: Type.Boolean({ description: 'The user put this rule aside for the Diver' }),
    })),
    no_fly: Nullable(Type.Object({
      hours: Type.Integer(),
      until: Type.String({ description: 'UTC time from which the guideline is met' }),
      summary: Type.String(),
      guidance: Type.String(),
      source: Type.Object({ title: Type.String(), url: Type.String() }),
    }, { description: 'DAN\'s no-fly time after this dive, when it is the last dive of its day; information, not a finding' })),
    computer_events: Type.Array(Type.Object({ at_min: Type.Number(), event: Type.Enum([...COMPUTER_EVENTS]) }), {
      description: 'What the dive computer itself noted during the dive',
    }),
    note: Type.String({ description: 'Always pass this on with the findings' }),
  }),
  async run(ctx, a) {
    const [d] = ctx.diverIds.length === 0 ? [] : await ctx.tx.select({ id: dive.id, diverId: dive.diverId, primaryRecordingId: dive.primaryRecordingId })
      .from(dive).where(and(eq(dive.id, a.dive_id), inArray(dive.diverId, ctx.diverIds), isNull(dive.deletedAt)));
    if (!d) {
      throw new ToolError('dive_not_found', 'No Dive of the user has this dive_id: it may be mistyped, deleted, or someone else\'s Dive. Find the Dive with logbook_search_dives and use the id it returns.');
    }
    const assessment = await read(ctx.tx, d);
    const output = {
      dive_id: d.id, assessed: assessment.current, covered: assessment.applies,
      findings: assessment.findings.map((f) => ({
        rule: f.rule, severity: f.severity, start_min: minute(f.startS), end_min: minute(f.endS),
        summary: FINDING_TEXT[f.rule].summary(f.values), guidance: FINDING_TEXT[f.rule].guidance, recommendation: FINDING_TEXT[f.rule].recommendation,
        evidence: [...RULES[f.rule].evidence], sources: RULES[f.rule].sources.map((s) => ({ ...SOURCES[s] })), values: f.values,
        dismissed: f.dismissed, muted: f.muted,
      })),
      no_fly: assessment.noFly && {
        hours: assessment.noFly.hours, until: assessment.noFly.until, summary: NO_FLY_TEXT.summary(assessment.noFly), guidance: NO_FLY_TEXT.guidance,
        source: { ...SOURCES.dan_flying },
      },
      computer_events: assessment.computerEvents.map((e) => ({ at_min: round(e.atS / 60, 1)!, event: e.event })),
      note: ASSESSMENT_NOTE,
    };
    return { output, rows: output.findings.length };
  },
});

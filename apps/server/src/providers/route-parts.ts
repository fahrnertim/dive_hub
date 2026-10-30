// What the Provider route plugins share: the Provider params, the schemas several of them use, and how a refusal about a
// Provider is answered.
import type { FastifyReply } from 'fastify';
import { Type } from 'typebox';
import { type ErrorAnswer, Problem, problem, PROBLEM_CODES, providerProblem } from '../http/problems.js';
import { UnmetView } from './unmet-view.js';
import { ProviderServiceError, type ProviderRefusal } from './registry.js';

export const Code = Type.Enum(PROBLEM_CODES);

// A string, not an enum: clients take the Providers from GET /api/providers, and the registry refuses others.
export const ProviderParam = Type.String({ pattern: '^[a-z][a-z0-9_]*$', description: 'A Provider\'s id (GET /api/providers); others answer provider_unsupported' });
export const DiveProviderParams = Type.Object({ id: Type.String({ format: 'uuid' }), provider: ProviderParam });

export const PROVIDER_STATUS: Record<ProviderRefusal, number> = {
  dive_not_found: 404, diver_not_found: 404, connection_not_found: 404,
  invalid_input: 400, encryption_key_missing: 400, provider_wrong_credentials: 400, provider_unsupported: 400, fetch_interval_too_short: 400,
  provider_already_connected: 409, provider_account_taken: 409, provider_other_account: 409, provider_not_connected: 409,
  provider_sign_in_needed: 409, provider_requirements_unmet: 409, provider_not_sent: 409, provider_dive_gone: 409, provider_busy: 409,
  push_run_active: 409, push_run_nothing_to_send: 409, push_run_not_found: 404, push_run_not_active: 409, push_run_going: 409, push_run_not_stopped: 409, waiting_push_not_found: 404,
  provider_number_taken: 409, provider_numbers_off: 409, provider_number_nothing_to_set: 409,
  site_not_found: 404, external_id_taken: 409, provider_site_unknown: 422, provider_buddy_not_found: 404,
  provider_unavailable: 502, provider_refused: 502, provider_not_stored: 502, provider_import_off: 409, provider_account_held: 409,
};
/** A refusal about a Provider; with provider_requirements_unmet, what is unmet. */
const ProviderProblem = Type.Object({
  ...Problem.properties,
  unmet: Type.Optional(Type.Array(UnmetView, { description: 'With provider_requirements_unmet: every requirement unmet, blocking ones among them' })),
});
export const Choice = Type.Enum(['recordings', 'entries'], {
  description: 'recordings: its dives become Recordings, like a file\'s; entries: only logbook entries that fill Dives here',
});
/** The choice per dive computer, as the preview and PATCH /api/connections/{id} take it. */
export const ComputerChoices = Type.Array(Type.Object({ key: Type.String({ maxLength: 200 }), choice: Choice }, { additionalProperties: false }), {
  maxItems: 100, description: 'Per dive computer found at the Provider (its key from the preview): how its dives are used',
});

/** What a fresh, complete read of the logbook found gone; also part of the import preview. */
export const GoneSummary = Type.Object({
  empty: Type.Boolean({ description: 'The Provider\'s logbook came back empty: nothing was compared, and an empty logbook is never a finding' }),
  compared: Type.Integer({ description: 'Dives compared: live, and sent or linked through this Connection' }),
  gone: Type.Integer({ description: 'Dives whose remote dive is not in the logbook and wait for the User\'s choice (GET /api/gone-dives)' }),
  warning: Type.Boolean({ description: 'More than half of at least five compared Dives are gone: say so, and to look at the Provider\'s app first' }),
}, { description: 'Dives gone at the Provider (ADR 0051), found by this fresh, complete read; stored, nothing else changes' });

/** The refusals a Provider route answers with. */
export const errors = { 400: Problem, 404: Problem, 409: ProviderProblem, 422: Problem, 502: Problem };

/** Answers a refusal about a Provider: its status, its code and the Provider named, with `extra` (such as the copies). */
export function replyProviderError(error: ProviderServiceError, reply: FastifyReply, extra: object = {}) {
  return reply.code(PROVIDER_STATUS[error.code]).send({ ...(error.provider ? providerProblem(error.code, error.provider) : problem(error.code)), ...error.extra, ...extra });
}
/** replyProviderError as a route plugin's answer (answerErrors). */
export const answerProviderError: ErrorAnswer = (error, reply) => (error instanceof ProviderServiceError ? replyProviderError(error, reply) : undefined);

/** Both, for another module's route plugin: app.ts passes them in, so that module imports only types from here (ADR 0053). */
export const providerAnswers = { reply: replyProviderError, answer: answerProviderError };
export type ProviderAnswers = typeof providerAnswers;

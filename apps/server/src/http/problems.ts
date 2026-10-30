// Error responses (ADR 0014): every refusal carries a stable `code`, which clients translate,
// and an English `error` text for logs, scripts and anything without a translation.
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { type Static, type TSchema, Type } from 'typebox';
import { Nullable, oneOf } from './schemas.js';

export const PROBLEMS = {
  sign_in_required: 'Sign in required',
  admins_only: 'Admins only',
  not_found: 'Not found',
  invalid_input: 'The request is invalid',
  internal_error: 'Something went wrong on the server',
  upload_missing: 'Expected a file in the "file" field',
  upload_too_large: 'The file is too large',
  setup_done: 'Setup is already done',
  setup_token_invalid: 'Invalid or expired setup token',
  invitation_invalid: 'This invitation is invalid, used or expired',
  invitation_not_found: 'No open invitation with this id',
  email_taken: 'A User with this e-mail already exists',
  reset_link_invalid: 'This link is invalid, used or expired',
  user_not_found: 'No such User',
  user_disabled: 'Enable the User first',
  last_admin: 'This is the only admin; make someone else admin first',
  not_yourself: "You can't do this to yourself; ask another admin",
  confirmation_mismatch: "The confirmation does not match the User's e-mail",
  session_not_found: 'No such session',
  import_not_found: 'Import not found',
  import_not_waiting: 'This Import does not wait for a choice of kinds, or it found none of the kinds named',
  dive_not_found: 'Dive not found',
  cylinder_invalid: 'A cylinder’s values don’t fit: an end pressure above the start, a gas over 100 %, or one pressure series on two cylinders',
  cylinder_series_not_found: 'The dive’s recordings have no such tank pressure series',
  weighting_feedback_invalid: 'Weighting that felt right has no amount; an amount says by how much it was too heavy or too light',
  suit_invalid: 'The suit’s values don’t fit: a thickness is for a wetsuit or a semidry suit, an undergarment for a drysuit',
  dive_changed: 'The dive was changed meanwhile; reload it and apply your changes again',
  dive_values_inconsistent: 'The average depth is deeper than the max depth',
  recording_not_on_dive: 'This recording does not belong to the dive',
  last_recording: 'This is the dive\'s only recording; it can\'t be split off',
  diver_not_found: 'Diver not found',
  gas_not_breathable: 'A mix with under 16 % oxygen cannot be breathed at the surface',
  body_weight_not_found: 'The Diver has no body weight on that date',
  certification_not_found: 'The Diver has no such certification',
  certification_changed: 'The certification was changed by someone else; load it again',
  certification_read_only: 'An imported certification takes only notes; the agency\'s record is not edited here',
  certification_image_not_found: 'The certification has no picture (yet)',
  own_diver: 'Your own Diver can\'t be deleted',
  diver_not_empty: 'This Diver still has dives or devices, or is on a dive',
  diver_in_use: 'This diver is on a dive; take them off it first',
  diver_not_deletable: 'Only whoever added this diver, or an admin, can delete them',
  diver_not_editable: 'Only the Users who keep this Diver\'s logbook can change it',
  diver_external_id_taken: 'Another diver already has this account',
  diver_external_id_connected: 'A connection uses this account; disconnect it first',
  participant_invalid: 'A diver is on the list twice, or is the dive\'s own diver',
  merge_not_possible: 'Only two different dives of one diver can be merged',
  check_not_found: 'These two dives are not at the same time (anymore)',
  device_not_found: 'Device not found',
  candidate_not_found: 'Nothing to decide here (anymore)',
  candidate_resolved: 'This was already decided',
  not_a_candidate: 'That dive is not one of the candidates',
  recording_not_found: 'Recording not found',
  site_not_found: 'Dive site not found',
  site_changed: 'The dive site was changed meanwhile; reload it and apply your changes again',
  site_in_use: 'Dives are at this site; it can only be deleted while none is',
  site_not_deletable: 'Only whoever created the dive site, or an admin, can delete it',
  external_id_taken: 'Another dive site already has this ID',
  site_source_not_typed: 'IDs of this source come only from a site import',
  site_merge_self: 'A dive site can\'t be merged into itself',
  site_offer_not_found: 'This dive site has no data on offer from that source (anymore)',
  centre_not_found: 'Dive centre not found',
  centre_changed: 'The dive centre was renamed meanwhile; reload it and apply your change again',
  centre_not_deletable: 'Only whoever created the dive centre, or an admin, can delete it',
  centre_external_id_taken: 'Another dive centre already has this number',
  code_not_recognised: 'This is not a verification code Dive Hub knows',
  code_not_a_person: 'This is a dive centre\'s code, not a buddy\'s or a professional\'s',
  diver_choice_needed: 'No diver has this account yet: choose the diver the code is for, or ask for a new one (create)',
  diver_has_other_account: 'This diver has another account at the service; the code is someone else\'s',
  odbl_not_confirmed: 'Importing from OpenStreetMap needs the ODbL explanation confirmed (confirmOdbl)',
  ssi_not_confirmed: 'Importing from SSI needs the explanation about its missing licence confirmed (confirmSsi)',
  site_import_running: 'A site import is already running; wait until it is done',
  site_import_not_found: 'Site import not found',
  source_unavailable: 'The source did not answer, or answered with something else than data; try again later',
  source_rate_limited: 'The source asked us to slow down; try again later',
  site_import_interrupted: 'The server stopped while the import was running',
  connection_not_found: 'No such connection',
  encryption_key_missing: 'Keeping the password needs DIVEHUB_ENCRYPTION_KEY on the server; choose not to store it instead',
  provider_already_connected: 'This Diver is already connected to this service; disconnect first to connect another account',
  provider_account_taken: 'This account at the service is already connected to another Diver',
  provider_other_account: 'This sign-in belongs to another account at the service; disconnect and connect that one instead',
  provider_wrong_credentials: 'The service did not accept this sign-in',
  provider_not_connected: "This dive's Diver is not connected to this service",
  provider_sign_in_needed: 'The service wants you to sign in again',
  provider_unavailable: 'The service did not answer, or answered with something unexpected; try again later',
  provider_refused: 'The service did not save the dive',
  provider_not_stored: 'The service answered that the dive was saved, but it is not there; the service may no longer take dives from Dive Hub',
  provider_requirements_unmet: 'The service needs something first; see unmet',
  provider_not_sent: 'This dive is not at this service',
  provider_dive_gone: 'The dive is no longer at the service; it was deleted there',
  provider_busy: 'This dive is being sent to this service right now',
  provider_number_taken: 'Another dive at this service has that number; change the number of that dive first',
  provider_numbers_off: 'Numbering dives at this service as in Dive Hub is off for this connection',
  provider_number_nothing_to_set: 'There is no number to set: the dive has none, or the service has it already',
  provider_unsupported: 'This service does not offer that',
  fetch_interval_too_short: 'This service does not allow fetching that often; choose a longer interval',
  push_run_active: 'A run that sends dives to this service is already going; see runId',
  push_run_nothing_to_send: 'There is no dive to send with these choices',
  push_run_not_found: 'No such run',
  push_run_not_active: 'This run is not going anymore',
  push_run_going: 'This run is still going; only an ended run can be dismissed',
  push_run_not_stopped: 'This run did not stop; only a stopped run can be continued',
  waiting_push_not_found: 'This dive does not wait to go to this service, or it is not stopped or held',
  provider_account_held: 'An external diver here has this account; send claim to make them your diver (they merge into it)',
  diver_not_external: 'Only an external diver (one no User keeps) can be merged into another',
  provider_import_off: 'Importing dives from this account is off; choose what the import may do first',
  finding_not_found: 'This dive has no such finding (anymore)',
  ai_access_not_found: 'No such AI access',
  ai_access_off: 'AI access is switched off on this instance; an admin can switch it on',
  provider_site_unknown: 'The service has no site with this ID',
  provider_buddy_not_found: 'The service\'s list no longer has this entry; read the list again',
  provider_site_data_not_confirmed: 'Allowing dive sites from this service needs the explanation about its missing licence confirmed (confirm)',
} as const;

export type ProblemCode = keyof typeof PROBLEMS;
export const PROBLEM_CODES = Object.keys(PROBLEMS) as ProblemCode[];

/** A problem code kept in a text column, read back as one (it throws on a value that isn't). */
export const storedProblemCode = (code: string | null): ProblemCode | null => (code === null ? null : oneOf(PROBLEM_CODES, code));

/** Every refusal's shape, registered once (app.addSchema) so the OpenAPI document names it once (ADR 0014). */
export const ProblemSchema = Type.Object({
  code: Type.Enum(PROBLEM_CODES, {
    description: 'Stable, machine-readable reason; clients translate it',
  }),
  error: Type.String({ description: 'English description, for logs and scripts' }),
  provider: Type.Optional(Type.String({ description: 'The Provider a provider_* code is about (ADR 0027)' })),
  providerName: Type.Optional(Type.String({ description: 'Its name, to put into the translated text' })),
  diver: Type.Optional(Type.Object({
    id: Type.String(), name: Type.String(),
    dives: Type.Optional(Type.Integer({ description: 'With provider_account_held: the Dives it is a Participant on' })),
  }, {
    description: 'The Diver that already has the account: with diver_external_id_taken, to offer it instead (ADR 0028); '
      + 'with provider_account_held, the external Diver here; connect again with claim to make it yours',
  })),
  centre: Type.Optional(Type.Object({ id: Type.String(), name: Type.String() }, {
    description: 'With centre_external_id_taken: the Dive centre that already has the number, to open it instead (ADR 0043)',
  })),
  existing: Type.Optional(Type.Object({
    remoteId: Type.String(), number: Nullable(Type.Integer()), startsAt: Nullable(Type.String()),
    maxDepthM: Nullable(Type.Number()), durationMinutes: Nullable(Type.Number()),
  }, { description: 'With provider_number_taken: the dive at the Provider that has the number (ADR 0048)' })),
  diveId: Type.Optional(Nullable(Type.String({ description: 'With provider_number_taken: the Dive here that dive is, if Dive Hub knows it' }))),
  runId: Type.Optional(Type.String({ description: 'With push_run_active: the run that is going (ADR 0047)' })),
}, { $id: 'Problem', description: 'A refusal. Besides code and error, it carries the extras its code names; a module adds only extras of its own types' });

/** A reference to a schema registered with app.addSchema under its $id, typed as it: the OpenAPI document names it once. */
export function refTo<T extends TSchema>(schema: T) {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== 'string') throw new Error('refTo needs a schema with an $id');
  return Type.Unsafe<Static<T>>(Type.Ref(id));
}

/** What a route's response names for a refusal: a reference to ProblemSchema. */
export const Problem = refTo(ProblemSchema);

/** A response body for `code`; `detail` replaces the default English text where it says more. */
export const problem = (code: ProblemCode, detail?: string) => ({ code, error: detail ?? PROBLEMS[code] });

/** A problem about a Provider: names it, so clients can say "SSI didn't answer" (ADR 0027). */
export const providerProblem = (code: ProblemCode, provider: { id: string; name: string }) =>
  ({ ...problem(code), provider: provider.id, providerName: provider.name });

/** How a route plugin answers one kind of error: it replies to an error it knows and answers undefined to any other. */
export type ErrorAnswer = (error: unknown, reply: FastifyReply) => FastifyReply | undefined;

/**
 * Answers a module's error by its code: the status from the module's STATUS, which the code union keeps exhaustive,
 * and the problem with the extras `extras` names (such as the Diver that has an account).
 */
export const answers = <E extends Error & { code: ProblemCode }>(
  type: abstract new (...args: never[]) => E,
  status: Record<E['code'], number>,
  extras: (error: E) => object | undefined = () => undefined,
): ErrorAnswer => (error, reply) => {
  if (!(error instanceof type)) return undefined;
  const code: number = status[error.code as E['code']];
  return reply.code(code).send({ ...problem(error.code), ...extras(error) });
};

/** A route plugin's error handler: the first answer that knows the error replies; any other error goes on to useProblemErrors. */
export const answerErrors = (...answered: ErrorAnswer[]) => (error: Error, _request: unknown, reply: FastifyReply) => {
  for (const answer of answered) {
    const sent = answer(error, reply);
    if (sent) return sent;
  }
  throw error;
};

/**
 * Turns Fastify's own errors into problems: validation failures keep their (English) explanation,
 * other client errors keep their status, and server errors never show internals.
 */
export function useProblemErrors(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) return reply.code(400).send(problem('invalid_input', error.message));
    const status = error.statusCode ?? 500;
    if (status === 413) return reply.code(413).send(problem('upload_too_large'));
    if (status >= 400 && status < 500) return reply.code(status).send(problem(status === 404 ? 'not_found' : 'invalid_input', error.message));
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send(problem('internal_error'));
  });
}

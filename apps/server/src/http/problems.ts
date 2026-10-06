// Error responses (ADR 0014): every refusal carries a stable `code`, which clients translate,
// and an English `error` text for logs, scripts and anything without a translation.
import type { FastifyError, FastifyInstance } from 'fastify';
import { Type } from 'typebox';

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
  dive_not_found: 'Dive not found',
  dive_changed: 'The dive was changed meanwhile; reload it and apply your changes again',
  dive_values_inconsistent: 'The average depth is deeper than the max depth',
  recording_not_on_dive: 'This recording does not belong to the dive',
  last_recording: 'This is the dive\'s only recording; it can\'t be split off',
  diver_not_found: 'Diver not found',
  own_diver: 'Your own Diver can\'t be deleted',
  diver_not_empty: 'This Diver still has dives or devices, or is on a dive',
  diver_in_use: 'This diver is on a dive; take them off it first',
  diver_not_deletable: 'Only whoever added this diver, or an admin, can delete them',
  diver_not_editable: 'Only the Users who keep this Diver\'s logbook can change it',
  diver_external_id_taken: 'Another diver already has this account',
  diver_external_id_connected: 'A connection uses this account; disconnect it first',
  participant_invalid: 'A diver is on the list twice, or is the dive\'s own diver',
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
  provider_requirements_unmet: 'The service needs something first; see unmet',
  provider_not_sent: 'This dive is not at this service',
  provider_dive_gone: 'The dive is no longer at the service; it was deleted there',
  provider_busy: 'This dive is being sent to this service right now',
  provider_unsupported: 'This service does not offer that',
  provider_account_held: 'An external diver here has this account; send claim to make them your diver (they merge into it)',
  diver_not_external: 'Only an external diver (one no User keeps) can be merged into another',
  provider_import_off: 'Importing dives from this account is off; choose what the import may do first',
  ai_access_not_found: 'No such AI access',
  ai_access_off: 'AI access is switched off on this instance; an admin can switch it on',
  provider_site_data_not_confirmed: 'Allowing dive sites from this service needs the explanation about its missing licence confirmed (confirm)',
} as const;

export type ProblemCode = keyof typeof PROBLEMS;

export const Problem = Type.Object({
  code: Type.Enum(Object.keys(PROBLEMS) as ProblemCode[], {
    description: 'Stable, machine-readable reason; clients translate it',
  }),
  error: Type.String({ description: 'English description, for logs and scripts' }),
  provider: Type.Optional(Type.String({ description: 'The Provider a provider_* code is about (ADR 0027)' })),
  providerName: Type.Optional(Type.String({ description: 'Its name, to put into the translated text' })),
});

/** A response body for `code`; `detail` replaces the default English text where it says more. */
export const problem = (code: ProblemCode, detail?: string) => ({ code, error: detail ?? PROBLEMS[code] });

/** A problem about a Provider: names it, so clients can say "SSI didn't answer" (ADR 0027). */
export const providerProblem = (code: ProblemCode, provider: { id: string; name: string }) =>
  ({ ...problem(code), provider: provider.id, providerName: provider.name });

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

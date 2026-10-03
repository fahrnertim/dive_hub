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
  recording_not_found: 'Recording not found',
} as const;

export type ProblemCode = keyof typeof PROBLEMS;

export const Problem = Type.Object({
  code: Type.Enum(Object.keys(PROBLEMS) as ProblemCode[], {
    description: 'Stable, machine-readable reason; clients translate it',
  }),
  error: Type.String({ description: 'English description, for logs and scripts' }),
});

/** A response body for `code`; `detail` replaces the default English text where it says more. */
export const problem = (code: ProblemCode, detail?: string) => ({ code, error: detail ?? PROBLEMS[code] });

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

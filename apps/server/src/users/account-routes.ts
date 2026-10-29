// A User's own account: password reset links, signed-in sessions (ADR 0013).
// Changing one's own password is Better Auth's POST /api/auth/change-password.
import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { authHeaders, forwardCookies, requireUser, userOf } from '../auth/fastify.js';
import { problem } from '../http/problems.js';
import type { PasswordResets } from './password-resets.js';
import type { SessionService } from './session-service.js';
import { Password, Problem, Token, UserView, toUserView } from './views.js';
import { DateTime, IdParams } from '../http/schemas.js';

export interface AccountRouteDeps {
  auth: Auth;
  passwordResets: PasswordResets;
  sessions: SessionService;
}

const SessionView = Type.Object({
  id: Type.String(),
  createdAt: DateTime,
  lastActiveAt: Type.Union([DateTime, Type.Null()], { description: 'Last time the session was refreshed (about daily)' }),
  expiresAt: DateTime,
  ipAddress: Type.Union([Type.String(), Type.Null()]),
  userAgent: Type.Union([Type.String(), Type.Null()]),
  current: Type.Boolean({ description: 'The session this request came with' }),
});

export const accountRoutes: FastifyPluginAsyncTypebox<AccountRouteDeps> = async (app, { auth, passwordResets, sessions }) => {
  // --- Public: using a password reset link ---------------------------------------------------------

  app.post('/password-resets/lookup', {
    schema: {
      summary: 'Whose password a reset link is for',
      body: Type.Object({ token: Token }),
      response: { 200: Type.Object({ email: Type.String() }), 404: Problem },
    },
  }, async (request, reply) => {
    const found = await passwordResets.find(request.body.token);
    return found ? { email: found.email } : reply.code(404).send(problem('reset_link_invalid'));
  });

  app.post('/password-resets/complete', {
    schema: {
      summary: 'Set a new password with a reset link; signs out everywhere, then signs in here',
      body: Type.Object({ token: Token, password: Password }),
      response: { 200: UserView, 404: Problem },
    },
  }, async (request, reply) => {
    const email = await passwordResets.complete(request.body.token, request.body.password);
    if (!email) return reply.code(404).send(problem('reset_link_invalid'));
    const { headers, response } = await auth.api.signInEmail({
      body: { email, password: request.body.password }, headers: authHeaders(request), returnHeaders: true,
    });
    forwardCookies(headers, reply);
    return toUserView(response.user);
  });

  // --- Signed in: own sessions ---------------------------------------------------------------------

  await app.register(async (scope) => {
    const signedIn = scope.withTypeProvider<TypeBoxTypeProvider>();
    signedIn.addHook('onRequest', requireUser(auth));

    signedIn.get('/me/sessions', {
      schema: { summary: 'Where the signed-in User is signed in', response: { 200: Type.Array(SessionView) } },
    }, async (request) => sessions.list(userOf(request).id, request.sessionId));

    signedIn.delete('/me/sessions/:id', {
      schema: { summary: 'Sign out one session (the current one too)', params: IdParams, response: { 204: Type.Null(), 404: Problem } },
    }, async (request, reply) => {
      const deleted = await sessions.end(userOf(request).id, request.params.id);
      return deleted ? reply.code(204).send(null) : reply.code(404).send(problem('session_not_found'));
    });

    signedIn.delete('/me/sessions', {
      schema: { summary: 'Sign out every other session', response: { 204: Type.Null() } },
    }, async (request, reply) => {
      await sessions.endOthers(userOf(request).id, request.sessionId!);
      return reply.code(204).send(null);
    });
  });
};

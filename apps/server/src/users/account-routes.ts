// A User's own account: password reset links, signed-in sessions (ADR 0013).
// Changing one's own password is Better Auth's POST /api/auth/change-password.
import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { authHeaders, forwardCookies, requireUser } from '../auth/fastify.js';
import type { Db } from '../db/client.js';
import { session } from '../db/schema.js';
import { problem } from '../http/problems.js';
import type { PasswordResets } from './password-resets.js';
import { DateTime, IdParams, Password, Problem, Token, UserView, toUserView } from './views.js';

export interface AccountRouteDeps {
  db: Db;
  auth: Auth;
  passwordResets: PasswordResets;
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

export const accountRoutes: FastifyPluginAsyncTypebox<AccountRouteDeps> = async (app, { db, auth, passwordResets }) => {
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
    const mine = (userId: string) => and(eq(session.userId, userId), gt(session.expiresAt, sql`now()`));

    signedIn.get('/me/sessions', {
      schema: { summary: 'Where the signed-in User is signed in', response: { 200: Type.Array(SessionView) } },
    }, async (request) => {
      const rows = await db.select().from(session).where(mine(request.user!.id)).orderBy(desc(session.updatedAt));
      // Never the token: it would let page scripts read what the HttpOnly cookie hides.
      return rows.map((s) => ({
        id: s.id, createdAt: s.createdAt.toISOString(), lastActiveAt: s.updatedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt.toISOString(), ipAddress: s.ipAddress, userAgent: s.userAgent, current: s.id === request.sessionId,
      }));
    });

    signedIn.delete('/me/sessions/:id', {
      schema: { summary: 'Sign out one session (the current one too)', params: IdParams, response: { 204: Type.Null(), 404: Problem } },
    }, async (request, reply) => {
      const deleted = await db.delete(session)
        .where(and(eq(session.id, request.params.id), eq(session.userId, request.user!.id))).returning({ id: session.id });
      return deleted.length > 0 ? reply.code(204).send(null) : reply.code(404).send(problem('session_not_found'));
    });

    signedIn.delete('/me/sessions', {
      schema: { summary: 'Sign out every other session', response: { 204: Type.Null() } },
    }, async (request, reply) => {
      await db.delete(session).where(and(eq(session.userId, request.user!.id), ne(session.id, request.sessionId!)));
      return reply.code(204).send(null);
    });
  });
};

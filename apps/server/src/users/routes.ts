// Users: who am I, first-admin setup, accepting an invitation (ADR 0011, 0012); admins invite in admin-routes.ts.
import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Type } from 'typebox';
import { APIError } from 'better-auth/api';
import type { Auth } from '../auth/auth.js';
import { authHeaders, forwardCookies, requireUser, userOf } from '../auth/fastify.js';
import type { InvitationService, Role } from './invitation-service.js';
import type { ProfileService } from './profile-service.js';
import type { SetupService } from './setup-service.js';
import { problem } from '../http/problems.js';
import { Email, Password, PreferencesView, Problem, Token, UserView, toUserView } from './views.js';
import { DateTime } from '../http/schemas.js';

export interface UserRouteDeps {
  auth: Auth;
  profiles: ProfileService;
  setup: SetupService;
  invitations: InvitationService;
}

const Name = Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' });

const MeView = Type.Object({
  user: UserView,
  ownDiver: Type.Object({ id: Type.String(), name: Type.String() }),
  preferences: PreferencesView,
});

export const userRoutes: FastifyPluginAsyncTypebox<UserRouteDeps> = async (app, { auth, profiles, setup, invitations }) => {
  /** Creates the User through Better Auth (which hashes the password), then signs them in. */
  async function createAndSignIn(
    request: FastifyRequest, reply: FastifyReply,
    input: { email: string; name: string; password: string; role: Role },
  ) {
    const { user: created } = await auth.api.createUser({ body: input });
    const { headers } = await auth.api.signInEmail({
      body: { email: input.email, password: input.password }, headers: authHeaders(request), returnHeaders: true,
    });
    forwardCookies(headers, reply);
    return created;
  }

  const isEmailTaken = (error: unknown) =>
    error instanceof APIError && error.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL';

  // --- Public: first-admin setup and accepting an invitation -------------------------------------

  app.get('/setup', {
    schema: { summary: 'Whether this instance still needs its first admin', response: { 200: Type.Object({ needed: Type.Boolean() }) } },
  }, async () => ({ needed: await setup.isNeeded() }));

  app.post('/setup', {
    schema: {
      summary: 'Create the first admin with the setup token printed to the server log',
      body: Type.Object({ token: Token, email: Email, name: Name, password: Password }),
      response: { 201: UserView, 403: Problem, 409: Problem },
    },
  }, async (request, reply) => {
    if (!(await setup.isNeeded())) return reply.code(409).send(problem('setup_done'));
    const restore = setup.consume(request.body.token);
    if (!restore) return reply.code(403).send(problem('setup_token_invalid'));
    try {
      const { token: _, ...input } = request.body;
      const created = await createAndSignIn(request, reply, { ...input, role: 'admin' });
      request.log.info({ userId: created.id }, 'first admin created');
      return reply.code(201).send(toUserView(created));
    } catch (error) {
      restore();
      throw error;
    }
  });

  app.post('/invitations/lookup', {
    schema: {
      summary: 'The open invitation behind an invitation token',
      body: Type.Object({ token: Token }),
      response: { 200: Type.Object({ email: Type.String(), expiresAt: DateTime }), 404: Problem },
    },
  }, async (request, reply) => {
    const found = await invitations.find(request.body.token);
    return found
      ? { email: found.email, expiresAt: found.expiresAt.toISOString() }
      : reply.code(404).send(problem('invitation_invalid'));
  });

  app.post('/invitations/accept', {
    schema: {
      summary: 'Accept an invitation: become a User and get signed in',
      body: Type.Object({ token: Token, name: Name, password: Password }),
      response: { 201: UserView, 404: Problem, 409: Problem },
    },
  }, async (request, reply) => {
    const claimed = await invitations.claim(request.body.token);
    if (!claimed) return reply.code(404).send(problem('invitation_invalid'));
    const { email, role } = claimed.invitation;
    try {
      const created = await createAndSignIn(request, reply, { email, role, name: request.body.name, password: request.body.password });
      await claimed.acceptedBy(created.id);
      return reply.code(201).send(toUserView(created));
    } catch (error) {
      await claimed.reopen();
      if (isEmailTaken(error)) return reply.code(409).send(problem('email_taken'));
      throw error;
    }
  });

  // --- Signed in -----------------------------------------------------------------------------------

  await app.register(async (scope) => {
    const signedIn = scope.withTypeProvider<TypeBoxTypeProvider>();
    signedIn.addHook('onRequest', requireUser(auth));

    signedIn.get('/me', {
      schema: { summary: 'The signed-in User and their own Diver', response: { 200: MeView } },
    }, async (request) => {
      const me = userOf(request);
      return { user: toUserView(me), ...(await profiles.read(me.id)) };
    });

    signedIn.patch('/me/preferences', {
      schema: {
        summary: 'Change display settings (language, units); fields left out stay as they are',
        body: Type.Partial(PreferencesView),
        response: { 200: PreferencesView },
      },
    }, async (request) => {
      return profiles.savePreferences(userOf(request).id, request.body);
    });
  });
};

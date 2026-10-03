// Users: who am I, first-admin setup, invitations (ADR 0011, 0012).
import { eq, and } from 'drizzle-orm';
import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import { APIError } from 'better-auth/api';
import type { Auth } from '../auth/auth.js';
import { authHeaders, forwardCookies, requireAdmin, requireUser } from '../auth/fastify.js';
import type { Db } from '../db/client.js';
import { diver, diverManagement } from '../db/schema.js';
import { EmailTakenError, invitationStatus, type InvitationRow, type Invitations, type Role } from './invitations.js';
import type { Setup } from './setup.js';
import { DateTime, IdParams, LinkView, Password, Problem, RoleSchema, Token, UserView, toUserView } from './views.js';

export interface UserRouteDeps {
  db: Db;
  auth: Auth;
  setup: Setup;
  invitations: Invitations;
  baseUrl: string;
}

const Email = Type.String({ format: 'email', maxLength: 254 });
const Name = Type.String({ minLength: 1, maxLength: 100 });

const MeView = Type.Object({ user: UserView, ownDiver: Type.Object({ id: Type.String(), name: Type.String() }) });
const InvitationView = Type.Object({
  id: Type.String(), email: Type.String(), role: RoleSchema, createdAt: DateTime, expiresAt: DateTime,
  status: Type.Union([Type.Literal('pending'), Type.Literal('accepted'), Type.Literal('revoked'), Type.Literal('expired')]),
});
const CreatedInvitationView = Type.Intersect([InvitationView, LinkView]);

const toInvitationView = (i: InvitationRow): Static<typeof InvitationView> => ({
  id: i.id, email: i.email, role: i.role, createdAt: i.createdAt.toISOString(),
  expiresAt: i.expiresAt.toISOString(), status: invitationStatus(i),
});

export const userRoutes: FastifyPluginAsyncTypebox<UserRouteDeps> = async (app, { db, auth, setup, invitations, baseUrl }) => {
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
    if (!(await setup.isNeeded())) return reply.code(409).send({ error: 'Setup is already done' });
    const restore = setup.consume(request.body.token);
    if (!restore) return reply.code(403).send({ error: 'Invalid or expired setup token' });
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
      : reply.code(404).send({ error: 'This invitation is invalid, used or expired' });
  });

  app.post('/invitations/accept', {
    schema: {
      summary: 'Accept an invitation: become a User and get signed in',
      body: Type.Object({ token: Token, name: Name, password: Password }),
      response: { 201: UserView, 404: Problem, 409: Problem },
    },
  }, async (request, reply) => {
    const claimed = await invitations.claim(request.body.token);
    if (!claimed) return reply.code(404).send({ error: 'This invitation is invalid, used or expired' });
    const { email, role } = claimed.invitation;
    try {
      const created = await createAndSignIn(request, reply, { email, role, name: request.body.name, password: request.body.password });
      await claimed.acceptedBy(created.id);
      return reply.code(201).send(toUserView(created));
    } catch (error) {
      await claimed.reopen();
      if (isEmailTaken(error)) return reply.code(409).send({ error: 'A User with this e-mail already exists' });
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
      const me = request.user!;
      const [own] = await db.select({ id: diver.id, name: diver.name }).from(diverManagement)
        .innerJoin(diver, eq(diver.id, diverManagement.diverId))
        .where(and(eq(diverManagement.userId, me.id), eq(diverManagement.isOwn, true)));
      return { user: toUserView(me), ownDiver: own! };
    });

    // --- Admins ----------------------------------------------------------------------------------

    await signedIn.register(async (scope) => {
      const admins = scope.withTypeProvider<TypeBoxTypeProvider>();
      admins.addHook('onRequest', requireAdmin);

      admins.get('/invitations', {
        schema: { summary: 'Invitations, newest first (admins only)', response: { 200: Type.Array(InvitationView) } },
      }, async () => (await invitations.list()).map(toInvitationView));

      admins.post('/invitations', {
        schema: {
          summary: 'Invite a person by e-mail; returns the link to pass on (admins only)',
          body: Type.Object({ email: Email, role: Type.Optional(RoleSchema) }),
          response: { 201: CreatedInvitationView, 409: Problem },
        },
      }, async (request, reply) => {
        try {
          const { invitation, token } = await invitations.create({
            email: request.body.email, role: request.body.role ?? 'user', createdBy: request.user!.id,
          });
          // The token travels in the URL fragment, which browsers never send to the server or in Referer.
          return reply.code(201).send({ ...toInvitationView(invitation), url: `${baseUrl}/#/invite/${token}` });
        } catch (error) {
          if (error instanceof EmailTakenError) return reply.code(409).send({ error: error.message });
          throw error;
        }
      });

      admins.delete('/invitations/:id', {
        schema: { summary: 'Revoke an open invitation (admins only)', params: IdParams, response: { 204: Type.Null(), 404: Problem } },
      }, async (request, reply) =>
        (await invitations.revoke(request.params.id))
          ? reply.code(204).send(null)
          : reply.code(404).send({ error: 'No open invitation with this id' }));
    });
  });
};

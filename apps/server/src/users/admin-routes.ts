// Admins manage Users (ADR 0013): list, role, disable/enable, end sessions, reset link, delete.
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireUser } from '../auth/fastify.js';
import type { Db } from '../db/client.js';
import { user } from '../db/schema.js';
import type { PasswordResets } from './password-resets.js';
import { UserAdminError, type UserAdmin } from './user-admin.js';
import { IdParams, LinkView, Problem, RoleSchema, UserView, toUserView } from './views.js';

export interface AdminRouteDeps {
  db: Db;
  auth: Auth;
  userAdmin: UserAdmin;
  passwordResets: PasswordResets;
  baseUrl: string;
}

const STATUS: Record<UserAdminError['code'], number> = { 'not-found': 404, 'last-admin': 409, self: 409, confirmation: 400 };

export const adminRoutes: FastifyPluginAsyncTypebox<AdminRouteDeps> = async (scope, { db, auth, userAdmin, passwordResets, baseUrl }) => {
  const app = scope.withTypeProvider<TypeBoxTypeProvider>();
  app.addHook('onRequest', requireUser(auth));
  app.addHook('onRequest', requireAdmin);
  // Refusals from the admin service become their status; anything else goes to the default handler.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UserAdminError) return reply.code(STATUS[error.code]).send({ error: error.message });
    throw error;
  });
  const errors = { 400: Problem, 404: Problem, 409: Problem };

  app.get('/users', {
    schema: { summary: 'All Users of this instance (admins only)', response: { 200: Type.Array(UserView) } },
  }, async () => (await db.select().from(user).orderBy(asc(user.createdAt))).map(toUserView));

  app.patch('/users/:id', {
    schema: {
      summary: 'Change a User\'s role; the last enabled admin stays admin (admins only)',
      params: IdParams, body: Type.Object({ role: RoleSchema }), response: { 200: UserView, ...errors },
    },
  }, async (request) => toUserView(await userAdmin.setRole(request.params.id, request.body.role)));

  app.post('/users/:id/disable', {
    schema: {
      summary: 'Block sign-in and end all sessions; data stays (admins only)',
      params: IdParams, response: { 200: UserView, ...errors },
    },
  }, async (request) => toUserView(await userAdmin.disable(request.params.id, request.user!.id)));

  app.post('/users/:id/enable', {
    schema: { summary: 'Allow a disabled User to sign in again (admins only)', params: IdParams, response: { 200: UserView, ...errors } },
  }, async (request) => toUserView(await userAdmin.enable(request.params.id)));

  app.delete('/users/:id/sessions', {
    schema: { summary: 'Sign a User out everywhere (admins only)', params: IdParams, response: { 204: Type.Null(), ...errors } },
  }, async (request, reply) => {
    await userAdmin.endSessions(request.params.id);
    return reply.code(204).send(null);
  });

  app.post('/users/:id/password-reset', {
    schema: {
      summary: 'Create a password reset link to pass on to the User (admins only)',
      params: IdParams, response: { 201: LinkView, ...errors },
    },
  }, async (request, reply) => {
    const [target] = await db.select({ banned: user.banned }).from(user).where(eq(user.id, request.params.id));
    if (!target) return reply.code(404).send({ error: 'No such User' });
    if (target.banned) return reply.code(409).send({ error: 'Enable the User first' });
    const { reset, token } = await passwordResets.issue(request.params.id, request.user!.id);
    // In the URL fragment, which browsers never send to the server or in Referer.
    return reply.code(201).send({ url: `${baseUrl}/#/reset/${token}`, expiresAt: reset.expiresAt.toISOString() });
  });

  app.delete('/users/:id', {
    schema: {
      summary: 'Delete a User with everything only they own (admins only)',
      description: 'Removes their Originals and stored files, Imports, and the Divers no one else manages with all their Dives. Cannot be undone.',
      params: IdParams,
      body: Type.Object({ confirmEmail: Type.String({ description: 'The User\'s e-mail, typed by the admin to confirm' }) }),
      response: { 204: Type.Null(), ...errors },
    },
  }, async (request, reply) => {
    await userAdmin.remove(request.params.id, request.user!.id, request.body.confirmEmail);
    request.log.info({ userId: request.params.id, by: request.user!.id }, 'user deleted');
    return reply.code(204).send(null);
  });
};

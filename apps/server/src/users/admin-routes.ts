// Admins manage Users (ADR 0013): list, role, disable/enable, end sessions, reset link, delete.
import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireUser, userOf } from '../auth/fastify.js';
import { problem } from '../http/problems.js';
import type { PasswordResets } from './password-resets.js';
import { UserAdminError, type UserAdmin } from './user-admin.js';
import { LinkView, Problem, RoleSchema, UserView, toUserView } from './views.js';
import { IdParams } from '../http/schemas.js';

export interface AdminRouteDeps {
  auth: Auth;
  userAdmin: UserAdmin;
  passwordResets: PasswordResets;
  baseUrl: string;
}

const STATUS: Record<UserAdminError['code'], number> = { user_not_found: 404, user_disabled: 409, last_admin: 409, not_yourself: 409, confirmation_mismatch: 400 };

export const adminRoutes: FastifyPluginAsyncTypebox<AdminRouteDeps> = async (scope, { auth, userAdmin, passwordResets, baseUrl }) => {
  const app = scope.withTypeProvider<TypeBoxTypeProvider>();
  app.addHook('onRequest', requireUser(auth));
  app.addHook('onRequest', requireAdmin);
  // Refusals from the admin service become their status; anything else goes to the default handler.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UserAdminError) return reply.code(STATUS[error.code]).send(problem(error.code));
    throw error;
  });
  const errors = { 400: Problem, 404: Problem, 409: Problem };

  app.get('/users', {
    schema: { summary: 'All Users of this instance (admins only)', response: { 200: Type.Array(UserView) } },
  }, async () => (await userAdmin.list()).map(toUserView));

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
  }, async (request) => toUserView(await userAdmin.disable(userOf(request).id, request.params.id)));

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
    await userAdmin.assertCanReset(request.params.id);
    const { reset, token } = await passwordResets.issue(userOf(request).id, request.params.id);
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
    await userAdmin.remove(userOf(request).id, request.params.id, request.body.confirmEmail);
    request.log.info({ userId: request.params.id, by: userOf(request).id }, 'user deleted');
    return reply.code(204).send(null);
  });
};

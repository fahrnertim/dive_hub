// Better Auth inside Fastify (ADR 0011): the /api/auth/* handler and a session guard for our routes.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { problem } from '../http/problems.js';
import { CLIENT_IP_HEADER, PUBLIC_AUTH_PATHS, type Auth, type SessionUser } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in User; set by the session guard on every protected route. */
    user: SessionUser | null;
    /** Id of the session the request came with (set together with `user`). */
    sessionId: string | null;
  }
}

/**
 * Request headers for Better Auth. The client IP comes from Fastify, which only believes
 * X-Forwarded-For from the configured trusted proxies; a client-sent value of our header is replaced.
 */
export function authHeaders(request: FastifyRequest): Headers {
  const headers = fromNodeHeaders(request.headers);
  headers.set(CLIENT_IP_HEADER, request.ip);
  return headers;
}

/** Copies Better Auth's cookies (sign-in, session refresh, sign-out) onto our reply. */
export function forwardCookies(from: Headers, reply: FastifyReply): void {
  const cookies = from.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
}

const publicPaths = new Set<string>(PUBLIC_AUTH_PATHS);

/** Mounts the Better Auth endpoints we expose (PUBLIC_AUTH_PATHS) at /api/auth/*; the rest answer 404. */
export async function authHandler(app: FastifyInstance, { auth }: { auth: Auth }) {
  // Hand Better Auth the body exactly as sent; it parses and validates it itself.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    schema: { hide: true },
    handler: async (request, reply) => {
      const url = new URL(request.url, auth.options.baseURL);
      if (!publicPaths.has(url.pathname.slice('/api/auth'.length))) return reply.code(404).send(problem('not_found'));
      const response = await auth.handler(new Request(url, {
        method: request.method,
        headers: authHeaders(request),
        ...(typeof request.body === 'string' && request.body.length > 0 && { body: request.body }),
      }));
      reply.status(response.status);
      for (const [key, value] of response.headers) {
        if (key !== 'set-cookie' && key !== 'content-length' && key !== 'content-encoding') reply.header(key, value);
      }
      forwardCookies(response.headers, reply);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}

/** onRequest hook: 401 unless a valid session cookie is present. Refreshed session cookies are passed on. */
export function requireUser(auth: Auth) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { headers, response: session } = await auth.api.getSession({
      headers: authHeaders(request), returnHeaders: true,
    });
    if (!session) return reply.code(401).send(problem('sign_in_required'));
    forwardCookies(headers, reply);
    request.user = session.user;
    request.sessionId = session.session.id;
  };
}

/** onRequest hook (after requireUser): 403 unless the signed-in User is an admin. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.user?.role !== 'admin') return reply.code(403).send(problem('admins_only'));
}

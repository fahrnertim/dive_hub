// The MCP endpoint (ADR 0035): POST /mcp, Streamable HTTP, stateless, read-only. A request carries the key of an AI
// access as a bearer token; anything else gets a 401 that says what to do. The SDK serves the 2026-07-28 protocol and,
// from the same tools, 2025-era clients.
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Db } from '../db/client.js';
import type { AccessRefusal, AiAccessService, VerifiedAccess } from './access-service.js';
import { createMcpServer } from './server.js';

export interface McpEndpointDeps {
  db: Db;
  accesses: AiAccessService;
  /** Public URL of the instance: requests from a browser page elsewhere are refused. */
  baseUrl: string;
}

/** Why a request was refused, for the client's log and, through it, the user. */
const REFUSALS: Record<Exclude<AccessRefusal['reason'], 'rate_limited'>, string> = {
  off: 'AI access is switched off on this Dive Hub. An admin can switch it on under Admin, "AI access".',
  missing: 'This endpoint needs the key of an AI access: send it as "Authorization: Bearer dh_…". Create one in Dive Hub under Account, "AI access".',
  invalid: 'This key is not valid (anymore): its AI access may have been revoked. Create a new one in Dive Hub under Account, "AI access", and use its key.',
  user_disabled: 'The Dive Hub account this key belongs to is disabled. An admin can enable it again.',
};

function refuse(reply: FastifyReply, refusal: AccessRefusal) {
  if (refusal.reason === 'rate_limited') {
    return reply.code(429).header('retry-after', refusal.retryAfterSeconds).send({
      error: 'too_many_requests',
      error_description: `This AI access sent too many requests. Wait ${refusal.retryAfterSeconds} s and try again.`,
    });
  }
  const description = REFUSALS[refusal.reason];
  return reply.code(401)
    // RFC 6750: the challenge names the error (header values are ASCII). No resource metadata: there is no OAuth yet (ADR 0035).
    .header('www-authenticate', `Bearer realm="Dive Hub", error="invalid_token", error_description="${description.replace(/"/g, "'").replace(/[^ -~]/g, '...')}"`)
    .send({ error: 'invalid_token', error_description: description });
}

export async function mcpEndpoint(app: FastifyInstance, { db, accesses, baseUrl }: McpEndpointDeps) {
  // The SDK reads and checks the body itself (JSON, size, protocol era), so it gets it exactly as sent.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  const handler = createMcpHandler(
    ({ authInfo }) => createMcpServer({
      db, accesses, onError: (error, tool) => app.log.error({ err: error, tool }, 'MCP tool failed'),
    }, authInfo!.extra!.access as VerifiedAccess),
    // No tool sends progress or notifications, so the SDK answers each request with one JSON body.
    { onerror: (error) => app.log.debug({ err: error }, 'MCP request rejected') },
  );
  app.addHook('onClose', () => handler.close());

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    schema: { hide: true },
    handler: async (request, reply) => {
      // A browser page on another origin has no business here (the MCP spec asks servers to check Origin).
      const origin = request.headers.origin;
      if (origin && origin !== baseUrl) {
        return reply.code(403).send({ error: 'forbidden', error_description: `Requests from ${origin} are not accepted.` });
      }
      const [scheme, key] = (request.headers.authorization ?? '').split(' ');
      const access = await accesses.verify(scheme?.toLowerCase() === 'bearer' ? key : undefined);
      if ('reason' in access) return refuse(reply, access);

      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        // The key has done its job; the SDK and the tools never see it.
        if (value !== undefined && name !== 'authorization') headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const response = await handler.fetch(new Request(new URL(request.url, baseUrl), {
        method: request.method, headers,
        ...(typeof request.body === 'string' && request.body.length > 0 && { body: request.body }),
      }), { authInfo: { token: '', clientId: access.id, scopes: access.scopes, extra: { access } } });

      reply.status(response.status);
      for (const [name, value] of response.headers) {
        if (name !== 'content-length' && name !== 'content-encoding') reply.header(name, value);
      }
      return reply.send(response.body ? Readable.fromWeb(response.body as WebReadableStream) : null);
    },
  });
}

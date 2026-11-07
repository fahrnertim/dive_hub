// GET /api/live (ADR 0066): one server-sent event stream per signed-in User, carrying hints only.
import type { FastifyInstance } from 'fastify';
import { requireUser, userOf } from '../auth/fastify.js';
import type { Auth } from '../auth/auth.js';
import { problem } from '../http/problems.js';
import type { LiveHub } from './hub.js';

export async function liveRoutes(app: FastifyInstance, { auth, hub }: { auth: Auth; hub: LiveHub }) {
  app.get('/api/live', {
    onRequest: requireUser(auth),
    // The stream is not JSON and is read by the browser's EventSource, not by the generated client (docs/spec/clients.md).
    schema: { hide: true },
  }, async (request, reply) => {
    const user = userOf(request);
    const socket = reply.raw;
    if (!hub.add(user.id, socket)) return reply.code(429).send(problem('too_many_live_streams'));

    reply.hijack();
    socket.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx buffers proxied responses unless told not to (docs/spec/clients.md).
      'X-Accel-Buffering': 'no',
    });
    socket.flushHeaders?.();
    socket.write('retry: 5000\n\n:ok\n\n');

    const close = () => hub.remove(user.id, socket);
    request.raw.once('close', close);
    request.raw.once('error', close);
    // Keep the handler open for the life of the stream; Fastify has already let go of the reply.
    await new Promise<void>((resolve) => request.raw.once('close', resolve));
  });
}

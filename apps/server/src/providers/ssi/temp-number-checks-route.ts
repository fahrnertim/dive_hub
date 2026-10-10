// TEMPORARY, with number-checks.ts: runs the owner's checks of SSI's dive numbers with a Connection's own access, so no
// separate sign-in is needed. Not in the OpenAPI document. Remove it once ADR 0048's "As built" has the answers.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireUser } from '../../auth/fastify.js';
import type { Auth } from '../../auth/auth.js';
import type { ConnectionService } from '../connection-service.js';
import { runNumberChecks } from './number-checks.js';
import type { SsiClient } from './ssi-client.js';

export const tempNumberChecksRoute: FastifyPluginAsyncTypebox<{ auth: Auth; connections: ConnectionService; client: SsiClient }> =
  async (app, { auth, connections, client }) => {
    app.addHook('onRequest', requireUser(auth));
    app.post('/connections/:id/temp-ssi-number-checks', {
      schema: {
        hide: true,
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          siteId: Type.Optional(Type.String({ maxLength: 20 })),
          lookup: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 1_000_000 }), { maxItems: 20 })),
          dive: Type.Optional(Type.Object({ id: Type.String({ maxLength: 20 }), to: Type.Integer({ minimum: 1, maximum: 100_000 }) })),
        }, { additionalProperties: false }),
        response: { 200: Type.Object({ lines: Type.Array(Type.String()), failed: Type.Union([Type.String(), Type.Null()]) }) },
      },
    }, async (request) => {
      const row = await connections.own(request.user!.id, request.params.id);
      if (row.provider !== 'ssi') return { lines: [], failed: 'This Connection is not an SSI one' };
      const lines: string[] = [];
      try {
        await connections.withAccess(row, (ctx) => runNumberChecks({
          client, access: ctx.access, accountId: ctx.accountId, siteId: request.body.siteId || undefined, dive: request.body.dive, lookup: request.body.lookup,
          log: (line) => { lines.push(line); },
        }));
        return { lines, failed: null };
      } catch (error) {
        return { lines, failed: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
      }
    });
  };

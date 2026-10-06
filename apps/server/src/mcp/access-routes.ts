// AI accesses over the API (ADR 0035): a User creates, lists and revokes their own and reads their log; admins
// switch the MCP endpoint on or off for the instance and can revoke every access.
import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type, type Static } from 'typebox';
import { AI_ACCESS_NAME_MAX, type Auth } from '../auth/auth.js';
import { requireAdmin, requireUser } from '../auth/fastify.js';
import { Problem, problem } from '../http/problems.js';
import { AI_ACCESS_SCOPES, AiAccessError, LOG_DAYS, LOG_PAGE_MAX, type AiAccessService } from './access-service.js';

export interface AiAccessRouteDeps {
  auth: Auth;
  accesses: AiAccessService;
  baseUrl: string;
}

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const DateTime = Type.String({ format: 'date-time' });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([Type.Null(), t]);
const Scope = Type.Enum([...AI_ACCESS_SCOPES], {
  description: 'logbook:read: the User\'s Dives, sites, Divers and buddies\' names. logbook:positions: also the Dives\' own entry and exit positions',
});

const AccessView = Type.Object({
  id: Type.String(),
  name: Type.String({ description: 'What the User called it, e.g. the LLM client and the machine it runs on' }),
  keyStart: Type.String({ description: 'The key\'s first characters, to tell accesses apart; the key itself is never returned again' }),
  scopes: Type.Array(Scope),
  createdAt: DateTime,
  lastUsedAt: Nullable(DateTime),
});

const LogEntryView = Type.Object({
  id: Type.String(),
  at: DateTime,
  accessId: Type.String({ description: 'The AI access; it may be revoked meanwhile' }),
  accessName: Type.String({ description: 'Its name when the call was made' }),
  tool: Type.String({ description: 'The MCP tool called, e.g. logbook_search_dives' }),
  arguments: Type.Record(Type.String(), Type.Unknown(), { description: 'What it was asked; search words are replaced by "[text]"' }),
  rows: Type.Integer({ description: 'Dives, sites or Divers the answer held or counted' }),
  outcome: Type.Enum(['ok', 'error']),
  errorCode: Nullable(Type.String({ description: 'Why a call failed, e.g. dive_not_found, invalid_input, timeout' })),
  durationMs: Type.Integer(),
});

type Access = Awaited<ReturnType<AiAccessService['list']>>[number];
const toAccessView = (a: Access): Static<typeof AccessView> => ({
  id: a.id, name: a.name, keyStart: a.keyStart, scopes: a.scopes, createdAt: a.createdAt.toISOString(), lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
});

const STATUS: Record<AiAccessError['code'], number> = { ai_access_not_found: 404, ai_access_off: 409 };

export const aiAccessRoutes: FastifyPluginAsyncTypebox<AiAccessRouteDeps> = async (scope, { auth, accesses, baseUrl }) => {
  const app = scope.withTypeProvider<TypeBoxTypeProvider>();
  app.addHook('onRequest', requireUser(auth));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AiAccessError) return reply.code(STATUS[error.code]).send(problem(error.code));
    throw error;
  });

  app.get('/me/ai-access', {
    schema: {
      summary: 'The signed-in User\'s AI accesses to the MCP endpoint, and whether this instance offers it (ADR 0035)',
      response: {
        200: Type.Object({
          enabled: Type.Boolean({ description: 'Whether an admin switched the MCP endpoint on; while off, no key works and none can be created' }),
          endpoint: Type.String({ description: 'The URL an LLM client connects to' }),
          accesses: Type.Array(AccessView),
        }),
      },
    },
  }, async (request) => ({
    enabled: await accesses.enabled(), endpoint: `${baseUrl}/mcp`, accesses: (await accesses.list(request.user!.id)).map(toAccessView),
  }));

  app.post('/me/ai-accesses', {
    schema: {
      summary: 'Create an AI access; the key in the answer is shown only now',
      description: 'Clients say first what an AI access hands to the User\'s AI provider, and show the key once with how to use it '
        + '(docs/spec/clients.md). 409 ai_access_off while the instance has the endpoint switched off.',
      body: Type.Object({
        name: Type.String({ minLength: 1, maxLength: AI_ACCESS_NAME_MAX, pattern: '\\S' }),
        positions: Type.Optional(Type.Boolean({ description: 'Also grant logbook:positions; logbook:read is always granted' })),
      }, { additionalProperties: false }),
      response: {
        201: Type.Object({
          access: AccessView,
          key: Type.String({ description: 'The bearer key. Only its hash is stored: it can\'t be shown again' }),
        }),
        400: Problem, 409: Problem,
      },
    },
  }, async (request, reply) => {
    const { key, ...created } = await accesses.create(request.user!.id, request.body.name.trim(), request.body.positions === true);
    return reply.code(201).send({ access: toAccessView(created), key });
  });

  app.delete('/me/ai-accesses/:id', {
    schema: { summary: 'Revoke an AI access: its key stops working at once; its log stays', params: IdParams, response: { 204: Type.Null(), 404: Problem } },
  }, async (request, reply) => {
    await accesses.revoke(request.user!.id, request.params.id);
    return reply.code(204).send(null);
  });

  app.get('/me/ai-access-log', {
    schema: {
      summary: `What the User's AI accesses read, newest first: every tool call of the last ${LOG_DAYS} days, of revoked accesses too`,
      querystring: Type.Object({
        accessId: Type.Optional(Type.String({ format: 'uuid', description: 'Only this access' })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LOG_PAGE_MAX, default: 25 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
      }),
      response: { 200: Type.Object({ entries: Type.Array(LogEntryView), total: Type.Integer() }) },
    },
  }, async (request) => {
    const { accessId, limit = 25, offset = 0 } = request.query;
    const { entries, total } = await accesses.logOf(request.user!.id, { accessId, limit, offset });
    return {
      total,
      entries: entries.map((e) => ({
        id: e.id, at: e.at.toISOString(), accessId: e.accessId, accessName: e.accessName, tool: e.tool, arguments: e.arguments,
        rows: e.rows, outcome: e.outcome, errorCode: e.errorCode, durationMs: e.durationMs,
      })),
    };
  });

  // --- Admins: the instance's switch ------------------------------------------------------------------------------

  const SettingView = Type.Object({
    enabled: Type.Boolean(),
    changedAt: Nullable(DateTime),
    changedBy: Nullable(Type.String({ description: 'The admin\'s name' })),
    accesses: Type.Integer({ description: 'How many AI accesses Users have, on the whole instance' }),
  });
  const settingView = async (): Promise<Static<typeof SettingView>> => {
    const s = await accesses.setting();
    return { ...s, changedAt: s.changedAt?.toISOString() ?? null };
  };

  app.get('/admin/ai-access', {
    onRequest: requireAdmin,
    schema: { summary: 'Admins: whether this instance offers the MCP endpoint, and how many AI accesses exist', response: { 200: SettingView, 403: Problem } },
  }, settingView);

  app.put('/admin/ai-access', {
    onRequest: requireAdmin,
    schema: {
      summary: 'Admins: switch the MCP endpoint on or off for the instance (off by default)',
      description: 'Off rejects every key at once and stops new ones; accesses stay, so switching on again restores those not revoked.',
      body: Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }),
      response: { 200: SettingView, 403: Problem },
    },
  }, async (request) => {
    await accesses.setEnabled(request.user!.id, request.body.enabled);
    request.log.info({ enabled: request.body.enabled, by: request.user!.id }, 'MCP endpoint switched');
    return settingView();
  });

  app.delete('/admin/ai-accesses', {
    onRequest: requireAdmin,
    schema: {
      summary: 'Admins: revoke every AI access of every User; their keys stop working at once',
      response: { 200: Type.Object({ revoked: Type.Integer() }), 403: Problem },
    },
  }, async (request) => {
    const revoked = await accesses.revokeAll();
    request.log.info({ revoked, by: request.user!.id }, 'all AI accesses revoked');
    return { revoked };
  });
};

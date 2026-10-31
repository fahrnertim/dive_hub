// What a Connection's account at the Provider keeps, over HTTP: its list of people (buddies: list, link, add, import)
// and its certification cards (ADR 0050). Registered inside the provider routes, so the sign-in hook and the error handler are theirs.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userOf } from '../auth/fastify.js';
import { callerOf } from '../http/caller.js';
import { Problem } from '../http/problems.js';
import { IdParams, Nullable } from '../http/schemas.js';
import type { CertificationService } from '../certifications/certification-service.js';
import type { BuddyService } from './buddies/buddy-service.js';
import { errors } from './route-parts.js';

const BuddyView = Type.Object({
  entryId: Type.String({ description: 'The entry\'s ID at the Provider: what link and import name it by' }),
  name: Type.String({ description: 'As the Provider has it' }),
  account: Nullable(Type.String({ description: 'The person\'s own account at the Provider; null: none (link or import it by entryId)' })),
  diver: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, {
    description: 'The Diver here with that account; for an entry without one, the Diver it was linked, added or imported for',
  })),
  matches: Type.Boolean({ description: 'With ?for: the entry\'s name or e-mail is that Diver\'s (folded, trimmed). Only a sort; the e-mail is never answered' }),
});
const linkErrors = { ...errors, 403: Problem };

export interface AccountRouteDeps {
  buddies: BuddyService;
  certifications: CertificationService;
}

export const accountRoutes: FastifyPluginAsyncTypebox<AccountRouteDeps> = async (app, { buddies, certifications }) => {
  app.get('/connections/:id/buddies', {
    schema: {
      summary: 'The account\'s own list of people at the Provider (SSI: the buddy list), read live, each with the Diver here who has their account',
      description: 'Only names and accounts are answered. An import also stores what the person\'s code says (ADR 0043); nothing else the Provider keeps about them. '
        + 'With ?for=<diverId>, the entries whose name or e-mail is that Diver\'s come first (matches), then the rest by name.',
      params: IdParams,
      querystring: Type.Object({ for: Type.Optional(Type.String({ format: 'uuid', description: 'The Diver to be linked or added: sorts its likely entries first' })) }),
      response: { 200: Type.Array(BuddyView), ...errors },
    },
  }, async (request) => buddies.list(userOf(request).id, request.params.id, request.query.for ? { forDiverId: request.query.for } : {}));

  app.post('/connections/:id/buddies/link', {
    schema: {
      summary: 'Link an entry of the account\'s list to a Diver here',
      description: 'An entry with an account gives the Diver that account (the rules of PUT /api/divers/{id}/external-ids/{source}: 409 diver_external_id_taken names the Diver that has it); '
        + 'an entry without one is only remembered for the Diver. The last link of an entry wins. 404 provider_buddy_not_found: the entry is not in the list (anymore).',
      params: IdParams,
      body: Type.Object({ entryId: Type.String({ minLength: 1, maxLength: 200 }), diverId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
      response: { 200: Type.Object({ diverId: Type.String() }), ...linkErrors },
    },
  }, async (request) => buddies.link(
    callerOf(request), request.params.id, request.body.entryId, request.body.diverId,
  ));

  app.post('/connections/:id/buddies/add', {
    schema: {
      summary: 'Add a person to the account\'s list for a Diver here, and remember the entry for it',
      description: 'A typed person (names, optional e-mail), or a scanned code (also account): the Diver then gets that account, and the entry is added by it; '
        + 'an account already in the list links that entry instead. What the Diver lacks of first name, last name and e-mail is filled in. '
        + 'added.name is the entry as the Provider answered it; knownAs is that name when it differs from the Diver\'s, else null: show it.',
      params: IdParams,
      body: Type.Object({
        diverId: Type.String({ format: 'uuid' }),
        firstName: Type.String({ minLength: 1, maxLength: 100 }),
        lastName: Type.String({ minLength: 1, maxLength: 100 }),
        email: Type.Optional(Nullable(Type.String({ format: 'email', maxLength: 254 }))),
        account: Type.Optional(Nullable(Type.String({ pattern: '^[1-9]\\d{0,9}$', description: 'The person\'s SSI account from a scanned code: digits only' }))),
      }, { additionalProperties: false }),
      response: {
        200: Type.Object({ added: Type.Object({ diverId: Type.String(), name: Type.String() }), knownAs: Nullable(Type.String()) }),
        ...linkErrors,
      },
    },
  }, async (request) => {
    const { diverId, firstName, lastName, email, account } = request.body;
    return buddies.add(
      callerOf(request), request.params.id, diverId,
      { firstName, lastName, email: email ?? null, account: account ?? null },
    );
  });

  app.post('/connections/:id/buddies/import', {
    schema: {
      summary: 'Add the chosen people from the account\'s list as external Divers, with their name, account and what their code says',
      description: 'First and last name, e-mail and leader number come along (ADR 0043). A chosen entry whose account a Diver already has '
        + 'fills what that Diver lacks of these and overwrites nothing. `entries` names entries without an account: each becomes an external Diver '
        + 'from its name and is remembered for it (one remembered already is skipped). To link an entry to a Diver here '
        + 'instead, use POST /api/connections/{id}/buddies/link.',
      params: IdParams,
      body: Type.Object({
        accounts: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 500 }),
        entries: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 500, description: 'Entry IDs of entries without an account' })),
      }, { additionalProperties: false }),
      response: { 200: Type.Object({ created: Type.Integer(), updated: Type.Integer({ description: 'Divers already here that got details they lacked' }), buddies: Type.Array(BuddyView) }), ...errors },
    },
  }, async (request) => buddies.import(
    callerOf(request), request.params.id, request.body.accounts, request.body.entries,
  ));

  app.post('/connections/:id/certifications/import', {
    schema: {
      summary: 'Read the account\'s certification cards and bring the Connection\'s Diver up to date (ADR 0050)',
      description: 'No preview: a new card is created verified_with_agency (read-only apart from notes), a card already here is updated from the '
        + 'Provider\'s data, a card the User deleted stays deleted (deleted_earlier), a card the Provider no longer lists stays '
        + '(not_at_provider). Pictures are fetched afterwards by a job: imageState pending, then stored or failed. 400 provider_unsupported '
        + 'at a Provider without certifications; 404 diver_not_found when the User no longer keeps the Connection\'s Diver.',
      params: IdParams,
      response: {
        200: Type.Object({
          created: Type.Integer(), updated: Type.Integer(), unchanged: Type.Integer(),
          items: Type.Array(Type.Object({
            result: Type.Enum(['created', 'updated', 'unchanged', 'deleted_earlier', 'not_at_provider']),
            level: Type.String({ description: 'The card\'s course or level, to name it in the report' }),
            certificationId: Nullable(Type.String({ description: 'The card here; null for deleted_earlier' })),
          })),
        }), ...errors,
      },
    },
  }, async (request) => certifications.importFrom(userOf(request).id, request.params.id));
};

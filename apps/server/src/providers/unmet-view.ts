// What the API says about a requirement a Dive doesn't meet (ADR 0029): in a Dive's status at a Provider, in a refusal
// and in a push run's preview.
import { Type } from 'typebox';
import { PARTICIPANT_ROLES } from '../db/schema.js';
import { Nullable } from '../http/schemas.js';

export const UnmetView = Type.Object({
  type: Type.String({ description: 'As in the Provider\'s requirements' }),
  severity: Type.Enum(['blocking', 'advisory']),
  source: Type.String(),
  siteId: Type.Optional(Nullable(Type.String({ description: 'site_external_id: the Dive site to give the ID; null: choose a site first' }))),
  bySend: Type.Optional(Type.Boolean({
    description: 'site_external_id: sending finds the site at the Provider or creates it there as a private site (the site has a position), '
      + 'so it does not stop a send; offering the pick stays',
  })),
  diverId: Type.Optional(Type.String({ description: 'diver_mapping: the Participant' })),
  diverName: Type.Optional(Type.String()),
  role: Type.Optional(Type.Enum([...PARTICIPANT_ROLES])),
  fixes: Type.Optional(Type.Array(Type.String(), {
    description: 'diver_mapping: ways to fix it. diver_external_id: set the Diver\'s account at source (PUT /api/divers/{id}/external-ids/{source}). '
      + 'list_entry: link or add an entry in the account\'s own list at the Provider (SSI: the buddy list)',
  })),
}, { description: 'A requirement this Dive doesn\'t meet, from Dive Hub\'s own data' });

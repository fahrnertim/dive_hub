// What the API says when a Dive is deleted: each Provider copy's fate, and the refusal that names them.
import { Type } from 'typebox';
import { Problem } from '../http/problems.js';

export const Copies = Type.Array(Type.Object({
  provider: Type.String(),
  copy: Type.Enum(['deleted', 'kept'], { description: 'What happened to the copy there' }),
}), { description: 'Each Provider the Dive was at' });

/** A refusal while deleting; after a provider_* code, which copies at Providers are gone already. Registered with app.addSchema, like Problem. */
export const DeleteProblemSchema = Type.Intersect([Problem, Type.Object({
  providers: Type.Optional(Type.Array(Copies.items, {
    description: 'With a provider_* code: each Provider the Dive is at, and whether its copy there was deleted before the refusal (the Dive stays here)',
  })),
})], { $id: 'DeleteProblem', description: 'A refusal while deleting a Dive: a Problem, with the copies at Providers' });

// Schema fragments every route module uses, defined once.
import { Type, type TSchema, type TSchemaOptions } from 'typebox';

export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
export const DateTime = Type.String({ format: 'date-time' });
/**
 * Null first: Fastify's validator coerces types and tries union members in order, so with the
 * value type first a null in a request would become 0 or "" (caught by the dive editing tests).
 */
export const Nullable = <T extends TSchema>(t: T, options?: TSchemaOptions) => Type.Union([Type.Null(), t], options);

/** A Revision's change of one field: the value it had and the one it got. */
export const Change = <T extends TSchema>(t: T) => Type.Object({ from: t, to: t });
/**
 * A Revision's change that only adds something (a merge, an adoption): `from` is always null, so the schema leaves
 * it out (openapi-fetch's types would drop a property that can only be null anyway).
 */
export const Made = <T extends TSchema>(t: T) => Type.Object({ to: t }, { description: 'from is always null' });
/**
 * A Revision's changes: the fields clients read named with today's shapes, any other field as it is. Old Revisions
 * keep the shapes they were written with, so a history route sends them as stored (historyRoute), never through the
 * schema's serializer, which would drop or refuse a value of an older shape.
 */
export const Changes = <T extends Record<string, TSchema>>(fields: T, description?: string) =>
  Type.Object(Type.Partial(Type.Object(fields)).properties, { additionalProperties: Change(Type.Unknown()), ...(description && { description }) });
/** Route options for a history: sent with JSON.stringify, as stored (see Changes). */
export const historyRoute = { serializerCompiler: () => (data: unknown) => JSON.stringify(data) };

/** A stored text value as one of an enum's values (e.g. a text column a response schema names the values of); any other is a bug, so it throws. */
export function oneOf<T extends string>(values: readonly T[], value: string): T {
  const found = values.find((v) => v === value);
  if (found === undefined) throw new Error(`unexpected value "${value}", not one of ${values.join(', ')}`);
  return found;
}

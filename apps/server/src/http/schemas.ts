// Schema fragments every route module uses, defined once.
import { Type, type TSchema, type TSchemaOptions } from 'typebox';

export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
export const DateTime = Type.String({ format: 'date-time' });
/**
 * Null first: Fastify's validator coerces types and tries union members in order, so with the
 * value type first a null in a request would become 0 or "" (caught by the dive editing tests).
 */
export const Nullable = <T extends TSchema>(t: T, options?: TSchemaOptions) => Type.Union([Type.Null(), t], options);

/** A stored text value as one of an enum's values (e.g. a text column a response schema names the values of); any other is a bug, so it throws. */
export function oneOf<T extends string>(values: readonly T[], value: string): T {
  const found = values.find((v) => v === value);
  if (found === undefined) throw new Error(`unexpected value "${value}", not one of ${values.join(', ')}`);
  return found;
}

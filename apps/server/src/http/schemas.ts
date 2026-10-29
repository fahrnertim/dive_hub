// Schema fragments every route module uses, defined once.
import { Type, type TSchema } from 'typebox';

export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
export const DateTime = Type.String({ format: 'date-time' });
/**
 * Null first: Fastify's validator coerces types and tries union members in order, so with the
 * value type first a null in a request would become 0 or "" (caught by the dive editing tests).
 */
export const Nullable = <T extends TSchema>(t: T) => Type.Union([Type.Null(), t]);

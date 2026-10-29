// Who a route calls a service for: the signed-in User and whether they are an admin. Services over shared things
// (Dive sites, centres, external Divers) take it first, where an owner check needs only the User's id.
import type { FastifyRequest } from 'fastify';
import { userOf } from '../auth/fastify.js';

export interface Caller {
  userId: string;
  isAdmin: boolean;
}

/** The Caller of a route behind requireUser. */
export function callerOf(request: FastifyRequest): Caller {
  const user = userOf(request);
  return { userId: user.id, isAdmin: user.role === 'admin' };
}

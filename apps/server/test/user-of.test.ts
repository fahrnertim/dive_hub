// The signed-in User of a route behind requireUser, read in one place: without the hook it is the route's mistake,
// so it fails loudly instead of reading `id` of null.
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { userOf } from '../src/auth/fastify.js';

const requestWith = (user: FastifyRequest['user']) => ({ user }) as FastifyRequest;

describe('userOf', () => {
  it("gives the request's User", () => {
    const user = { id: 'u-1', role: 'user' } as NonNullable<FastifyRequest['user']>;
    expect(userOf(requestWith(user))).toBe(user);
  });

  it('throws on a route without requireUser', () => {
    expect(() => userOf(requestWith(null))).toThrow('no signed-in User: the route has no requireUser hook');
  });
});

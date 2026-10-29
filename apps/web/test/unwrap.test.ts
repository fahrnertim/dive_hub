// How an answer becomes data or an ApiError (ADR 0014): the code, the Provider named, and the details a refusal carries.
import { describe, expect, it } from 'vitest';
import { ApiError, unwrap } from '../src/api.ts';

const refused = (status: number, error: unknown) => ({ error, response: new Response(null, { status }) });
const thrown = (result: { error?: unknown; response: Response }) => {
  try {
    unwrap(result);
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('no error');
};

describe('unwrap', () => {
  it('gives the data of a success, and nothing for a 204', () => {
    expect(unwrap({ data: { id: 'a' }, response: new Response(null, { status: 200 }) })).toEqual({ id: 'a' });
    expect(unwrap({ response: new Response(null, { status: 204 }) })).toBeUndefined();
  });

  it('keeps the code, the Provider and only the details there are', () => {
    const e = thrown(refused(409, {
      code: 'provider_number_taken', error: 'Taken', provider: 'ssi', providerName: 'SSI',
      existing: { remoteId: 'r1', number: 7, startsAt: null }, diveId: null, extra: 'not ours',
    }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ message: 'Taken', status: 409, code: 'provider_number_taken', provider: { id: 'ssi', name: 'SSI' } });
    expect(e.details).toEqual({ existing: { remoteId: 'r1', number: 7, startsAt: null } });
  });

  it('takes Fastify\'s message for a validation error, and the status where the body says nothing', () => {
    expect(thrown(refused(400, { statusCode: 400, error: undefined, message: 'body/name must be string' })).message).toBe('body/name must be string');
    expect(thrown(refused(502, undefined))).toMatchObject({ message: 'Request failed (502)', details: {} });
  });
});

// The Providers of this instance (ADR 0027): built once in main.ts with the production adapters; tests add the fake SSI
// and a test-only adapter. Everything generic asks the registry, never a Provider by name.
import type { ProblemCode } from '../http/problems.js';
import { ProviderError, type ProviderAdapter } from './provider.js';

export interface ProviderRegistry {
  /** Every Provider, in the order the UI shows them. */
  list(): ProviderAdapter[];
  /** The Provider, or `provider_unsupported` when this instance has none by that id. */
  get(id: string): ProviderAdapter;
}

export function createProviderRegistry(adapters: ProviderAdapter[]): ProviderRegistry {
  const byId = new Map(adapters.map((a) => [a.id, a]));
  if (byId.size !== adapters.length) throw new Error('Two Providers share an id');
  return {
    list: () => adapters,
    get(id) {
      const adapter = byId.get(id);
      if (!adapter) throw new ProviderServiceError('provider_unsupported', { id, name: id });
      return adapter;
    },
  };
}

/** A refusal about a Provider, answered with its problem code and the Provider named. */
export class ProviderServiceError extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly provider?: { id: string; name: string },
    /** More for the client, such as what is unmet (`provider_requirements_unmet`). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

const PROBLEM_OF: Record<ProviderError['reason'], ProblemCode> = {
  wrong_credentials: 'provider_wrong_credentials', signed_out: 'provider_sign_in_needed', refused: 'provider_refused',
  unavailable: 'provider_unavailable', bad_response: 'provider_unavailable',
};

/** An adapter's error as a refusal with a problem code; anything else (a bug) passes through as it is. */
export const asProblem = (error: unknown, adapter: ProviderAdapter) =>
  error instanceof ProviderError ? new ProviderServiceError(PROBLEM_OF[error.reason], named(adapter)) : error;

export const named = (adapter: ProviderAdapter) => ({ id: adapter.id, name: adapter.capabilities.name });

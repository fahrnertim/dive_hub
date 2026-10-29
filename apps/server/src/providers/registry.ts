// The Providers of this instance (ADR 0027): built once in main.ts with the production adapters; tests add the fake SSI
// and a test-only adapter. Everything generic asks the registry, never a Provider by name.
import { ProviderError, type ProviderAdapter } from './provider.js';

export interface ProviderRegistry {
  /** Every Provider, in the order the UI shows them. */
  list(): ProviderAdapter[];
  /** The Provider, or `provider_unsupported` when this instance has none by that id. */
  get(id: string): ProviderAdapter;
}

/**
 * What the adapter declares but has no method for (ADR 0027): the generic layer reads the Capabilities and then calls
 * the method, so the two must agree. `dives.open` makes no call, so it is opened once to see its methods.
 */
function unbacked(adapter: ProviderAdapter): string[] {
  const { data, limits } = adapter.capabilities;
  const exports = data.dives?.export;
  const action = exports && adapter.dives?.open({ connectionId: '', accountId: '', access: '' });
  const has = (declared: boolean | undefined, method: unknown, name: string) => (declared && !method ? [name] : []);
  return [
    ...has(!!exports, adapter.dives, 'dives'),
    ...has(exports?.operations.includes('update'), action?.update, 'update'),
    ...has(exports?.operations.includes('delete'), action?.remove, 'remove'),
    ...has(exports?.operations.includes('delete'), action?.exists, 'exists'),
    ...has(exports?.operations.some((o) => o === 'find' || o === 'link'), action?.find, 'find'),
    ...has(exports?.numbers?.set.includes('update'), action?.setNumber, 'setNumber'),
    ...has(exports?.delivery === 'handed_over', limits.run === null, 'run'),
    ...has(data.dives?.import?.operations.includes('list'), adapter.dives?.list, 'list'),
    ...has(data.dives?.import?.operations.includes('list'), adapter.dives?.parse, 'parse'),
    ...has(exports?.requirements.some((r) => r.type === 'site_external_id' && r.createdBySend), adapter.diveSites?.create, 'create'),
    ...has(data.buddies?.export?.operations.includes('add'), adapter.buddies?.add, 'add'),
    ...has(data.buddies?.export?.operations.includes('setAccount'), adapter.buddies?.setAccount, 'setAccount'),
  ];
}

export function createProviderRegistry(adapters: ProviderAdapter[]): ProviderRegistry {
  const byId = new Map(adapters.map((a) => [a.id, a]));
  if (byId.size !== adapters.length) throw new Error('Two Providers share an id');
  for (const adapter of adapters) {
    const missing = unbacked(adapter);
    if (missing.length > 0) throw new Error(`Provider ${adapter.id}: ${missing.join(', ')} declared but not offered`);
  }
  return {
    list: () => adapters,
    get(id) {
      const adapter = byId.get(id);
      if (!adapter) throw new ProviderServiceError('provider_unsupported', { id, name: id });
      return adapter;
    },
  };
}

/** What a Provider operation refuses with; the routes answer each through PROVIDER_STATUS. */
export type ProviderRefusal =
  | 'dive_not_found' | 'diver_not_found' | 'connection_not_found' | 'site_not_found' | 'waiting_push_not_found' | 'invalid_input'
  | 'encryption_key_missing' | 'fetch_interval_too_short' | 'external_id_taken'
  | 'provider_unsupported' | 'provider_wrong_credentials' | 'provider_already_connected' | 'provider_account_taken' | 'provider_account_held'
  | 'provider_other_account' | 'provider_not_connected' | 'provider_sign_in_needed' | 'provider_requirements_unmet' | 'provider_not_sent'
  | 'provider_dive_gone' | 'provider_busy' | 'provider_number_taken' | 'provider_numbers_off' | 'provider_number_nothing_to_set'
  | 'provider_site_unknown' | 'provider_buddy_not_found' | 'provider_import_off'
  | 'provider_unavailable' | 'provider_refused' | 'provider_not_stored'
  | 'push_run_active' | 'push_run_nothing_to_send' | 'push_run_not_found' | 'push_run_not_active' | 'push_run_going' | 'push_run_not_stopped';

/** A refusal about a Provider, answered with its problem code and the Provider named. */
export class ProviderServiceError extends Error {
  constructor(
    readonly code: ProviderRefusal,
    readonly provider?: { id: string; name: string },
    /** More for the client, such as what is unmet (`provider_requirements_unmet`). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

const PROBLEM_OF: Record<ProviderError['reason'], ProviderRefusal> = {
  wrong_credentials: 'provider_wrong_credentials', signed_out: 'provider_sign_in_needed', refused: 'provider_refused', not_stored: 'provider_not_stored',
  unavailable: 'provider_unavailable', bad_response: 'provider_unavailable',
  // No code of its own yet: the service that calls `setAccount` decides what a gone entry means.
  not_found: 'provider_refused',
};

/** An adapter's error as a refusal with a problem code; anything else (a bug) passes through as it is. */
export const asProblem = (error: unknown, adapter: ProviderAdapter) =>
  error instanceof ProviderError ? new ProviderServiceError(PROBLEM_OF[error.reason], named(adapter)) : error;

export const named = (adapter: ProviderAdapter) => ({ id: adapter.id, name: adapter.capabilities.name });

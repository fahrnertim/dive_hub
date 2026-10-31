// The remote dive a Dive has at a Provider now, and the fingerprint it would get (ADR 0024, 0030). Apart from the push
// service so that the import, the send and the gone-dive check can all use it without importing one another (ADR 0053).
import type { loadOutgoingDive } from './push/outgoing-dive.js';
import type { ProviderAdapter } from './provider.js';
import { forProvider, offersListEntries, unmetRequirements } from './requirements.js';

export { currentRemote, type PushRow } from './current-remote.js';

/**
 * What the Provider's fingerprint of the Dive is now, as it would get it (without the Participants an advisory
 * requirement leaves out): a link made from the Provider's own dive records it, so the Dive shows up to date (ADR 0030).
 */
export function fingerprintNow(adapter: ProviderAdapter, loaded: Awaited<ReturnType<typeof loadOutgoingDive>>): string | null {
  const exports = adapter.capabilities.data.dives?.export;
  if (!adapter.dives || !exports) return null;
  return adapter.dives.fingerprint(forProvider(loaded.outgoing, unmetRequirements(exports.requirements, loaded.site, loaded.outgoing, { listEntries: offersListEntries(adapter.capabilities) })));
}

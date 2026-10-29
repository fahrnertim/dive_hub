// The registry refuses an adapter whose declared Capabilities its methods don't back (ADR 0027): the generic layer
// trusts the declaration and calls the method.
import { describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '../src/providers/provider.js';
import { createProviderRegistry } from '../src/providers/registry.js';
import { createSsiAdapter } from '../src/providers/ssi/ssi-adapter.js';
import type { SsiClient } from '../src/providers/ssi/ssi-client.js';
import { createFakeHandover } from './fake-handover-provider.js';
import { createFakeLedger } from './fake-ledger-provider.js';

const ledger = () => createFakeLedger({ imports: true }).adapter;
const withoutAction = (adapter: ProviderAdapter, method: 'update' | 'remove' | 'exists' | 'setNumber'): ProviderAdapter => ({
  ...adapter, dives: { ...adapter.dives!, open: (ctx) => ({ ...adapter.dives!.open(ctx), [method]: undefined }) },
});

describe('createProviderRegistry', () => {
  it('takes the adapters this instance and its tests register', () => {
    const adapters = [createSsiAdapter({ client: {} as SsiClient }), ledger(), createFakeHandover().adapter];
    expect(createProviderRegistry(adapters).list()).toEqual(adapters);
  });

  it.each(['update', 'remove', 'exists', 'setNumber'] as const)('refuses a declared operation without its method: %s', (method) => {
    expect(() => createProviderRegistry([withoutAction(ledger(), method)])).toThrow(`ledger: ${method}`);
  });

  it('refuses an import of dives without list and parse', () => {
    const { list: _list, ...dives } = ledger().dives!;
    expect(() => createProviderRegistry([{ ...ledger(), dives }])).toThrow('ledger: list');
  });

  it('refuses runs for a Provider that hands dives over', () => {
    const handover = createFakeHandover().adapter;
    const limits = { ...handover.capabilities.limits, run: { pauseMs: 1000, maxDives: 3 } };
    expect(() => createProviderRegistry([{ ...handover, capabilities: { ...handover.capabilities, limits } }])).toThrow('handover: run');
  });

  it('refuses list entries and created sites declared without their methods', () => {
    const ssi = createSsiAdapter({ client: {} as SsiClient });
    expect(() => createProviderRegistry([{ ...ssi, buddies: { find: ssi.buddies!.find } }])).toThrow('ssi: add');
    expect(() => createProviderRegistry([{ ...ssi, diveSites: { find: ssi.diveSites!.find } }])).toThrow('ssi: create');
  });
});

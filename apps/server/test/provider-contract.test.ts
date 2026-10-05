// Every Provider adapter passes the same contract (ADR 0027): SSI against the fake SSI, and the two test-only adapters
// (hand-over: no ID back; ledger: an ID back, update and delete, no find). A new Provider adds its harness here.
import { createSsiAdapter } from '../src/providers/ssi/ssi-adapter.js';
import { createSsiClient } from '../src/providers/ssi/ssi-client.js';
import type { OutgoingDive } from '../src/providers/provider.js';
import { createFakeHandover } from './fake-handover-provider.js';
import { createFakeLedger } from './fake-ledger-provider.js';
import { computerDive, createFakeSsi, handTypedDive } from './fake-ssi.js';
import { providerContract } from './provider-contract.js';

const dive: OutgoingDive = {
  startsAt: new Date('2026-01-15T08:00:00Z'), utcOffsetSeconds: 7200, durationSeconds: 2400, maxDepthM: 18.2, avgDepthM: 11.4,
  waterTemperatureC: 24, maxTemperatureC: 26, waterType: 'salt', notes: null, siteIds: { ssi: '3314' },
  participants: [], entry: null, exit: null, gases: [{ o2: 32, he: 0 }], gfLow: 40, gfHigh: 85, cnsStart: 0, cnsEnd: 12,
  device: { manufacturer: 'garmin', product: 'Descent Mk3', serialNumber: '0111', firmware: '1.0' },
  samples: { depth: { offsetsMs: [0, 60_000, 2_340_000, 2_400_000], values: [0, 18.2, 3, 0] } },
};

providerContract('SSI', () => {
  const fake = createFakeSsi({
    buddies: [{
      owner: 5_012_047, id: 3_786_888, buddy_master_id: 4_989_164, firstname: 'Kai', lastname: 'Lund',
      email: 'kai@example.com', dob: '1980-01-02', phone: '+49 170 000000', city: 'Kiel',
    }],
  });
  let clock = 0;
  return {
    // The clock moves on with every action, so a kept logbook never hides what the fake changed.
    adapter: createSsiAdapter({ client: createSsiClient({ url: 'https://ssi.invalid/app/a21.php', fetch: fake.fetch, userAgent: 'DiveHub (test)' }), now: () => (clock += 5 * 60_000) }),
    signIn: { kind: 'password', login: 'erika@example.com', password: 'ssi-password' },
    wrongSignIn: { kind: 'password', login: 'erika@example.com', password: 'wrong' },
    secrets: ['ssi-password', 'token-'],
    dive,
    expire: () => fake.expireTokens(),
    outage: (on) => { fake.failWith = on ? 503 : null; },
    deleteThere: (remoteId) => { fake.dives.get(Number(remoteId))!.odin_user_log_deleted = 1; },
    participant: { diverId: 'kai', name: 'Kai', role: 'buddy', ids: { ssi: '4989164' } },
    seedDives: () => {
      fake.addDive(5_012_047, handTypedDive({ at: '2025-08-10 10:00', depthM: 18, minutes: 45, siteId: 3314, buddies: [3_786_888] }));
      fake.addDive(5_012_047, computerDive({ at: '2025-08-11 14:00', depthM: 22, minutes: 40, manufacturer: 'Mares', product: 'Puck 4', serial: '4711' }));
    },
  };
});

providerContract('Hand-over (test only)', () => {
  const fake = createFakeHandover();
  return {
    adapter: fake.adapter,
    signIn: { kind: 'token', token: 'handover-token-1' },
    wrongSignIn: { kind: 'token', token: 'nope' },
    secrets: ['handover-token-1'],
    dive,
    expire: () => fake.expireTokens(),
    outage: (on) => { fake.down = on; },
  };
});

providerContract('Ledger (test only)', () => {
  const fake = createFakeLedger();
  return {
    adapter: fake.adapter,
    signIn: { kind: 'token', token: 'ledger-token-1' },
    wrongSignIn: { kind: 'token', token: 'nope' },
    secrets: ['ledger-token-1'],
    dive,
    expire: () => fake.expireTokens(),
    outage: (on) => { fake.down = on; },
    deleteThere: (remoteId) => { fake.dives.delete(remoteId); },
    participant: { diverId: 'kai', name: 'Kai', role: 'guide', ids: { padi: '77' } },
  };
});

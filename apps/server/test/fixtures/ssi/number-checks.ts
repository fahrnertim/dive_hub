// The owner's checks of how SSI treats a dive's number (ADR 0048), run by `round-trip.ts number`. Run on 2026-10-10 except
// for a verified dive; the results are in docs/references/ssi-app-api.md.
// It writes to the real SSI account: throwaway dives dated 2000, which it deletes again.
import { createRecord, deleteRecord, writableRecord, type DiveForSsi } from '../../../src/providers/ssi/ssi-record.js';
import type { SsiClient, SsiRecord } from '../../../src/providers/ssi/ssi-client.js';

export interface NumberChecks {
  client: SsiClient;
  /** What SSI calls carry (the Connection's access, or a fresh sign-in's token). */
  access: string;
  accountId: string;
  /** A site in the account's logbook for the throwaway dives; else the first one the logbook has. */
  siteId?: string | undefined;
  log: (line: string) => void;
  /** Between the steps, to look at the app (the script's `--pause`). */
  wait?: (what: string) => Promise<void>;
  /** A verified dive, only if the owner wants to risk one: set its number and show it before and after. */
  dive?: { id: string; to: number } | undefined;
  /** Only read: show the dives with these SSI numbers (their SSI ID, start and whether they have a profile). */
  lookup?: number[] | undefined;
}

export async function runNumberChecks(o: NumberChecks): Promise<void> {
  const { client, access, accountId, log } = o;
  const wait = o.wait ?? (async () => {});
  const account = { token: access, accountId };
  if (o.lookup?.length) {
    const dives = (await client.logbook(access)).dives;
    const size = (v: unknown) => (typeof v === 'string' ? v.length : Array.isArray(v) ? v.length : v == null ? 0 : -1);
    log(`SSI logbook: ${dives.length} dives (highest number ${Math.max(0, ...dives.map((d) => Number(d.odin_user_log_nr) || 0))})`);
    for (const n of o.lookup) {
      const found = dives.filter((d) => Number(d.odin_user_log_nr) === n);
      if (!found.length) log(`number ${n}: no dive in the SSI logbook`);
      for (const d of found) {
        log(`number ${n}: SSI ID ${d.odin_user_log_id}, start ${d.odin_user_log_datetime}, site ${d.odin_user_log_dive_sites_id}, depth ${d.odin_user_log_depth_max ?? d.odin_user_log_maxdepth ?? '?'}`);
        log(`   profile: depthDataset ${size(d.odin_user_log_depthDataset)} characters, diveSamples ${size(d.odin_user_log_diveSamples)} characters, tempDataset ${size(d.odin_user_log_tempDataset)}; computer "${d.odin_user_log_diveComputer ?? ''}", reference "${d.odin_user_log_divecomputer_dive_ref ?? ''}", ssiOrigin ${JSON.stringify(d.ssiOrigin ?? null)}`);
      }
    }
    return;
  }
  const read = async () => (await client.logbook(account.token)).dives;
  const numberOf = (d: SsiRecord | undefined) => (d ? Number(d.odin_user_log_nr) : null);
  if (o.dive) {
    // A verified dive: only if the owner wants to risk one. Putting the number back doesn't bring a verification back.
    const { id, to } = o.dive;
    if (!Number.isInteger(to)) throw new Error('the number needs to be a whole number');
    const show = (d: SsiRecord | undefined, label: string) =>
      log(`${label}: number ${numberOf(d)}, ssiOrigin ${JSON.stringify(d?.ssiOrigin ?? null)}`);
    const dive = (await read()).find((d) => String(d.odin_user_log_id) === id);
    if (!dive) throw new Error(`SSI dive ${id} not found`);
    show(dive, 'before');
    await client.save(account.token, { ...writableRecord(dive), odin_user_log_nr: to, internalPk: to });
    show((await read()).find((d) => String(d.odin_user_log_id) === id), 'after');
  } else {
    // The site most of the account's dives use: one SSI certainly accepts (the first of the list may be one it drops dives for).
    const logbook = await client.logbook(access);
    const uses = new Map<string, number>();
    for (const d of logbook.dives) {
      const site = String(d.odin_user_log_dive_sites_id ?? '');
      if (site && site !== 'null' && site !== '0') uses.set(site, (uses.get(site) ?? 0) + 1);
    }
    const commonest = [...uses.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const siteSsiId = o.siteId ?? commonest ?? logbook.sites[0]?.id;
    log(`0. site for the throwaway dives: ${siteSsiId ?? '-'} (${o.siteId ? 'given' : `used by ${uses.get(siteSsiId ?? '') ?? 0} of ${logbook.dives.length} dives`}; ${logbook.sites.find((x) => x.id === siteSsiId)?.name ?? 'name not in the list'})`);
    if (!siteSsiId) throw new Error('the SSI logbook has no site to put the throwaway dives at: give a site ID');
    const base: DiveForSsi = {
      startsAt: new Date('2000-01-01T12:00:00Z'), utcOffsetSeconds: 0, durationSeconds: 1800, maxDepthM: 12, avgDepthM: 8,
      waterTemperatureC: 20, maxTemperatureC: 21, waterType: 'fresh', notes: 'Dive Hub number test – delete me',
      siteSsiId, participants: [], entry: null, exit: null, gases: [{ o2: 21, he: 0 }], gfLow: null, gfHigh: null,
      cnsStart: null, cnsEnd: null, device: null,
      samples: { depth: { offsetsMs: [0, 300_000, 900_000, 1_500_000, 1_800_000], values: [0, 12, 12, 3, 0] }, temperature: { offsetsMs: [0], values: [20] } },
    };
    // 1. the logbook as it is
    const before = await read();
    const numbers = new Map(before.map((d) => [String(d.odin_user_log_id), numberOf(d)]));
    const top = Math.max(0, ...[...numbers.values()].map((n) => n ?? 0));
    log(`1. logbook: ${before.length} dives, highest number ${top}`);
    const created: string[] = [];
    const references = new Map<string, string>();
    const runId = Date.now().toString(36);
    const make = async (startsAt: string, number: number) => {
      const dive = { ...base, startsAt: new Date(startsAt) };
      // New for every run: SSI may merge a dive with an earlier one that has the same reference.
      const reference = `divehub-number-test-${number}-${runId}`;
      const { id } = await client.save(account.token, createRecord(dive, { number, accountId: account.accountId, reference }));
      created.push(id);
      references.set(id, reference);
      log(`   saved ${reference} for account ${account.accountId}; SSI answered dive ID ${id}`);
      return id;
    };
    const isOurs = (d: SsiRecord) => String(d.odin_user_log_divecomputer_dive_ref ?? '').startsWith('divehub-number-test-');
    // A dive just saved may not be in the next read yet (the adapter knows it as "not found again"): look a few times,
    // by SSI's ID and by our reference, and say what the logbook has when it isn't there.
    const find = async (id: string, patient = true) => {
      for (let attempt = 1; ; attempt++) {
        const dives = await read();
        const found = dives.find((d) => String(d.odin_user_log_id) === id)
          ?? dives.find((d) => references.has(id) && d.odin_user_log_divecomputer_dive_ref === references.get(id));
        if (found && String(found.odin_user_log_id) !== id) log(`   (dive ${id} found by its reference, with ID ${found.odin_user_log_id})`);
        if (found || !patient || attempt === 6) {
          if (!found && patient) {
            const ours = dives.filter(isOurs);
            log(`   NOT FOUND: the read has ${dives.length} dives (before: ${before.length}); ${ours.length} with our reference: ${ours.map((d) => `${d.odin_user_log_id}/nr ${d.odin_user_log_nr}`).join(', ') || '-'}`);
            log(`   the 5 highest IDs: ${dives.map((d) => String(d.odin_user_log_id)).sort((x, y) => Number(y) - Number(x)).slice(0, 5).join(', ')}`);
          }
          return found;
        }
        log(`   (dive ${id} is not in the logbook read yet, read ${attempt}; waiting 3 s)`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    };
    const report = async (label: string, id: string) => {
      const d = await find(id);
      log(`  ${label}: odin_user_log_nr ${numberOf(d)}, internalPk ${d?.internalPk ?? null}`);
      return d;
    };
    try {
      // 2. two dives
      const a = await make('2000-01-01T12:00:00Z', top + 1);
      const b = await make('2000-01-02T12:00:00Z', top + 2);
      log(`2. created A (${a}) as ${top + 1} and B (${b}) as ${top + 2}`);
      // 3. does an update change the number?
      const aRecord = await find(a);
      if (!aRecord) throw new Error(`dive A (${a}) is not in the SSI logbook after being created, even after waiting`);
      await client.save(account.token, { ...writableRecord(aRecord), odin_user_log_nr: top + 3 });
      let after = await report(`3. A saved with odin_user_log_nr ${top + 3}`, a);
      if (numberOf(after) !== top + 3) {
        await client.save(account.token, { ...writableRecord(aRecord), odin_user_log_nr: top + 3, internalPk: top + 3 });
        after = await report(`3. A saved again with internalPk ${top + 3} too`, a);
      }
      log(`   -> ${numberOf(after) === top + 3 ? 'the number moved' : 'the number did NOT move'}`);
      await wait(`Is dive A number ${top + 3} in the app?`);
      // 4. a number twice on an update
      const bRecord = await find(b);
      if (!bRecord) throw new Error(`dive B (${b}) is not in the SSI logbook`);
      const aNumber = numberOf(await find(a));
      try {
        await client.save(account.token, { ...writableRecord(bRecord), odin_user_log_nr: aNumber, internalPk: aNumber });
        log('4. B saved with A\'s number: accepted');
      } catch (error) {
        log(`4. B saved with A's number: refused (${(error as Error).message})`);
      }
      await report('   B now', b);
      await report('   A now', a);
      await wait('Look at both dives in the app.');
      // 5. a number twice on a create
      try {
        const c = await make('2000-01-03T12:00:00Z', aNumber as number);
        log(`5. C (${c}) created with A's number ${aNumber}: accepted`);
        await report('   C now', c);
      } catch (error) {
        log(`5. C created with A's number: refused (${(error as Error).message})`);
      }
      await wait('Look at the dives in the app.');
    } finally {
      // 6. delete what was made, and anything an earlier run left (our reference); what does a delete do to the others' numbers?
      let deleted = 0;
      const leftovers = (await read()).filter(isOurs);
      for (const d of leftovers) {
        await client.save(account.token, deleteRecord(d));
        deleted++;
      }
      const missing = created.filter((id) => !leftovers.some((d) => String(d.odin_user_log_id) === id));
      if (missing.length) log(`   NOT DELETED, not in the logbook read: ${missing.join(', ')} (notes "Dive Hub number test – delete me", 2000): delete them by hand in the MySSI app`);
      const last = await read();
      const moved = last.filter((d) => numbers.has(String(d.odin_user_log_id)) && numbers.get(String(d.odin_user_log_id)) !== numberOf(d));
      log(`6. deleted ${deleted} throwaway dives; dives from step 1 whose number changed: ${moved.length}`);
      for (const d of moved) log(`   ${d.odin_user_log_id}: ${numbers.get(String(d.odin_user_log_id))} -> ${numberOf(d)}`);
    }
  }
}

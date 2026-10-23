---
title: "Plan: everything a dive has on both sides, both ways (piece 2 of the SSI app alignment)"
summary: Piece 2 of the SSI app alignment design - one ProviderDive core shared by import and export with a per-field direction declaration; Dive Hub sends SSI the dive type, the tank of a one-Cylinder Dive, the lead, the surface interval, heart rate, and tank pressure, CNS and heart rate in the samples; the SSI import reads the same back into the Recording it makes; the owner checks a freedive and the pressure curve in SSI's app.
status: ready
date: 2026-10-23
---

# Everything a dive has on both sides, both ways: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every value that both Dive Hub and SSI keep for a dive goes both ways. Today the send leaves out the dive
type, the tank, the lead, the surface interval, heart rate and tank pressure, and the import ignores most of them.

**Architecture:** `provider.ts` gets a `ProviderDive` core that `OutgoingDive` and `ImportedDive` both extend. It also
gets `DIVE_FIELDS` and an optional `Capabilities.data.dives.fields` that says which way each value goes.
`loadOutgoingDive` reads the new values from the Dive, its Cylinders, its Lead and its Primary recording.
`ssi-record.ts` writes them into SSI's keys and samples, `ssi-import.ts` reads them back, and `dive-import.ts` puts them
into the Recording it makes from an SSI computer dive. Two checks on the owner's account come last.

**Tech Stack:** TypeScript (ESM, Node), vitest against a real PostgreSQL, the fake SSI in `apps/server/test/fake-ssi.ts`,
tsx for the check script.

**Spec:** [docs/superpowers/specs/2026-10-23-ssi-app-alignment-design.md](../specs/2026-10-23-ssi-app-alignment-design.md),
"The pieces, in order", item 2, and the Architecture table row for piece 2. Background: the
[review](../../research/2026-10-23-ssi-decompilation-review.md) section 2 (first block), the
[opportunities note](../../research/2026-10-22-ssi-app-opportunities.md) sections 1 to 3, the
[SSI reference](../../references/ssi-app-api.md), and [ADR 0057](../../decisions/0057-ssi-aligned-with-its-app.md)
(proposed), "Both ways".

## Global Constraints

- No `odin_*` key outside `apps/server/src/providers/ssi/` and its tests ([ADR 0027](../../decisions/0027-providers-as-adapters.md)). Module rules of [ADR 0053](../../decisions/0053-module-boundaries.md): routes → services → db, no cycles (not even through a type import), and imports between modules only as `MODULE_IMPORTS` in `.dependency-cruiser.cjs` allows.
- The User-Agent stays `Dart/3.12 (dart:io)` ([ADR 0049](../../decisions/0049-ssi-app-user-agent.md)). Nothing logs a URL, a token or a password.
- `docs/decisions/**`, migrations and `db/schema.ts` are protected paths: each edit asks the owner. This plan needs none of them, and an edit there is a mistake. Since [ADR 0058](../../decisions/0058-providers-and-auth-not-asked.md), `providers/` no longer asks.
- Tests never reach SSI; they use `test/fake-ssi.ts`. Tests come first. At most one `vi.fn` per test, no `vi.mock`. A test that needs the database runs against the real PostgreSQL, as `changed-since-sent.test.ts` does.
- Commands: one file with `pnpm --filter @dive-hub/server exec vitest run test/<file>.test.ts`; before each commit `pnpm check` (green); before a push `pnpm check:full`.
- The values (from ADR 0057 and the review):
  - Dive type: apnea 6, CCR 8, SCR 4, two or more gases 2, else 0. Read back: 6 and 7 apnea, 8 and 9 CCR, 4 and 5 SCR, 0 to 3 open circuit.
  - Tank: one Cylinder only; tank type 19 steel, 20 aluminium.
  - Lead: `weight_kg` and `weight_lb`.
  - Surface interval: `si_before` in minutes; the app accepts only 3 to 1440 [R].
  - Samples: tank pressure `pr: {t, v}`, heart rate `hb`, CNS `cn`; `o` is "open circuit".
- Values from a Recording stay send-only on a Dive that has one ([design](../specs/2026-10-23-ssi-app-alignment-design.md), "Values from a Recording"). This piece adds no field to the three-way comparison (`SYNCED_FIELDS`). Tank and lead are already in it.
- ADR 0057 is proposed; don't edit it. A task that would change an accepted ADR stops with `STOP: <reason>`.
- Owner's account: the owner signed in with `round-trip.ts read`, and the token is kept in `samples/private/ssi/`. Before an agent runs a check mode with that token, it announces it in one line (the mode and what it writes). Test dives are dated in 2000 and noted "Dive Hub test", and they are deleted afterwards. The password never reaches an agent.

## Review Focus

1. **A Dive without a Recording** has no dive mode, no surface interval and no heart rate. An update must leave SSI's dive type, `si_before` and heart rate as they are; a create sends dive type 0. Test in Task 3.
2. **A Dive with two or more Cylinders** sends no tank, so SSI's tank fields stay; a Dive with none sends none either. Test in Task 3.
3. **An SSI dive marked as training** (7, "freediving training") that Dive Hub sends as apnea keeps 7, not 6. Likewise 1, 3, 5 and 9 for their base types. Test in Task 3.
4. **A surface interval outside 3 to 1440 minutes** (2 min, or 3 days after the last dive) sends `null`, never a value the app throws away. The same holds on the way back. Tests in Task 3 and Task 5.
5. **A series that is missing, shorter than the profile, or with gaps.** Without a tank pressure series there is no `pr` key at all (not `"pr":null`); a series that ends early holds its last value, as temperature does today. Test in Task 4.

Known consequence (my call, not a defect): the fingerprint covers the new values, so every Dive sent before this piece
shows as "changed since sent" once it ships. That is true, because SSI lacks those values. The finish summary says so.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `apps/server/src/providers/provider.ts` | modify | `ProviderDive`, `ProviderSamples`, `DIVE_FIELDS`, `DiveField`, `Capabilities.data.dives.fields` |
| `apps/server/src/providers/three-way.ts`, `dive-import.ts` | modify | `SyncedField` ⊂ `DiveField`; `hubOf` compares only fields the Provider imports; `asRecording` takes the new values |
| `apps/server/src/providers/outgoing-dive.ts` | modify | reads dive mode, one Cylinder, lead total, surface interval, heart rate, three more channels |
| `apps/server/src/providers/routes.ts` | modify | `dives.fields` in the capabilities answer |
| `apps/server/src/providers/ssi/ssi-dive-type.ts` | create | dive mode ↔ SSI dive type; keeping a training variant |
| `apps/server/src/providers/ssi/ssi-record.ts` | modify | new keys in `ownFields`, samples, datasets, read-back |
| `apps/server/src/providers/ssi/ssi-import.ts` | modify | reads the new keys and sample keys |
| `apps/server/src/providers/ssi/ssi-adapter.ts` | modify | declares `fields` |
| `apps/web/src/i18n/locales/en.json`, `de.json` | modify | names of the new read-back fields |
| `apps/server/test/…` | modify / create | `provider-contract.ts`, `outgoing-dive.test.ts` (new), `ssi-record.test.ts`, `ssi-import.test.ts`, `ssi-dive-import.test.ts`, `ssi-target.test.ts` |
| `apps/server/test/fixtures/ssi/round-trip.ts` | modify | mode `values start` / `values finish` |
| `docs/references/ssi-app-api.md`, `docs/spec/architecture.md`, `docs/spec/clients.md`, `docs/research/…` | modify / create | what is sent now, the [T] results, `dives.fields` |

---

### Task 1: The ProviderDive core and the per-field directions

**Files:**
- Modify: `apps/server/src/providers/provider.ts`, `apps/server/src/providers/three-way.ts`, `apps/server/src/providers/dive-import.ts` (`hubOf`), `apps/server/src/providers/routes.ts` (capabilities schema and answer)
- Test: `apps/server/test/provider-contract.ts`, `apps/server/test/three-way.test.ts`, `apps/server/test/ssi-dive-import.test.ts`

**Interfaces:**
- Produces, in `provider.ts`:
  - `ProviderSamples = { depth?: Series; temperature?: Series; ndl?: Series; tankPressure?: Series; heartRate?: Series; cns?: Series }`. Each value may be `undefined`, as today. Units: m, °C, s, bar, bpm, %.
  - `interface ProviderDive`: the fields `OutgoingDive` and `ImportedDive` share today (`durationSeconds`, `maxDepthM`, `avgDepthM`, `waterTemperatureC`, `maxTemperatureC`, `entry`, `exit`, `siteIds`, `device`, `gases`, `gfLow`, `gfHigh`, `cnsStart`, `cnsEnd`, `notes`), `samples: ProviderSamples`, `cylinder: ProviderCylinder | null`, `leadKg: number | null`, plus new ones: `diveMode: DiveMode | null`, `surfaceIntervalSeconds: number | null`, `avgHeartRate: number | null`.
  - `OutgoingDive extends ProviderDive`; it keeps `startsAt`, `utcOffsetSeconds`, `waterType` and `participants`.
  - `ImportedDive extends ProviderDive`; it keeps its own fields.
  - `ProviderCylinder` gets `workingPressureBar?: number | null`. It is not compared and is used only for `tank_vol_cuft`.
  - `DIVE_FIELDS = ['site', 'notes', 'buddies', 'cylinder', 'lead', 'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC', 'maxTemperatureC', 'gas', 'device', 'profile', 'diveType', 'surfaceInterval', 'heartRate', 'tankPressure', 'cns'] as const`, and `type DiveField`.
  - `Capabilities.data.dives.fields?: Partial<Record<DiveField, ('import' | 'export')[]>>`. Absent means what it means today: every synced field is imported.
- Produces, in `three-way.ts`: `SYNCED_FIELDS` typed `satisfies readonly DiveField[]`.

- [ ] **Step 1: Write the failing tests.**
  - `provider-contract.ts`, for every registered adapter: "declares each value's directions only for directions it has". A field with `'import'` needs `dives.import`, and a field with `'export'` needs `dives.export`.
  - `three-way.test.ts`: "every synced field is a dive field" (`SYNCED_FIELDS.every((f) => DIVE_FIELDS.includes(f))`).
  - `ssi-dive-import.test.ts`: "a field the Provider doesn't import is never taken back". Register a test adapter whose `fields` gives `notes: ['export']`, change the notes at the fake, re-import, and expect the notes on the Dive unchanged and no conflict.
- [ ] **Step 2: Run them** with `pnpm --filter @dive-hub/server exec vitest run test/provider-contract.test.ts test/three-way.test.ts test/ssi-dive-import.test.ts`. Expected: they fail (the names are not defined).
- [ ] **Step 3: Implement** the types above. Then in `hubOf` (dive-import.ts), filter `fields` further: a field stays when `capabilities.data.dives?.fields` is absent, or when its entry includes `'import'`. In routes.ts, the capabilities answer adds `dives.fields` (`Type.Optional(Type.Record(Type.String(), Type.Array(Type.Union([Type.Literal('import'), Type.Literal('export')]))))`, described as "Which way each value of a dive travels; absent: every value both ways the Provider's operations allow"). `parseSsiDive` and `loadOutgoingDive` return `null` for the new fields until Tasks 2 and 5. The literals that build these shapes get the new fields as `null` (`diveMode`, `cylinder`, `leadKg`, `surfaceIntervalSeconds`, `avgHeartRate`), so the typecheck stays green: `test/ssi-record.test.ts` (`dive()`), `test/ssi-adapter.test.ts`, `test/provider-contract*.ts`, `test/fake-ledger-provider.ts`, `test/fixtures/ssi/round-trip.ts` and `number-checks.ts`.
- [ ] **Step 4: Run** the three files again and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "ProviderDive: one core for import and export, and the directions a Provider declares per value".

### Task 2: What leaves Dive Hub of a Dive

**Files:**
- Modify: `apps/server/src/providers/outgoing-dive.ts`
- Create: `apps/server/test/outgoing-dive.test.ts`

**Interfaces:**
- Consumes: `ProviderDive` from Task 1; `cylindersOf`, `providerCylinderOf` (`dives/cylinders.ts`); `leadOf`, `leadTotalKg` (`dives/weighting.ts`, wherever `dive-import.ts` imports them from).
- Produces: `loadOutgoingDive(...)` returns the same shape with these filled:
  - `diveMode`: `summary.diveMode ?? null`.
  - `cylinder`: `providerCylinderOf(c)` plus `workingPressureBar` when the Dive has exactly one Cylinder, else `null`.
  - `leadKg`: `leadTotalKg(entries)`, the total of all entries.
  - `surfaceIntervalSeconds`: `summary.surfaceIntervalSeconds ?? null`.
  - `avgHeartRate`: `summary.avgHeartRate ?? null`.
  - `samples`: adds the channels `tankPressure`, `heartRate` and `cns` of the Primary recording, if it has them.

- [ ] **Step 1: Write the failing tests** in `outgoing-dive.test.ts`. Set up as `changed-since-sent.test.ts` does (a FIT upload with `makeSyntheticDive`), then call `loadOutgoingDive(t.db, userId, diveId)`.
  - "carries the Primary recording's dive mode, surface interval and heart rate": `diveMode: 'open_circuit'`, `surfaceIntervalSeconds: 86_400`, `samples.heartRate.values` all 80, and `avgHeartRate` as the summary has it (the FIT adapter stores `session.avg_heart_rate`; the synthetic file may have none, so then `null`).
  - "an apnea session is apnea": upload with `subSport: 'apneaDiving'`, expect `diveMode: 'apnea'`.
  - "the tank of a Dive with one Cylinder, none with two": PATCH `cylinders` to one entry `{ volumeL: 12, workingPressureBar: 232, material: 'steel', o2: 32, he: 0, startPressureBar: 200, endPressureBar: 50 }`, then expect `cylinder` to match it. Then PATCH two Cylinders, and expect `cylinder: null`.
  - "the lead is the total of its entries": PATCH `lead` to `[{ amountKg: 4 }, { amountKg: 2 }]`, expect `leadKg: 6`; with no entries, `leadKg: null`.
  - "a Dive without a Recording has no dive mode, surface interval or heart rate" (a Dive made with `POST /api/dives`): all three `null`, and `samples` `{}`.
- [ ] **Step 2: Run it.** Expected: FAIL (the values are still `null` or missing).
- [ ] **Step 3: Implement** in `loadOutgoingDive`. Read the series of `['depth', 'temperature', 'ndl', 'tankPressure', 'heartRate', 'cns']` in the one existing query.
- [ ] **Step 4: Run it**, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "The outgoing Dive carries its dive mode, one tank, the lead, surface interval and heart rate".

### Task 3: SSI's dive type, tank, lead, surface interval and heart rate, and their read-back

**Files:**
- Create: `apps/server/src/providers/ssi/ssi-dive-type.ts`
- Modify: `apps/server/src/providers/ssi/ssi-record.ts` (`ownFields`, `updateRecord`, `COMPARED_FIELDS`, `compareReadBack`), `apps/web/src/i18n/locales/en.json` and `de.json` (the read-back field names, beside `"profile": "Profile samples"`)
- Test: `apps/server/test/ssi-record.test.ts` (its `dive()` fixture changes `diveMode` from `null` to `'open_circuit'`)

**Interfaces:**
- Produces, in `ssi-dive-type.ts`:
  - `ssiDiveType(mode: DiveMode | null, gasCount: number): number | null`. Returns `null` when the mode is `null` and there are no gases (nothing is known).
  - `diveModeOfSsi(type: unknown): DiveMode | null`, for Task 5.
  - `keepTraining(remote: unknown, ours: number | null): number | null`. Gives SSI's value when it equals `ours + 1` and `ours` is even; otherwise `ours`.
- Produces, in `ssi-record.ts`: `ownFields` also sets these keys (all `null` when the value is unknown):
  - `odin_user_log_dive_type` from `ssiDiveType(d.diveMode, d.gases.length)`.
  - `odin_user_log_tank_vol_l` (1 decimal).
  - `odin_user_log_tank_vol_cuft`: `volumeL × workingPressureBar / 1.01325 / 28.3168`, 1 decimal; only with a working pressure.
  - `odin_user_log_pressure_start_bar` and `_end_bar` (whole bar); `_start_psi` and `_end_psi` (× 14.5038, whole).
  - `odin_user_log_var_tanktype_id`: steel 19, aluminium 20, else `null`.
  - `odin_user_log_weight_kg` (1 decimal) and `_lb` (× 2.20462, 1 decimal).
  - `odin_user_log_si_before`: minutes, rounded; only from 3 to 1440, else `null`.
  - `odin_user_log_heartRateAvg`: `avgHeartRate`, else the mean of the heart rate series; whole bpm.
  - `odin_user_log_heartRateMin` and `_heartRateMax` from the series; whole bpm.
- `updateRecord` puts `keepTraining(remote.odin_user_log_dive_type, own type)` over the dive type. `null` still leaves SSI's value, as for every key.
- `COMPARED_FIELDS` adds `'diveType', 'tankVolumeL', 'startPressureBar', 'endPressureBar', 'leadKg', 'surfaceInterval', 'heartRate'`.

- [ ] **Step 1: Write the failing tests** in `ssi-record.test.ts`, in a new `describe('values both sides keep')`:
  - "the dive type from the dive mode and the gases": apnea 6, ccr 8, scr 4, open_circuit with two gases 2, open_circuit with one gas 0, gauge 0; `ssiDiveType(null, 0)` is `null`.
  - "an update keeps SSI's training variant": remote 7 with apnea → 7; remote 6 with open circuit → 0; remote 3 with two gases → 3.
  - "a Dive without a Recording leaves SSI's dive type, surface interval and heart rate" (Review Focus 1): `updateRecord({ ...remote, odin_user_log_dive_type: 6, odin_user_log_si_before: 90, odin_user_log_heartRateAvg: 70 }, dive({ diveMode: null, gases: [] }))` keeps 6, 90 and 70. `createRecord` of the same dive has `odin_user_log_dive_type: 0`.
  - "the tank of the one Cylinder": `cylinder: { volumeL: 12, workingPressureBar: 232, material: 'steel', startPressureBar: 200, endPressureBar: 50, gas: { o2: 32, he: 0 } }` gives `tank_vol_l: 12`, `tank_vol_cuft: 97`, `pressure_start_bar: 200`, `_psi: 2901`, `pressure_end_bar: 50`, `_psi: 725`, `var_tanktype_id: 19`. Carbon gives tank type `null`. Without a working pressure, cuft is `null`.
  - "no tank: SSI's tank stays" (Review Focus 2): `updateRecord` of a remote with `tank_vol_l: 15` and `cylinder: null` keeps 15.
  - "the lead in kg and lb": `leadKg: 6` gives `weight_kg: 6`, `weight_lb: 13.2`.
  - "the surface interval in minutes, only where the app takes it" (Review Focus 4): 5400 s → 90; 120 s → `null`; 259 200 s → `null`; 86 400 s → 1440.
  - "heart rate from the summary, else the series": `avgHeartRate: 82` gives Avg 82. Without it, a series `[70, 90, 80]` gives Avg 80, Min 70, Max 90.
  - In `describe('read-back')`: "names a dive type, tank, lead, surface interval or heart rate SSI stored differently". Change each of these in `stored` and expect its field name. A tank volume within 0.06, and the surface interval and heart rate within 1, are no difference.
- [ ] **Step 2: Run** `vitest run test/ssi-record.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement** `ssi-dive-type.ts` and the `ssi-record.ts` changes above. Add the seven names to both locale files under the same object as `"profile"`:

  | Key | en | de |
  |---|---|---|
  | `diveType` | Dive type | Tauchgangsart |
  | `tankVolumeL` | Tank volume (L) | Flaschenvolumen (L) |
  | `startPressureBar` | Start pressure (bar) | Anfangsdruck (bar) |
  | `endPressureBar` | End pressure (bar) | Enddruck (bar) |
  | `leadKg` | Weight (kg) | Blei (kg) |
  | `surfaceInterval` | Surface interval (min) | Oberflächenpause (min) |
  | `heartRate` | Average heart rate (bpm) | Durchschnittliche Herzfrequenz (bpm) |

- [ ] **Step 4: Run** the file, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "SSI receives the dive type, the tank, the lead, the surface interval and heart rate".

### Task 4: Tank pressure, heart rate and CNS in SSI's samples

**Files:**
- Modify: `apps/server/src/providers/ssi/ssi-record.ts` (`SsiSample`, `resample`, `samplesJson`, `ownFields` datasets)
- Test: `apps/server/test/ssi-record.test.ts`, `describe('profile')`

**Interfaces:**
- Produces:
  - `resample(samples: ProviderSamples, durationSeconds: number, closedCircuit = false): SsiSample[]`.
  - `SsiSample` gains optional `pr?: { t: number; v: number }`, `hb?: number` and `cn?: number`.
  - `o` is `!closedCircuit`. `ownFields` passes `d.diveMode === 'ccr' || d.diveMode === 'scr'`, and the old comment about piece 2 goes.
  - Values:
    - `pr`: `t: 0` (the first tank; whether the app counts from 0 is [?] until Task 7), `v` the tank pressure interpolated linearly, 1 decimal.
    - `hb`: heart rate held from the last reading, whole bpm.
    - `cn`: CNS held from the last reading, whole %.
  - `samplesJson` writes each of the three only when the sample has it, after `rv`, in the order `pr`, `hb`, `cn`. `pr` is written as `{"t":0,"v":182.5}`, with a decimal point as the other decimals have.
  - `ownFields` adds `odin_user_log_tankPressureDataset` and `odin_user_log_heartRateDataset`: one value per sample, as `listJson`. Each is `null` without its series.

- [ ] **Step 1: Write the failing tests:**
  - "carries tank pressure, heart rate and CNS where the Recording has them": a pressure series `[0 ms: 200, 1 820 000 ms: 50]` gives `pr.v` 200 at `t = 0` and about 125 halfway; heart rate and CNS hold.
  - "leaves the keys out without a series" (Review Focus 5): `samplesJson(resample(...))` contains no `"pr"`, `"hb"` or `"cn"`, and the datasets are `null`.
  - "a series that ends early holds its last value" (Review Focus 5): a pressure series ending at 600 000 ms gives its last value up to the end.
  - "a rebreather dive is not open circuit": `ownFields(dive({ diveMode: 'ccr' }))`'s samples all have `"o":false`; open circuit and apnea have `"o":true`.
  - "writes the new keys with decimals where the app expects them": `"pr":{"t":0,"v":200.0}`.
- [ ] **Step 2: Run** the file. Expected: the new tests fail.
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run** the file, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "SSI's samples carry tank pressure, heart rate and CNS; open circuit follows the dive mode".

### Task 5: The SSI import reads the same values back

**Files:**
- Modify: `apps/server/src/providers/ssi/ssi-import.ts` (`samplesOf`, `parseSsiDive`), `apps/server/src/providers/dive-import.ts` (`asRecording`)
- Test: `apps/server/test/ssi-import.test.ts`, `apps/server/test/ssi-dive-import.test.ts`

**Interfaces:**
- Consumes: `diveModeOfSsi` (Task 3), `ProviderSamples` (Task 1).
- Produces:
  - `parseSsiDive` fills these:
    - `diveMode`: `diveModeOfSsi(odin_user_log_dive_type)`.
    - `surfaceIntervalSeconds`: `si_before × 60` when it is from 3 to 1440, else `null`.
    - `avgHeartRate`: a positive `heartRateAvg`, else `null`.
    - `samples.tankPressure` from `pr.v` of the lowest tank index seen (other tanks are left out; my call), `samples.heartRate` from `hb`, `samples.cns` from `cn`.
    - Without `diveSamples`, `tankPressure` and `heartRate` come from `odin_user_log_tankPressureDataset` and `_heartRateDataset` on the 5 s grid, as depth does.
    - A logbook entry (evidence `logbook`) keeps `samples: {}` as today, and its dive mode, surface interval and heart rate are read anyway.
  - `asRecording` writes the channels `tankPressure`, `heartRate` and `cns` when present, and puts `diveMode`, `surfaceIntervalSeconds` and `avgHeartRate` into the summary when not `null`.

- [ ] **Step 1: Write the failing tests:**
  - `ssi-import.test.ts`: "reads the dive type as a dive mode": 6 apnea, 7 apnea, 8 ccr, 5 scr, 2 open_circuit, missing or 42 `null`.
  - "reads the surface interval in minutes, only where the app takes it": 90 → 5400; 2 → `null`; 2000 → `null`.
  - "reads tank pressure, heart rate and CNS from the samples, and the datasets without them". Samples with `pr: { t: 0, v: 200 }`, `hb: 80` and `cn: 5`, plus one sample with `pr: { t: 1, v: 150 }`, give `tankPressure` without the 150. A record without samples, but with `tankPressureDataset: '[200.0,190.0]'`, gives two values at 0 and 5000 ms.
  - `ssi-dive-import.test.ts`: "a dive SSI's app synced from a computer becomes a Recording with its dive mode, surface interval, heart rate and tank pressure". Use `computerDive` from `fake-ssi.ts` with these keys added, import it, and expect the Recording's summary to have `diveMode`, `surfaceIntervalSeconds` and `avgHeartRate`, and its channels to include `tankPressure`, `heartRate` and `cns`.
  - "the values of a Recording are not taken back onto a Dive that has one": change `dive_type` at the fake for a Dive made from a FIT file and linked, re-import, and expect the Primary recording's `diveMode` unchanged, no conflict, and no Revision.
- [ ] **Step 2: Run** both files. Expected: the new tests fail.
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run** both files, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "The SSI import reads the dive type, surface interval, heart rate and tank pressure into its Recording".

### Task 6: SSI declares its directions; a send through the fake SSI carries everything

**Files:**
- Modify: `apps/server/src/providers/ssi/ssi-adapter.ts` (`capabilities.data.dives.fields`), `apps/server/test/fake-ssi.ts` (only if it drops a key it should keep), `docs/spec/clients.md` (the Provider capabilities section)
- Test: `apps/server/test/ssi-target.test.ts`, `apps/server/test/ssi-adapter.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: SSI's `fields` declares both ways for `site`, `notes`, `buddies`, `cylinder`, `lead`, `startsAt`, `durationSeconds`, `maxDepthM`, `avgDepthM`, `waterTemperatureC`, `maxTemperatureC`, `gas`, `device`, `profile`, `diveType`, `surfaceInterval`, `heartRate`, `tankPressure` and `cns`.

- [ ] **Step 1: Write the failing tests:**
  - `ssi-adapter.test.ts`: "declares every dive value both ways". `capabilities.data.dives.fields` has an entry for each name in `DIVE_FIELDS`, and each entry is `['import', 'export']`.
  - `ssi-target.test.ts`, in `describe('sending a Dive')`: "sends the dive type, the tank, the lead, the surface interval, heart rate and tank pressure". On the Dive of the existing setup (a FIT upload), PATCH one Cylinder (as in Task 2) and `lead: [{ amountKg: 6 }]`, then send. The fake's stored record matches `odin_user_log_dive_type: 0`, `odin_user_log_tank_vol_l: 12`, `odin_user_log_pressure_start_bar: 200`, `odin_user_log_var_tanktype_id: 19`, `odin_user_log_weight_kg: 6`, `odin_user_log_si_before: 1440` and `odin_user_log_heartRateAvg: 80` (or the mean of the series), and its samples contain `"hb":80`. The Push's `differences` is `[]`.
  - Same file: "an apnea session goes to SSI as a freedive": an upload with `subSport: 'apneaDiving'` on its own day stores `odin_user_log_dive_type: 6`.
- [ ] **Step 2: Run** both files. Expected: the new tests fail.
- [ ] **Step 3: Implement** the declaration. In `clients.md`, describe `dives.fields` (which way each value of a dive travels; absent means both ways as far as the operations go) and the seven new `readBackFields` names. This is information a client may show, not a new duty.
- [ ] **Step 4: Run** both files, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "SSI declares every dive value both ways; a send carries type, tank, lead, surface interval and heart rate".

### Task 7: Checks on the owner's account, and the reference

**Files:**
- Modify: `apps/server/test/fixtures/ssi/round-trip.ts` (mode `values`; `testDive` gets the new fields), `docs/references/ssi-app-api.md`, `docs/spec/architecture.md` ("Not sent yet"), `docs/research/2026-10-23-ssi-foundation-checks.md` (the expired-token section), `docs/index.md`
- Create: `docs/research/<date of the run>-ssi-values-checks.md`

- [ ] **Step 1: Add the mode** `values start | values finish` to `round-trip.ts`, with its line in the header comment. `start` creates two throwaway dives and prints their SSI IDs; `finish` deletes them and checks they are gone.
  - The dives are dated **2000-01-02** at 10:00 and 14:00. The 2000-01-01 12:00 slot gets no new dive, because of the open "revived ID" case.
  - Dive A, an apnea session: `diveMode: 'apnea'`, no gas, a 2-minute depth series to 10 m, heart rate 60.
  - Dive B, scuba: 12 L steel at 232 bar, 200 → 50 bar with a pressure series, `leadKg` 6, `surfaceIntervalSeconds` 5400, heart rate 80, CNS 3 → 8.
  - `start` also prints the read-back comparison and whether SSI returned each new key as sent. It never prints values of the owner's other dives.
  - It needs `SSI_SITE_ID`, as `write` does.
- [ ] **Step 2: Run** `pnpm check` (the script compiles in the typecheck).
- [ ] **Step 3: Announce and run** `values start` with the kept token: "Check: creates two test dives dated 2000-01-02 at SSI, then waits for you to look in the app". Then ask the owner to look in the MySSI app (pull to refresh):
  - Does dive A show as a freedive?
  - Does dive B show the tank, the weight and the surface interval?
  - Does dive B show the pressure curve, and the heart rate?

  If the token has expired, the owner runs `round-trip.ts read` in their own terminal first.
- [ ] **Step 4: Run `values finish`** once the owner has looked. If a dive stays, give the owner its ID to delete in the app.
- [ ] **Step 5: Write the research note** (`status: done`, or `open` with the reason), one section per question: what was sent (by key name), what SSI stored, what the app showed, and the result with [T], app version 5.0.43. If the pressure curve doesn't show with `t: 0`, say so: the next step is a run with `t: 1`, not a guess in code. Add a line for it to `docs/index.md` under research.
- [ ] **Step 6: Update the docs:**
  - `ssi-app-api.md`: the "Not sent (null)" paragraph loses weight, tank, pressures and surface interval. The record table gains the new keys with [T] links. The samples table: `pr`, `hb` and `cn` are now "sent".
  - `architecture.md` line "Not sent yet": drop "tank and pressures".
  - The foundation checks note's expired-token section gets a line: "Owner, 2026-10-23: never had to sign in again in the SSI app since this work began, so a token probably lasts weeks [S]; the check stays open until `expired` sees one fail."
- [ ] **Step 7: Commit** "SSI checks of the dive type, tank, lead, surface interval and pressure curve; reference updated" (docs and the check script only).

---

## After the last task

The final whole-branch review runs, then the `architecture-review` subagent, then `pnpm check:full` before the push.
The finish summary says that every Dive sent before this piece shows as "changed since sent", and gives the [T] results.

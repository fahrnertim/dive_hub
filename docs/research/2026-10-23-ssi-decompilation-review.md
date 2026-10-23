---
title: SSI integration checked against the decompiled app
summary: What the 2026-10-22 decompilation notes show is wrong in Dive Hub's SSI integration today (an update drops six keys the app writes, among them the User's typed gear notes; an expired token can read as "SSI unavailable"; every sample says "not open circuit"; the dive type is always scuba), what the integration could add, and how the provider architecture could change; nothing decided.
status: open
date: 2026-10-23
---

# SSI integration checked against the decompiled app

Asked by the owner (2026-10-23): check the decompilation results, find what Dive Hub does wrong, how the integration
could grow, and whether the architecture should change. Read: the seven notes of 2026-10-22
([API surface](2026-10-22-ssi-app-api-surface.md), [save keys](2026-10-22-ssi-save-divelog-keys.md),
[write bodies](2026-10-22-ssi-write-bodies.md), [read side](2026-10-22-ssi-read-side.md),
[verification](2026-10-22-ssi-dive-verification.md), [QR formats](2026-10-22-ssi-qr-formats.md),
[opportunities](2026-10-22-ssi-app-opportunities.md)) against `apps/server/src/providers/` (`ssi/*.ts`, `provider.ts`,
`outgoing-dive.ts`). No code changed, nothing sent to SSI. [R] shown in code or by a local run, [?] needs an owner's check.

## 1. What is wrong today

| # | Finding | Where | Effect | Severity |
|---|---|---|---|---|
| 1 | **An update drops six keys the app writes.** `emptyRecord()` lists 341 keys; the app sends 345. Missing: `odin_user_log_gear_details`, `log_extended_data_latitude`, `_longitude`, `_conservatism`, `_decomodel`, `_libdivecomputer_identifier_base64` [R, local diff of `createRecord()` with the key table]. `writableRecord()` keeps only the keys of `emptyRecord()`, so `updateRecord()`, `setNumber` and `deleteRecord()` send SSI's record back **without** them. | `ssi-record.ts` `NULL_FIELDS`, `writableRecord` | If SSI clears a key a save leaves out [?], an update from Dive Hub erases the User's typed gear notes (`gear_details` is free text, e.g. "6KG Blei", [weight research](2026-10-06-weight-calculator.md)) and the computer data SSI's app wrote. Breaks the file's own promise "fields edited in the app survive". | high (until checked) |
| 2 | **An expired token can read as "SSI unavailable".** The app treats a body `{"status":401,…}` as signed out on every call and HTTP status; the capture shows it under **HTTP 404**. `call()` throws `unavailable` for any non-2xx before reading the body, and checks only `authenticated === false`. | `ssi-client.ts` `call` | The Connection's automatic renewal (`connection-service.ts`, on `signed_out`) never runs; the User sees "SSI unavailable" and a Push run counts failures. For `get_divelog` the reference reports `authenticated: false` at 200 [S], so it may only hit some calls [?]. | medium |
| 3 | **Every sample says "not open circuit".** `o` is "open circuit" [R], not "obligation"; `resample()` sends `o: false`. | `ssi-record.ts` `resample` | Wrong for every scuba dive sent; what the app does with it (chart, CCR view) [?]. | low–medium |
| 4 | **Every dive goes as scuba.** `odin_user_log_dive_type` is always `0`; the app has 10 types (6 freediving, 8 CCR, 4 SCR, 2 extended range). | `emptyRecord` | An apnea session or a rebreather dive sent to SSI counts as a scuba dive there. The Primary recording knows the mode (`summary.diveMode`), but `OutgoingDive` doesn't carry it. | medium |
| 5 | **The import ignores the dive type** too. | `ssi-import.ts` | SSI freedives come in as scuba dives. | low |
| 6 | **Booleans sent as numbers.** `odin_user_log_deleted`, `_ean`, `_apple_watch`, `_dive_on_own_risk` go as `0`/`1`; the app sends `true`/`false`. | `emptyRecord`, `ownFields`, `deleteRecord` | SSI stored both forms (reference, 2026-10-09), so harmless today; the import's `ean === 1` would miss a `true`. | low |
| 7 | **Outdated comments.** `decimal()` says SSI's decoder refuses `0`; 5.0.43 takes any number [R]. The buddy capability says "no call to add an entry is known"; `save_buddy` is known with its body. | `ssi-record.ts`, `ssi-adapter.ts` | Misleads the next change. | low |

Checked and right: the User-Agent and fixed parameters, `odin_user_log_date`/`_entry_time`, the next number as highest + 1
(as the app does), one record per call with no parallel calls (the app's own pace), 503 as `unavailable`, a deleted dive
absent from `get_divelog`, the card image address, the surface interval left empty rather than sent in seconds.

**Fragile, not wrong:** the buddy list comes from `logbook_buddies` in `get_divelog`, a key the app does not read (it uses
`get_buddies` → `user_buddies`). SSI could drop it without the app noticing.

## 2. How the integration could grow

Ordered by value for the effort; the first block only fills keys that are `null` today.

| Change | Data in Dive Hub | Needs |
|---|---|---|
| Dive type from the dive mode (or keep apnea out of a Push) | `recording.summary.diveMode` | owner's check that SSI shows it; ADR 0029 note |
| Tank: volume, start/end pressure, tank type 19/20 | `cylinder` rows | amend ADR 0045 ("sends no tank") |
| Lead as `weight_kg`/`_lb` | `leadKg` on import side | amend ADR 0031 |
| Surface interval in minutes (`si_before`) | `summary.surfaceIntervalSeconds` | none |
| Tank pressure in the samples (`pr: {t, v}`) and `tankPressureDataset` | pressure series tied to a Cylinder | a look in the app that the curve shows |
| Add a missing buddy with `save_buddy` instead of leaving the Participant out | Diver's SSI account, name | ADR 0029 amendment; writes to the buddy list |
| "Dives before this logbook" from `get_divelog_history` / `user_no_dives` | ADR 0048 number | one read of the answer's shape |
| Use the save's own answer (`result.dive`, 387 keys) for the read-back | — | see 3.3 |
| SSI gear and gear sets ↔ Equipment items (`get_gear`, `save_gear`) | ADR 0034 items | its own ADR; `get_gearsets` answers 404 for "none" |
| Verify a dive (`divelog_verify`: three IDs) | centre number, leader number | **contradicts ADR 0043**; a product decision, not a technical one |

## 3. Architecture

The provider seam of ADR 0027 holds: the generic layer never reads an `odin_*` key, and the findings above are all
inside `providers/ssi/`. Three changes would make the SSI adapter, and any later Provider, harder to get wrong.

### 3.1 One schema for SSI's dive row, used in both directions

The app reads and writes a dive with the **same** row class ([read side](2026-10-22-ssi-read-side.md)), so the 345
keys with their types are one contract. Dive Hub has it three times by hand: `NULL_FIELDS` + `emptyRecord()` (writes),
`writableRecord()` (round trips) and loose `numberOf`/`text` reads in `ssi-import.ts`. Finding 1 is what that costs.

Proposal: `ssi/ssi-dive-row.ts` declares each key with its type (`int`, `double`, `string`, `bool`, `intList`, `json`)
once. From it: the empty record, the writable copy (every declared key, plus any unknown key SSI returned, so nothing
is dropped), typed getters for the import (a `bool` key accepts `true` and `1`), and a serializer that writes booleans as
booleans and doubles with a decimal point. A test compares the declaration with the key table of the research note, so
a new app version's keys show up as a failing test, not as lost data.

### 3.2 A transport that knows SSI's envelope

`call()` mixes transport and per-call meaning. The app's rules are generic and fit one place: 2xx else error; 503 is
maintenance (retry later); a body `status: 401` is signed out under any HTTP status; a 404 with an empty body is
"nothing here" for list calls. Then each call is a small typed function on top. This fixes finding 2 for every call at
once, and new calls (`get_buddies`, `get_gear`, `save_buddy`, `get_divelog_history`) cost a few lines each. A
`maintenance` reason in `ProviderError` would let a Push run pause instead of counting failures (ADR 0047's
"two failures stop the run").

### 3.3 Read-back from the save's answer

Each save is followed by a full `get_divelog` (about 1.8 MB for the owner's logbook): a run of 100 dives reads it 100
times. The save already answers with the stored record. It cannot replace the read entirely, because SSI's fake
answer to a foreign client (ADR 0049) carries an invented ID; but the run could compare against `result.dive` per dive
and confirm storage with **one** logbook read at the end of the run (or every N dives). The same holds for
`buddies.find` and `diveSites.find`, which today read the whole logbook for a small list (`get_buddies` is about 8 KB).
Needs an ADR 0047 amendment.

### 3.4 One dive shape for both directions

`OutgoingDive` and `ImportedDive` describe the same dive but differ: import has `cylinder` and `leadKg`, export has
neither; neither has the dive mode, the surface interval or tank pressure series. Every one-way gap in section 2
(ADR 0031, 0045 "not sent") is this asymmetry. A shared `ProviderDive` core, with export adding participants and site
IDs and import adding evidence and reference, makes a field Dive Hub reads but never sends visible in the types; a
Provider could then declare per field what it takes, which the client can show ("SSI receives: …").

## 4. Checks only the owner can make

All are writes or reads on the owner's account (ADR 0049 asks for the owner's check first).

1. **Finding 1:** update one dive that has gear notes typed in SSI's app from Dive Hub, then read it back: are
   `gear_details` and `log_extended_data_*` still there? Decides whether finding 1 has already cost data.
2. **Finding 2:** read `get_divelog` with an old token: `authenticated: false` at 200, or `status: 401` under 404?
3. A freedive sent with `dive_type` 6: does SSI's app show it as a freedive?

## 5. Suggested order

1. Schema for the dive row (3.1) with finding 1, 3, 6 and 7 fixed on the way: small, tests first, no new behaviour.
2. Transport (3.2) with finding 2.
3. `ProviderDive` (3.4) and the first block of section 2 (dive type, tank, lead, surface interval), each with its ADR note.
4. Read-back from the save's answer (3.3), with the ADR 0047 amendment.

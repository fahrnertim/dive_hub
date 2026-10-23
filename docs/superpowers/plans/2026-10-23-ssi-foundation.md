---
title: "Plan: SSI foundation (piece 1 of the SSI app alignment)"
summary: Piece 1 of the SSI app alignment design - one declaration of SSI's dive row (345 keys and types) that builds the empty and the writable record, booleans sent as booleans, `o` in samples as open circuit, one transport with the app's envelope rules (a body `status 401` is signed out, 503 is maintenance), the owner's checks for omitted keys and an expired token, and the [T] marker in the SSI reference.
status: open
date: 2026-10-23
---

# SSI foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dive Hub sends SSI exactly the dive row SSI's app sends, with the app's types, and reads SSI's answers by the app's rules.

**Architecture:** A new `ssi-dive-row.ts` declares the app's 345 keys with their types; `ssi-record.ts` builds the empty
and the writable record from it. A new `ssi-transport.ts` takes `call()` out of `ssi-client.ts` and applies the envelope
rules in one place; the client's calls keep only their own meaning. Checks on the owner's account run first (before the
fixes) and last, and go into a dated research note with the new [T] marker.

**Tech Stack:** TypeScript (ESM, Node), vitest, the fake SSI in `apps/server/test/fake-ssi.ts`, tsx for the check script.

**Spec:** [docs/superpowers/specs/2026-10-23-ssi-app-alignment-design.md](../specs/2026-10-23-ssi-app-alignment-design.md),
"The pieces, in order", item 1, and the Architecture table rows for piece 1. Background:
[review](../../research/2026-10-23-ssi-decompilation-review.md) findings 1, 2, 3, 6, 7;
[key table](../../research/2026-10-22-ssi-save-divelog-keys.md); [ADR 0057](../../decisions/0057-ssi-aligned-with-its-app.md) (proposed).

## Global Constraints

- No `odin_*` key outside `apps/server/src/providers/ssi/` and its tests ([ADR 0027](../../decisions/0027-providers-as-adapters.md)); module rules of [ADR 0053](../../decisions/0053-module-boundaries.md).
- The User-Agent stays `Dart/3.12 (dart:io)` ([ADR 0049](../../decisions/0049-ssi-app-user-agent.md)); nothing logs a URL, a token or a password, and no error message contains one.
- `apps/server/src/providers/**` and `docs/decisions/**` are protected paths: each edit asks the owner (hook). Expect the prompt; don't work around it.
- Tests never reach SSI; they use `test/fake-ssi.ts`. At most one `vi.fn` per test, no `vi.mock`. Tests first.
- Commands: one file `pnpm --filter @dive-hub/server exec vitest run test/<file>.test.ts`; before each commit `pnpm check` (green); before a push `pnpm check:full`.
- The generic `ProviderErrorReason` doesn't change in this piece: SSI's `maintenance` maps to `unavailable` (pausing a run on maintenance is piece 6).
- Owner's account ([design](../specs/2026-10-23-ssi-app-alignment-design.md), "Checks"): the owner signs in in their own terminal (`round-trip.ts read`); the password never reaches an agent. An agent may run a check mode with the kept token after announcing it in one line (mode, what it writes). Test dives are dated 2000-01-01 and noted "Dive Hub test", and deleted after.
- A task that would change an accepted ADR stops with `STOP: <reason>`. ADR 0057 is proposed; don't edit it in this piece.

## Review Focus

1. **SSI returns a boolean as `1`/`0`, `'1'`/`'0'` or `true`/`false`.** The writable copy must send a boolean for each of these, and `null` for `null`/missing. Test in Task 2.
2. **An old dive lacks some of the app's keys, or SSI returns keys the app doesn't send.** The writable copy has every key of `SENT_KEYS` (missing ones `null`, never `undefined`) and no other key. Test in Task 2.
3. **The freediving read aliases** (`x_odin_user_log_frd_suit`, `x_odin_user_log_frdwater_body_id`) still fill their keys. Test in Task 2.
4. **A body `{status: 401}` under HTTP 200, 404 and 500, and an HTML body under 404.** The first three are `signed_out`; the last is `unavailable`, not `bad_response`. Test in Task 3.
5. **No secret in the new errors.** The 401 and 503 paths keep the rule of the existing "never puts the password, the token or the URL into an error" test. Test in Task 3.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `apps/server/src/providers/ssi/ssi-dive-row.ts` | create | `DIVE_ROW`: the app's keys in order with their types; `asBool` |
| `apps/server/test/ssi-dive-row.test.ts` | create | `DIVE_ROW` equals the key table |
| `apps/server/src/providers/ssi/ssi-record.ts` | modify | empty and writable record from `DIVE_ROW`; booleans; `o`; `decimal` comment |
| `apps/server/src/providers/ssi/ssi-transport.ts` | create | `call()` with the envelope rules; `SsiError`, `Fetch` move here |
| `apps/server/src/providers/ssi/ssi-client.ts` | modify | uses the transport; re-exports `SsiError`, `Fetch` |
| `apps/server/src/providers/ssi/ssi-adapter.ts` | modify | `maintenance` → `unavailable`; buddy capability comment |
| `apps/server/test/ssi-client.test.ts`, `ssi-adapter.test.ts`, `ssi-record.test.ts`, `ssi-import.test.ts` | modify | the tests of Tasks 2–4 |
| `apps/server/src/providers/ssi/ssi-import.ts` | modify | `asBool` for `ean` and the confirmation flags |
| `apps/server/test/fake-ssi.ts` | modify | stores booleans as `0`/`1`; `expiredAnswer` |
| `apps/server/test/fixtures/ssi/round-trip.ts` | modify | kept-token access; modes `omitted` and `expired` |
| `docs/research/2026-10-23-ssi-foundation-checks.md` | create | the [T] results |
| `docs/references/ssi-app-api.md`, `docs/index.md` | modify | [T] marker, updated entries, index line |

---

### Task 1: Owner checks before the fixes (check-script modes)

The check "do gear notes survive an update that omits them" must run against today's `updateRecord`, so this task comes first.

**Files:**
- Modify: `apps/server/test/fixtures/ssi/round-trip.ts`
- Create: `docs/research/2026-10-23-ssi-foundation-checks.md`

**Interfaces:**
- Produces: modes `omitted start`, `omitted finish`, `expired`; `access()` that signs in when `SSI_EMAIL`/`SSI_PASSWORD` are set, else uses `samples/private/ssi/token.json`. Task 5 uses `write` and `expired` through `access()`.

- [ ] **Step 1: `access()`**: `write`, `number` and the new modes call it instead of `signIn()`. It returns `{ token, accountId }`; with the kept token, `accountId` comes from `token.json` (store `accountId` there in `read` from now on).
- [ ] **Step 2: mode `omitted start`**: creates the test dive as `write` does (2000-01-01 12:00, notes "Dive Hub test – delete me", `SSI_SITE_ID` required), saves its ID to `samples/private/ssi/omitted.json`, prints "Add a gear note to dive <id> in the MySSI app, then run `omitted finish`."
- [ ] **Step 3: mode `omitted finish`**: reads the dive; prints whether `odin_user_log_gear_details` is set (yes/no, never the value); saves `updateRecord(stored, dive with notes "Dive Hub test – updated")` (today's code, which omits the key); reads again; prints whether it is still set; saves both reads to `omitted-before.json`, `omitted-after.json`; deletes the dive with `deleteRecord`; prints "deleted" or "still there".
- [ ] **Step 4: mode `expired`**: with the kept token, calls `get_divelog` through a `fetch` wrapper that records the HTTP status and the body's top-level keys and its `status`/`authenticated` values (no other values); prints the token's age and those; saves them to `expired.json`. Also update the usage line and the header comment.
- [ ] **Step 5: `pnpm check`** → green (the script is QUIET in `scripts/check-lib.mjs`; type errors still fail).
- [ ] **Step 6: owner gate.** Tell the owner: "Please run `pnpm --filter @dive-hub/server exec tsx test/fixtures/ssi/round-trip.ts read` in your terminal (sets the kept token). Then I run `omitted start` (creates one test dive dated 2000-01-01)." Wait for "done". Announce and run `omitted start`; wait for the owner's "gear note added" (or "the app has no gear note field" → record [?] and skip `finish`); announce and run `omitted finish`.
- [ ] **Step 7: run `expired`** (announce: reads the logbook, writes nothing). If the token still works, record its age; the check stays open.
- [ ] **Step 8: write the research note** with frontmatter (`status: open`), one section per check: date, app version 5.0.43, what was sent (key names), what SSI stored (yes/no, key names), result with [T], what it means for the code. Add a line to `docs/index.md` under research.
- [ ] **Step 9: commit** `round-trip.ts`, the note, the index: "SSI checks before the foundation fixes: omitted keys, expired token".

### Task 2: The dive row and the records built from it

**Files:**
- Create: `apps/server/src/providers/ssi/ssi-dive-row.ts`, `apps/server/test/ssi-dive-row.test.ts`
- Modify: `apps/server/src/providers/ssi/ssi-record.ts`, `apps/server/test/ssi-record.test.ts`, `apps/server/test/fake-ssi.ts`

**Interfaces:**
- Produces (`ssi-dive-row.ts`):
  - `type SsiValueType = 'int' | 'double' | 'string' | 'bool' | 'intList' | 'datetime' | 'unknown'`
  - `const DIVE_ROW: readonly (readonly [key: string, type: SsiValueType])[]` – 345 entries, in the table's order
  - `const SENT_KEYS: readonly string[]` – `DIVE_ROW`'s keys plus `odin_user_log_date`, `odin_user_log_entry_time`
  - `function asBool(v: unknown): boolean | null` – `true`/`1`/`'1'` → true; `false`/`0`/`'0'` → false; else null
- Consumes in `ssi-record.ts`: the above; `emptyRecord`, `writableRecord`, `deleteRecord`, `createRecord` keep their signatures.

- [ ] **Step 1: failing test `ssi-dive-row.test.ts`**: `it('declares exactly the keys and types of the app's save (app 5.0.43)')` reads `docs/research/2026-10-22-ssi-save-divelog-keys.md` (path from `import.meta.url`), parses rows with `/^\| \d+ \| `([^`]+)` \| (.+?) \|$/gm`, maps the type cell (`int`, `int?` → `int`; `double?` → `double`; `String?` → `string`; `bool?` → `bool`; `List<int>?` → `intList`; `DateTime?` → `datetime`; else `unknown`), and expects `DIVE_ROW` toEqual the parsed list (345 entries). A second `it` for `asBool` with the eight inputs above plus `null`, `undefined`, `2`, `'yes'` → null.
- [ ] **Step 2: run it** → FAIL (module not found).
- [ ] **Step 3: write `ssi-dive-row.ts`**: generate the array once from the table (a throwaway script in the scratchpad; the doc is not read at runtime) with a header comment naming the table and app version.
- [ ] **Step 4: run it** → PASS.
- [ ] **Step 5: failing tests in `ssi-record.test.ts`**:
  - `createRecord(...)` has exactly the keys of `SENT_KEYS` (sorted equal), and `odin_user_log_deleted === false`, `odin_user_log_apple_watch === false`, `odin_user_log_dive_on_own_risk === false`; `odin_user_log_ean` is `true` for 32 % and `false` for air (change the existing expectations at lines 79 and 97 from `1`/`0`).
  - `writableRecord(remote)` where `remote` has `odin_user_log_gear_details: 'note'`, the five `log_extended_data_*` keys of the review, `odin_user_log_ean: '1'`, `odin_user_log_deleted: 0`, `odin_user_log_apple_watch: true`, an extra key `not_in_the_row: 1`, and lacks `odin_user_log_rating`: keys equal `SENT_KEYS`; the six keys keep their values; `ean === true`, `deleted === false`, `apple_watch === true`; `rating === null`; no `not_in_the_row`.
  - `writableRecord({ x_odin_user_log_frd_suit: 3 })` has `odin_user_log_frd_suit === 3`.
  - `deleteRecord(remote).odin_user_log_deleted === true`.
  - the sample JSON at line 58 expects `"o":true` (open circuit).
- [ ] **Step 6: run them** → FAIL.
- [ ] **Step 7: change `ssi-record.ts`**: `emptyRecord()` = every `SENT_KEYS` key as `null`, then the existing non-null defaults (dive type 0, `diveComputer: ''`, the empty arrays, the three `needs*Upload: false`), with `deleted`, `apple_watch`, `dive_on_own_risk` as `false`; drop `NULL_FIELDS` and the `XR`/`SCR`/`CCR`/`FREEDIVING` lists if nothing else uses them. `writableRecord` loops over `SENT_KEYS`, uses the read aliases as today, and passes `bool` keys through `asBool`. `deleteRecord` sets `true`. `ownFields`: `odin_user_log_ean` `true`/`false`/`null`. `resample`: `o: true`. The `decimal` comment: the app (5.0.43) reads any number; the `.0` stays because it is what the app itself sends [R].
- [ ] **Step 8: fake stores like SSI**: in `fake-ssi.ts`'s `save_divelog`, `stored` turns each `true`/`false` value of a `bool` key of `DIVE_ROW` into `1`/`0` (comment: our assumption of SSI's read side; Task 5 checks it). The delete check at line 227 stays `=== 1`.
- [ ] **Step 9: run** `ssi-record`, `ssi-dive-row`, `ssi-target`, `ssi-client`, `dive-deletion`, `dive-merging` tests → PASS; then `pnpm check` → green.
- [ ] **Step 10: commit** "SSI record built from the app's dive row: all its keys, booleans, open-circuit samples".

Plan's call on the spec's "serializer": the declaration's types are used for booleans only. Doubles in the record go
as JSON numbers (`18`, not `18.0`); the app reads any number [R] and SSI stored Dive Hub's saves that way. The samples
string keeps its `.0` as today.

Note for the reviewer: `fingerprint()` hashes `ownFields`, so every Dive already sent with a profile or a gas shows as "changed since sent" once. That is intended: sending it again fixes the sample flag at SSI.

### Task 3: One transport with the app's envelope rules

**Files:**
- Create: `apps/server/src/providers/ssi/ssi-transport.ts`
- Modify: `apps/server/src/providers/ssi/ssi-client.ts`, `apps/server/src/providers/ssi/ssi-adapter.ts`, `apps/server/test/fake-ssi.ts`, `apps/server/test/ssi-client.test.ts`, `apps/server/test/ssi-adapter.test.ts`

**Interfaces:**
- Produces (`ssi-transport.ts`):
  - `type Fetch` and `class SsiError` moved here unchanged except the reason union gains `'maintenance'`; `ssi-client.ts` re-exports both, so other imports don't change.
  - `interface SsiTransport { call(what: string, params: Record<string, string>, body?: Record<string, unknown>): Promise<Record<string, unknown>> }`
  - `function createSsiTransport(options: { url: string; fetch: Fetch; timeoutMs: number }): SsiTransport`
- Produces (`fake-ssi.ts`): `expiredAnswer: { status: number; body: unknown } | null` (default `null`: today's `authenticated: false` at 200); when set, a call with an unknown token answers with it.

Rules of `call`, in this order (the app's, [review §3.2](../../research/2026-10-23-ssi-decompilation-review.md)):
1. `fetch` throws → `unavailable` (`<what>: <error name>`).
2. Read the body; parse JSON if it parses.
3. An object with `status` `401` or `'401'` → `signed_out`, whatever the HTTP status.
4. Not `authenticate`, and an object with `authenticated === false` → `signed_out`.
5. HTTP 503 → `maintenance`; other non-2xx → `unavailable` (`<what>: HTTP <n>`).
6. Not JSON or not an object → `bad_response`.

- [ ] **Step 1: failing tests in `ssi-client.test.ts`**: in "tells a refused sign-in…", 503 now expects `maintenance`. New `it('reads a body status 401 as signed out under any HTTP status, as the app does')`: for 200, 404 and 500, `fake.expiredAnswer = { status, body: { status: 401 } }` after `expireTokens()` → `logbook` and `save` reject with `signed_out`; an HTML body under 404 → `unavailable`. Extend "never puts the password…" with the 401-under-404 and 503 paths.
- [ ] **Step 2: failing test in `ssi-adapter.test.ts`**: with `fake.failWith = 503`, the adapter's call rejects with a `ProviderError` of reason `unavailable`, and `onCall` (the one `vi.fn`) got outcome `maintenance`.
- [ ] **Step 3: run them** → FAIL.
- [ ] **Step 4: implement**: `ssi-transport.ts` per the rules; `createSsiClient` builds one transport and its calls drop their own `authenticated === false` checks (`signIn` keeps its `wrong_credentials` check, which rule 4 leaves to it). In `ssi-adapter.ts` both places that turn an `SsiError` into a `ProviderError` map `maintenance` to `unavailable`. Fake: `expiredAnswer`.
- [ ] **Step 5: run** `ssi-client`, `ssi-adapter`, `ssi-target`, `ssi-buddies` tests → PASS; `pnpm check` → green.
- [ ] **Step 6: commit** "One SSI transport: a body status 401 is signed out, 503 is maintenance".

### Task 4: Reading SSI's booleans the same way on import

**Files:**
- Modify: `apps/server/src/providers/ssi/ssi-import.ts`, `apps/server/src/providers/ssi/ssi-adapter.ts:46`, `apps/server/test/ssi-import.test.ts`

**Interfaces:**
- Consumes: `asBool` from Task 2.

- [ ] **Step 1: failing test in `ssi-import.test.ts`**: a dive with `odin_user_log_ean: true` and 32 % imports as nitrox 32; `odin_user_log_ean: false` as air; `odin_user_log_divecenter_confirmed: '1'` and `true` give `confirmedByCentre`.
- [ ] **Step 2: run it** → FAIL (the `true` case).
- [ ] **Step 3: implement**: `parseSsiDive`'s nitrox and air tests use `asBool(r.odin_user_log_ean)`; `ssiOrigin`'s `flag` is `asBool(v) === true`. Adapter line 46's comment: `save_buddy` is known (piece 5 adds entries); `find` is all this piece uses.
- [ ] **Step 4: run** `ssi-import`, `ssi-dive-import` → PASS; `pnpm check` → green.
- [ ] **Step 5: commit** "SSI import reads booleans in every form SSI gives them".

### Task 5: Checks after the fixes, the [T] marker, the reference

**Files:**
- Modify: `docs/research/2026-10-23-ssi-foundation-checks.md`, `docs/references/ssi-app-api.md`

- [ ] **Step 1: run `write`** with the kept token (announce: creates one test dive dated 2000-01-01, updates it, deletes it). Record [T]: the full record with booleans is stored; how SSI returns the four booleans (`1`/`0` or `true`/`false`; if not `1`/`0`, fix the fake's comment and coercion from Task 2 and rerun its tests); `deleted: true` deletes. If the dive stays, tell the owner the ID to delete in the app.
- [ ] **Step 2: run `expired`** again if the token has aged since Task 1; record the answer shape [T], or leave the check open with the age reached.
- [ ] **Step 3: reference**: legend gets [T] ("tested on the owner's account, with date and app version"); [R] becomes "read in the app's code or seen on the wire". Each entry that says it was confirmed with the owner's account becomes [T]; entries from the app's code stay [R]. Update: booleans now sent as booleans; the six keys now sent; `o` sent as true; the 401 rule and 503 maintenance; the expired-token line with the Task 1 or Step 2 result. Keep the "keep it current with `ssi-client.ts`" note pointing at `ssi-transport.ts` too.
- [ ] **Step 4: commit** "SSI checks after the foundation fixes; [T] marker in the reference" (docs only; no check needed).

---

## Done when

- `pnpm check:full` is green on the branch.
- The research note has a [T] result (or an open line with the reason) for: omitted keys, expired token, full record with booleans, deleting with `true`.
- The `architecture-review` subagent has run; then the branch is kept or pushed as the owner chooses (never merged locally).

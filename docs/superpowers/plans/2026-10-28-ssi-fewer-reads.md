---
title: "Plan: SSI fewer reads (piece 7)"
summary: Implementation plan for piece 7 of the SSI alignment - SSI's save answer (result.dive) proves storage and is the read-back, so no logbook read follows a save; an answer without a usable record falls back to one logbook read; the answer's record goes into the kept logbook; "Set number" checks the answer too. Client, fake and adapter only.
status: proposed
date: 2026-10-28
---

# SSI fewer reads (piece 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A send to SSI reads the logbook only before the save, never after it: SSI's save answer proves storage and is compared instead.

**Architecture:** `ssi-client.save` hands back the record SSI returns in `result.dive` (when its ID is the answered one). The
adapter's `saveAndReadBack` and `setNumber` check that record (reference, number, samples); a record that passes is the
read-back and goes into the kept logbook; one that is missing or fails is decided by one logbook read, as today. Nothing
outside `providers/ssi/` and the fake changes.

**Tech Stack:** TypeScript, vitest (real PostgreSQL for service tests), `apps/server/test/fake-ssi.ts`.

**Spec:** [design, "Piece 7, settled 2026-10-28"](../specs/2026-10-23-ssi-app-alignment-design.md), [ADR 0057](../../decisions/0057-ssi-aligned-with-its-app.md) (Read-back, amended 2026-10-28), [save answer check](../../research/2026-10-28-ssi-save-answer-check.md).

**Skills to load:** karpathy-guidelines (with [its override](../../skills.md#overrides)), superpowers:test-driven-development (override 3), vitest.

## Global Constraints

- **ADR 0027 seam:** no `odin_*` key outside `apps/server/src/providers/ssi/`. The `Delivered` shape, `ProviderAdapter`, the Push and the client contract don't change.
- **ADR 0053:** module rules unchanged; no new import between modules.
- **ADR 0056 / piece 6:** values, three-way rule, pacing (`pauseMs`, run limits) and the queue untouched. The read before an update, a delete, "Set number" and `exists` stays fresh (`logbook.current()`).
- **ADR 0049:** a save without proof of storage is `ProviderError('not_stored', …)`; the answer alone never turns into `not_stored` — only the fallback read does.
- **Kept logbook:** `SNAPSHOT_MS` (2 min) is not renewed by an answer; a record goes in only when a fresh kept read exists.
- **Tests:** tests first; no `vi.mock`, at most one `vi.fn`; tests never reach SSI. Run `pnpm check`; never grow a lint baseline.
- **No protected-path edits** (migrations, `db/schema.ts`, `docs/decisions/**`); `providers/` no longer asks (ADR 0058).

## Review Focus

1. **A create whose answer carries no record** (SSI changed its answer): stored, one read after, no `not_stored`, no second dive at SSI. Test in Task 2 (`falls back to one read when the answer has no record, and the dive counts as sent`).
2. **A record with fewer samples than sent** (a large profile SSI cut): not taken as the read-back, not kept; the fallback read decides. Test in Task 2 (`a record with fewer samples than sent is decided by a read`).
3. **SSI's invented answer** (another User-Agent): create and update still `not_stored`, nothing in the kept logbook. Existing test in Task 2 (`the SSI adapter and a save SSI drops`) keeps passing unchanged.
4. **Two creates in a row, the second after the kept read expired:** the second reads once before, never after. Test in Task 2 (`reads once to create, and the answer serves the next create`) plus the existing two-minute test.
5. **"Set number" answered with another number in the record:** decided by a read, `not_stored` only if the read shows the old number. Test in Task 2 (`"Set number" takes the answer's record and reads only when it shows another number`).

---

### Task 1: The client hands back SSI's stored record; the fake answers as SSI does

**Files:**
- Modify: `apps/server/src/providers/ssi/ssi-client.ts` (`SsiClient.save` type ~line 102, `save` ~line 235)
- Modify: `apps/server/test/fake-ssi.ts` (`FakeSsi` interface ~line 108, `save_divelog` ~line 311-343)
- Test: `apps/server/test/ssi-client.test.ts`

**Interfaces:**
- Produces: `SsiClient.save(token: string, record: SsiRecord): Promise<{ id: string; stored: SsiRecord | null }>`. `stored` is `result.dive[0]` when `result` is an object, `dive` an array whose first item is an object and its `odin_user_log_id` (as text) equals `id`; else `null`. Errors as today.
- Produces: `FakeSsi.answerRecord: ((stored: SsiRecord) => SsiRecord | null) | null` (default `null`: the record as stored). A function changes the record the answer carries; returning `null` leaves `result.dive` out.

- [ ] **Step 1: Write the failing tests** in `ssi-client.test.ts`, describe `SSI client`:
  - `hands back the record SSI answers a stored save with (result.dive)`: an `answering(...)` fetch with `{ success: { ok: 'updated', error: '', temp_id: '', odin_user_log_id: 28_076_338 }, result: { dive: [{ odin_user_log_id: 28_076_338, odin_user_log_nr: 7 }], divestats: {}, potential_duplicate: 0 } }` → `save` resolves `{ id: '28076338', stored: { odin_user_log_id: 28_076_338, odin_user_log_nr: 7 } }`.
  - `hands back no record when the answer has none or another dive's`: `result: 'updated'` → `stored: null`; `result: { dive: [{ odin_user_log_id: 1 }] }` with answered ID 28_076_338 → `stored: null`; `result: { dive: [] }` → `stored: null`.
  - `the fake answers a stored create and update with the record its logbook lists, and an invented one without it`: with `createFakeSsi()`, a create's `stored` equals `(await app.logbook(token)).dives[0]`; an update's too; the existing other-User-Agent case gets `stored: null`.
- [ ] **Step 2: Run** `pnpm --filter @dive-hub/server exec vitest run test/ssi-client.test.ts` — expected FAIL (`stored` undefined).
- [ ] **Step 3: Implement.** In `save`, read `data.result` (top level; the answer wraps only the ID in `success`) and add `stored`. In the fake: a stored create answers `{ ...record, sql_success: true, sql_NEW_odin_user_log_id: created, success: { ok: 'added to Log', error: '', temp_id: '', odin_user_log_id: created }, result: { dive: [answered], divestats: {}, potential_duplicate: 0 } }` (the check's shape: the record sent is echoed, so its top-level `odin_user_log_id` is `null`; the ID is in `success`); a stored update `{ success: { ok, … }, result: { dive: [answered], divestats: {}, potential_duplicate: 0 } }` — for a delete keep today's `result: ok` (a delete's answer is unchecked); `answered` is the stored record (as `get_divelog` lists it) passed through `fake.answerRecord` when set, `result.dive` left out when that returns `null`. The invented answer becomes `{ success: { ok: 'added to Log', error: '', temp_id: '', odin_user_log_id: <invented> } }` (no `result`, as checked 2026-10-28).
- [ ] **Step 4: Run** the same command — expected PASS. Then `pnpm check`; existing callers (`ssi-adapter.ts`, the check scripts in `test/fixtures/ssi/`) still compile since they destructure `{ id }`.
- [ ] **Step 5: Commit** `SSI client: the save hands back the record SSI answers with (piece 7)`.

### Task 2: The adapter takes the answer as the read-back

**Files:**
- Modify: `apps/server/src/providers/ssi/ssi-adapter.ts` (`SsiCallLog.detail` doc ~line 113, `saveAndReadBack` ~line 212-221, `setNumber` ~line 274-288)
- Test: `apps/server/test/ssi-adapter.test.ts`

**Interfaces:**
- Consumes: Task 1's `save(...) → { id, stored }` and `FakeSsi.answerRecord`.
- Produces (file-local): `confirmed(ctx: ActionContext, sent: SsiRecord, saved: { id: string; stored: SsiRecord | null }, expect: { reference?: string; number?: number }): Promise<SsiRecord>` — the record SSI holds, or throws `not_stored`.

- [ ] **Step 1: Write the failing tests** in `ssi-adapter.test.ts`:
  - Replace `reads once before and once after a create, and the read-back serves the next create` with `reads once to create, and the answer serves the next create`: after `find` + `create`, `reads()` is 1; a second `find` + `create` in a new action: still 1, `remoteNumber` 2.
  - In `always reads afresh to update or delete…`: the update adds 1 read (`before + 1`), the delete 1 more (`before + 2`), the `find` after none (`before + 2`).
  - `falls back to one read when the answer has no record, and the dive counts as sent`: `fake.answerRecord = () => null`; a `create` resolves with a `remoteId` that is in `fake.dives`, `differences` `[]`; `reads()` 2 (before and after); the `onCall` log's second `get_divelog` entry has `detail` containing `no record`.
  - `a record with fewer samples than sent is decided by a read`: a dive with `samples: { depth: { offsetsMs: [0, 60_000, 120_000], values: [0, 10, 0] } }`; `fake.answerRecord = (r) => ({ ...r, odin_user_log_diveSamples: '[]' })`; `create` resolves, `reads()` 2, `differences` `[]` (compared against the logbook's record, not the cut one).
  - `a record with another reference is decided by a read`: `fake.answerRecord = (r) => ({ ...r, odin_user_log_divecomputer_dive_ref: 'other' })`; `create` resolves, `reads()` 2.
  - `"Set number" takes the answer's record and reads only when it shows another number`: after two creates, `setNumber(b, 12)` → `{ result: 'set', remoteNumber: 12 }` with one read (the one before); with `fake.answerRecord = (r) => ({ ...r, odin_user_log_nr: 3 })`, `setNumber(b, 13)` → `set` with two reads (the fake stored 13).
  - Keep unchanged and passing: `the SSI adapter and a save SSI drops`, `refuses a "Set number" SSI answers and does not store`, `reads again once the kept read-back is two minutes old` (update its count if it changes: create 1 read, `find` after 2 min 1 more → `2`).
- [ ] **Step 2: Run** `pnpm --filter @dive-hub/server exec vitest run test/ssi-adapter.test.ts` — expected FAIL on the read counts.
- [ ] **Step 3: Implement `confirmed`** and use it in `saveAndReadBack` (create: `expect.reference` = the reference sent; update: none) and in `setNumber` (`expect.number`). A record passes when it is non-null, its `odin_user_log_divecomputer_dive_ref` equals `expect.reference` when given, its `odin_user_log_nr` (via `numberOf`) equals `expect.number` when given, and it has at least as many samples as `sent.odin_user_log_diveSamples` (count of the JSON list; 0 when null or empty). A passing record goes into the kept logbook when `fresh(ctx.connectionId)` returns one: replace the dive with that ID or append it, keeping `at` (write `snapshots.get(...)!.logbook`, as `remove` does). Else: one `get_divelog` through `called(...)` with `keep(...)`, find the dive by `id` (and for `setNumber` check its number, as today); not found → `not_stored` with today's messages. The fallback read's log line carries `detail`: `read after a save: no record in the answer` or `read after a save: the answer's record has another <reference|number> or fewer samples` — widen the `detail` doc comment ("for a failed call, or why a read followed a save"). `differences` = `compareReadBack(sent, record)`.
- [ ] **Step 4: Run** the same command — expected PASS. Then `pnpm check` (it also runs `gone-dives`, `ssi-dive-times`, `ssi-buddy-api`, push and run tests; their call lists before a save don't change).
- [ ] **Step 5: Update the SSI reference** `docs/references/ssi-app-api.md`: "Reading the logbook" (~line 112: no read after a save; the answer's record is kept) and "When Dive Hub calls SSI" row "Send a dive" (`get_divelog` before only; one more only when the answer lacks a usable record).
- [ ] **Step 6: Commit** `SSI adapter: the save's answer is the read-back, no logbook read after a save (piece 7)`.

### Finish

- [ ] `architecture-review` subagent on the branch; fix findings with `path:line` and the rule.
- [ ] Design: piece 7 in "The pieces, in order" gets "done: [plan](../plans/2026-10-28-ssi-fewer-reads.md)"; this plan's `status: done`.
- [ ] `pnpm check` green → push, open the PR (Superpowers override 5).

---
title: "Plan: SSI buddies (piece 5)"
summary: Implementation plan for piece 5 of the SSI alignment - get_buddies and save_buddy in the SSI client and fake, the Provider's buddies.add and setAccount, the remembered list entry (account_list_entry), the send's automatic add by SSI account and link-later, the diver_mapping requirement met by a remembered entry, the Link or add dialog, entries without an account on the buddy list page and in the dive import, and the Push run report of dives sent without someone.
status: proposed
date: 2026-10-27
---

# SSI buddies (piece 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Participant missing from the User's SSI buddy list gets there: by itself when their Diver has an SSI account, else by the User's Link or add on the Dive's page; never a duplicate, never a guess.

**Architecture:** A generic step before each send (`buddiesForSend`, beside piece 4's `siteForSend`) reads the account's list, adds or links entries by SSI account under an advisory lock and remembers entry IDs in `account_list_entry`; the outgoing Participants then carry their entry ID, and SSI's adapter puts those on the dive. Names and e-mail reach the Provider only through the buddy service's `add`, called from the dialog. The SSI adapter does `add` and `setAccount` with `save_buddy`, and reads the list with `get_buddies`.

**Tech Stack:** TypeScript, Fastify + TypeBox, Drizzle/PostgreSQL, vitest (real PostgreSQL), React + react-aria + TanStack Query, i18next (en, de), Playwright.

**Spec:** [design, "Piece 5, settled 2026-10-27"](../specs/2026-10-23-ssi-app-alignment-design.md), [ADR 0057](../../decisions/0057-ssi-aligned-with-its-app.md) (Buddies, amended 2026-10-27), [buddy checks](../../research/2026-10-27-ssi-buddy-checks.md).

## Global Constraints

- **ADR 0053:** routes → services → db; route files don't import `drizzle-orm`; `db/` imports no domain module; a new import between modules adds its entry to `MODULE_IMPORTS` in `.dependency-cruiser.cjs` with the reason in the commit message; no import cycles, not even type imports; web `ui/` imports no page, `lib/` imports no `api.ts`.
- **ADR 0029:** a send carries only accounts of people. `OutgoingParticipant` gains only `entry` (the ID of an entry in the User's own list, not data of the person). Names and e-mail go to the Provider only from the User's Add them action.
- **ADR 0057 (amended 2026-10-27):** no matching by e-mail or name (matching only sorts the dialog). A send adds an entry by itself only for a Diver with an SSI account, sending only `id: null`, `master_id` and the flags. An entry made without an account is given the account later instead of a second entry. `search_buddy` is never called.
- **ADR 0043:** the buddy code's parts fill only what the Diver lacks (`fillDetails`), and they are shared with every User.
- **ADR 0024:** SSI is only called on a User's action or a Push run step, and each call is logged (`SsiCallLog`). Tests never reach SSI: they use `apps/server/test/fake-ssi.ts`.
- **No protected-path edits:** the table `account_list_entry` and migration 0041 exist already (committed in 4bb248e). Change no migration, `db/schema.ts` or `docs/decisions/**`; if a task seems to need it, `STOP: <reason>`. Don't touch `scripts/agent-lib.mjs`.
- **Tests:** tests first; tests run against real PostgreSQL; at most one `vi.fn`, no `vi.mock`; every browser test carries an area tag (`@dives`, `@account`, `@divers`). Run tests with `pnpm check` (browser tests by hand: `pnpm check --tests <filter>`). Never grow a lint baseline or raise a threshold.
- **Copy (exact):** after an add: "Added {{name}} to your {{provider}} list. It might take some time until they show up in {{provider}}'s app." Wrong account: "{{provider}} knows this account as {{name}}". The dialog's and requirement's texts take the Provider's name and no longer say "add them in SSI's app".
- **Writing a remembered entry writes no Revision.** Other Users never see another account's remembered entries (owners = Users who manage the account's Diver).

## Review Focus

1. **The same Diver twice on one dive, or on several dives of one Push run:** one entry is added, not two. Test in Task 4 (`adds one entry for a Diver on the dive twice`) and Task 5 (`a run adds one entry for a Diver on two dives`).
2. **The remembered entry was deleted in SSI's app** (`deleted: 1`, or gone): it is forgotten, and the Participant is added by account or asked again, never sent with a dead ID. Test in Task 4 (`forgets a remembered entry SSI no longer lists`).
3. **An SSI account typed on the wrong Diver:** after an add or link-later, the answer says "SSI knows this account as <name>", and nothing is undone. Test in Task 4 (`says whom SSI knows the account as when the names differ`).
4. **An entry ID remembered for Diver A is linked by the User to Diver B on the same account:** B gets it and A no longer has it. Two Divers never share an entry, and the unique index never throws at the User. Test in Task 2 (`moves an entry to the Diver it is linked to last`).
5. **Another User of the same Dive Hub** opens the dialog or the list: they never see this account's remembered entries, or entries of a list that isn't theirs. Test in Task 6 (`another User gets connection_not_found and sees no remembered entry`).

---

### Task 1: SSI client, adapter and fake: `get_buddies`, `save_buddy`, `buddies.add` / `setAccount`

**Files:**
- Modify: `apps/server/src/providers/ssi/ssi-client.ts` (interface `SsiClient`, `SsiBuddy`, the client)
- Create: `apps/server/src/providers/ssi/ssi-buddy-row.ts` (the app's buddy row)
- Modify: `apps/server/src/providers/ssi/ssi-adapter.ts:52-53,90-98,104,198-229,306-308`
- Modify: `apps/server/src/providers/provider.ts:88-89` (capability), `:291-305` (`RemoteBuddy`), `:434-437` (`buddies`)
- Modify: `apps/server/test/fake-ssi.ts` (`get_buddies`, `save_buddy`)
- Test: `apps/server/test/ssi-buddies.test.ts` (new); `apps/server/test/provider-contract.test.ts` if it lists capabilities

**Interfaces:**
- Produces (provider.ts):
  - `capabilities.data.buddies?: { import?: Direction; export?: { operations: ('add' | 'setAccount')[] } }`
  - `RemoteBuddy` gains `firstName`/`lastName` as today (already optional) — no new fields.
  - `buddies.add?(context: ActionContext, person: { firstName: string | null; lastName: string | null; email: string | null; account: string | null }): Promise<RemoteBuddy>`: makes an entry in the account's list and answers it as the Provider keeps it.
  - `buddies.setAccount?(context: ActionContext, entryId: string, account: string): Promise<RemoteBuddy>`: gives an existing entry an account and answers it as the Provider keeps it afterwards.
- Produces (ssi-client.ts): `SsiClient.buddies(token: string): Promise<SsiBuddy[]>` (`get_buddies`, `user_buddies`, entries with `deleted: 1` skipped); `SsiClient.saveBuddy(token: string, row: SsiBuddyRow): Promise<SsiBuddy>` (POST `save_buddy`, `json_data`, read from `result.buddy[0]`; an answer without one is an `SsiError` `unexpected`). `SsiBuddy` gains `row: SsiBuddyRow` (the APP_KEYS values as SSI returned them, for a save back; never leaves `ssi/`).
- Produces (ssi-buddy-row.ts): `type SsiBuddyRow = Record<(typeof BUDDY_KEYS)[number], unknown>`; `BUDDY_KEYS` = the 20 keys `id, localRefId, address, dob, comment, added, email, firstname, gender, image, lastname, leader_nr, leader_active, master_id, nickname, phone, deleted, needsUpload, confirmed, favorite`; `newEntryRow(person)` (from scratch: `id: null`, `firstname`, `lastname`, `email` or `""`, `master_id` the account as a number or `null`, flags `0` except `needsUpload: 1`, every other key `null`); `accountOnlyRow(account: string)`, which is **exactly** `{ id: null, master_id: <number>, leader_active: 0, deleted: 0, needsUpload: 1, confirmed: 0, favorite: 0 }` (no name, date or contact keys: buddy check step 8); `withAccountRow(entry: SsiBuddyRow, account: string)` (the entry as SSI returned it, `master_id` set, `needsUpload: 1`).
- `SsiCallLog['call']` gains `'get_buddies' | 'save_buddy'`.

- [ ] **Step 1: Extend the fake.** `FakeSsiBuddy` keeps its shape. `get_buddies` answers `{ user_buddies: [...] }` with the owner's entries, deleted ones included with `deleted: 1`, and `master_id` and `buddy_master_id` both the account (0 without one). `save_buddy` mirrors the [T] findings:
  - `id: null` with a `master_id` some entry of the list already has: answers that entry, with the sent non-null keys written onto it (step 8).
  - `id: null` otherwise: a new entry.
  - An ID: updates that entry in place.
  - `master_id` set on an entry without one: fills `firstname`/`lastname` from a profile map `fake.profiles: Map<number, { firstname: string; lastname: string }>` when it has the account, and sets `confirmed: 1` (step 6).
  - `deleted: 1` keeps the entry, flagged.
  - Answer: `{ id, result: { buddy: [entry] } }`.
  - Every call is recorded in `fake.calls` with its body: add `body?: unknown` to the call record so tests can assert what was sent.
- [ ] **Step 2: Write the failing tests** in `ssi-buddies.test.ts` (adapter against the fake, as in `ssi-sites-api.test.ts`):
  - `find reads get_buddies and skips deleted entries`: the fake has entries 1 (account 4989164), 2 (no account), 3 (`deleted: 1`). `find` answers remoteIds `['1','2']`, the account of 2 is `null`, and `fake.calls` contains `get_buddies` and no `get_divelog`.
  - `add with an account sends only id, master_id and the flags`: `add(ctx, { firstName: null, lastName: null, email: null, account: '4989164' })` sends a body whose keys are exactly `['id','master_id','leader_active','deleted','needsUpload','confirmed','favorite']`, with `master_id: 4989164`.
  - `add from scratch sends the app's row with name and e-mail`: the body has all 20 `BUDDY_KEYS`, with `firstname: 'Dive Hub'`, `lastname: 'test'`, `email: 'x@example.com'` and `master_id: null`. The answer is `{ remoteId: <new id>, name: 'Dive Hub test', account: null }`.
  - `setAccount saves the entry back with the account, and SSI's spelling of the name comes back`: entry 2 without an account, profile 4512484 → `{firstname:'Samuel', lastname:'Dreier'}`. The answer has `account: '4512484'` and `name: 'Samuel Dreier'`, and the body's `id` is 2.
  - `capabilities offer buddies export add and setAccount`.
- [ ] **Step 3: Run** `pnpm --filter @dive-hub/server exec vitest run test/ssi-buddies.test.ts`. Expected: FAIL (`buddies.add` is not a function, or similar).
- [ ] **Step 4: Implement the client, the row builders and the adapter.**
  - The adapter keeps one list read per action, like `logbook.recent()`. A `buddyList(ctx)` reads `get_buddies`; a kept read is dropped after any `save_buddy`.
  - `buddies.find`, the dive `create`/`update` (`buddiesFor`) and the import context (`contextOf` → `people`) all use it instead of `logbook_buddies` (spec: "get_buddies everywhere").
  - `setAccount` finds the entry's `row` in a fresh `get_buddies` read and throws `ProviderError('not_found')` when it is gone.
  - Update the capability comment at line 52.
- [ ] **Step 5: Run** the new test file and `test/ssi-adapter.test.ts`. Expected: PASS. Existing dive tests whose fake buddies came through `get_divelog` still pass, because the fake answers both from `fake.buddies`.
- [ ] **Step 6: Update `docs/references/ssi-app-api.md`:**
  - the `get_buddies` row → [T], and `save_buddy` → [T] with a link to the checks note;
  - the account-only create is marked "sent as the design says; the minimal body itself not checked [?]";
  - Dive Hub's files table gets `ssi-buddy-row.ts`.
- [ ] **Step 7: Commit** `SSI: get_buddies and save_buddy; the Provider's buddies.add and setAccount (piece 5)`.

### Task 2: Remembered list entries and the shared advisory lock

**Files:**
- Create: `apps/server/src/providers/list-entries.ts`
- Create: `apps/server/src/providers/advisory-lock.ts` (move `locked` out of `site-for-send.ts`, unchanged, exported)
- Modify: `apps/server/src/providers/site-for-send.ts` (import `locked`)
- Test: `apps/server/test/list-entries.test.ts` (new)

**Interfaces:**
- Produces (list-entries.ts; `Q` = `Db | Tx`, `source: DiverSource`):
  - `listAccountOf(q: Q, diverId: string, source: DiverSource): Promise<string | null>`: the `diver_external_id.id` of the Diver's account at `source` (the list owner's account row).
  - `rememberedFor(q: Q, accountId: string, diverIds: string[]): Promise<Map<string, string>>`: Diver ID → entry ID.
  - `remember(q: Q, accountId: string, diverId: string, entryId: string): Promise<void>`: sets the Diver's entry. Any other Diver's row with that entry on that account is deleted first, in one transaction, so the last link wins.
  - `forget(q: Q, accountId: string, diverId: string): Promise<void>`.
  - `rememberedEntries(q: Q, accountId: string): Promise<Map<string, string>>`: entry ID → Diver ID, for the list page and the import.
- Produces (advisory-lock.ts): `locked<T>(db: Db, key: string, source: string, clock: Clock, fn: () => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing tests:**
  - `remembers one entry per account and Diver`: `remember(a, d1, '11')` then `remember(a, d1, '12')` → `rememberedFor(a, [d1])` is `{d1 → '12'}`.
  - `moves an entry to the Diver it is linked to last` (Review Focus 4): `remember(a, d1, '11')`, `remember(a, d2, '11')` → `rememberedEntries(a)` is `{'11' → d2}`, and nothing throws.
  - `keeps lists of two accounts apart`: the same entry ID on accounts a and b, for different Divers, both stay.
  - `goes with the account`: deleting the `diver_external_id` row removes its rows (cascade).
  - `writes no Revision`: the count of `revision` rows doesn't change.
- [ ] **Step 2: Run** `pnpm --filter @dive-hub/server exec vitest run test/list-entries.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `list-entries.ts`, and move `locked` to `advisory-lock.ts`.
- [ ] **Step 4: Run** the new file and `test/site-for-send.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Providers: remembered list entries (account_list_entry) and the advisory lock as its own file`.

### Task 3: The outgoing Participant's entry and the requirement it meets

**Files:**
- Modify: `apps/server/src/providers/provider.ts:128-133` (`OutgoingParticipant`)
- Modify: `apps/server/src/providers/outgoing-dive.ts:33-41` (`outgoingParticipants` takes the dive's Diver and the Provider's account source)
- Modify: `apps/server/src/providers/requirements.ts:15,29-34`
- Modify: `apps/server/src/providers/ssi/ssi-adapter.ts:36-37` (requirement description), `:90-98` (`buddiesFor`)
- Modify: `apps/server/src/providers/routes.ts:144` (the `fixes` and left-out descriptions in the schema)
- Test: `apps/server/test/provider-requirements.test.ts` (or the existing file that tests `unmetRequirements`; find it with `grep -l unmetRequirements apps/server/test`), `apps/server/test/ssi-buddies.test.ts`

**Interfaces:**
- Consumes: `listAccountOf`, `rememberedFor` (Task 2).
- Produces:
  - `OutgoingParticipant.entry?: string`: the entry of the dive's Diver's own list at the Provider remembered for this Participant's Diver. It is set only when one is remembered.
  - `Unmet` `diver_mapping`: `fixes: ('diver_external_id' | 'list_entry')[]`. It is met when `p.ids[source]` **or** `p.entry` is set. Unmet ones list both fixes when the Provider offers `buddies.export` `add`, else `['diver_external_id']`.
  - `unmetRequirements(requirements, site, dive, options?: { listEntries?: boolean })`.
  - SSI's `buddiesFor`: the entry is `p.entry` when that is in the list just read. Otherwise it is the list's entry with `p.ids.ssi`. A Participant whose `p.entry` is not in the list and who has no account entry is left out (`not_at_provider`).

- [ ] **Step 1: Write the failing tests:**
  - `a Participant with a remembered entry meets diver_mapping`.
  - `an unmet Participant offers both fixes where the Provider can add`.
  - In `ssi-buddies.test.ts`: `a dive carries the remembered entry of a Participant without an account`. Entry 2 has no account and is remembered for Diver d2. A send of a dive with d2 has `odin_user_log_buddy_ids: [2]` and no `leftOut`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Also update the requirement's description at ssi-adapter.ts:37 to: `'SSI lists buddies from your SSI buddy list; one who isn't there is added when their SSI account is known, else left out until you link or add them.'`
- [ ] **Step 4: Run** the tests, plus `test/ssi-adapter.test.ts` and `test/push*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Providers: a Participant's remembered list entry goes out with the dive and meets the buddy requirement`.

### Task 4: The send's own fix: `buddiesForSend`

**Files:**
- Create: `apps/server/src/providers/buddies-for-send.ts`
- Modify: `apps/server/src/providers/push-service.ts:49-55` (`SendResult`), `:475-490` (call it before `loadOutgoingDive` in `send`)
- Modify: `apps/server/src/providers/routes.ts` (the send answer's schema: `buddies`)
- Test: `apps/server/test/buddies-for-send.test.ts` (new; the app plus the fake, as `site-for-send.test.ts`)

**Interfaces:**
- Consumes: `buddies.find`, `buddies.add`, `buddies.setAccount` (Task 1); `listAccountOf`, `rememberedFor`, `remember`, `forget` (Task 2); `locked` (Task 2).
- Produces:
  - `buddiesForSend(db: Db, args: { adapter: ProviderAdapter; context: ActionContext; ownerDiverId: string; diveId: string; source: DiverSource; clock?: Clock }): Promise<BuddiesForSend>`.
  - `interface BuddiesForSend { added: { diverId: string; name: string }[]; knownAs: { diverId: string; diverName: string; name: string }[] }`. `name` is the entry's name as the Provider answered it.
  - `SendResult` variants `created`, `linked` and `updated` gain `buddies?: BuddiesForSend` (left out when both lists are empty).
  - It does nothing when the adapter has no `buddies.export` or the owner has no account row.
- The algorithm, per Participant Diver of the dive, deduplicated by Diver. It runs inside `locked(db, \`buddies:${accountId}\`, …)` and reads the list once:
  1. `withAccount` = the list's entry whose `account` is the Diver's account at `source` (if any). `remembered` = the list's entry with the remembered ID (if any).
  2. If something is remembered but `remembered` is not in the list: `forget`.
  3. If `withAccount` exists: `remember(withAccount)`, and stop. With two candidates, the one with the account wins, and setAccount is never sent.
  4. Else, if `remembered` exists and the Diver has an account: `setAccount(remembered, account)`, check the name (below), and stop.
  5. Else, if `remembered` exists: stop (it goes out as it is).
  6. Else, if the Diver has an account: `add({ account, firstName: null, lastName: null, email: null })`, `remember` it, add it to `added`, and check the name.
  7. Else: nothing. It is left out and asked on the Dive's page.
- Name check: the answered entry's name is compared, folded (trimmed, lower case, accents removed as in `ProviderPanel`'s `fold`), with the Diver's `firstName lastName`, or with the Diver's name when the Diver has neither. When they differ, the entry goes into `knownAs`.

- [ ] **Step 1: Write the failing tests** (Review Focus 1–3):
  - `adds an entry by SSI account and remembers it`: the Diver has SSI account 4512484 and the list has no such entry. After `send`: exactly one `save_buddy`, its body as in Task 1's account-only test, the dive's `odin_user_log_buddy_ids` holds the new entry ID, `rememberedFor` holds it, and `buddies.added` is `[{ diverId, name }]`.
  - `remembers the entry that has the account and adds nothing`: the list holds account 4512484 as entry 9. Result: no `save_buddy`, and entry 9 is remembered.
  - `gives a from-scratch entry the account later`: entry 2 has no account and is remembered, and the Diver now has an account. Result: one `save_buddy` whose body `id` is 2 and `master_id` the account, no second entry, and the dive carries 2.
  - `prefers the entry with the account over a remembered one without`: remembered 2 has no account, and entry 9 has the account. Result: no `save_buddy`, 9 is remembered, and 2 stays in the fake's list.
  - `forgets a remembered entry SSI no longer lists`: remembered 2 is `deleted: 1`, and the Diver has no account. Result: 2 is forgotten, no `save_buddy`, and the Participant is in `leftOut`.
  - `adds one entry for a Diver on the dive twice`: one Diver as buddy and as guide gives one `save_buddy`.
  - `says whom SSI knows the account as when the names differ`: the profile for the account is "Samuel Dreier" and the Diver is "Lena Berg". Result: `buddies.knownAs` is `[{ diverId, diverName: 'Lena Berg', name: 'Samuel Dreier' }]`, and the entry stays remembered.
  - `never adds from scratch on a send`: a Participant without an account and without an entry gives no `save_buddy` and is in `leftOut`.
- [ ] **Step 2: Run** `pnpm --filter @dive-hub/server exec vitest run test/buddies-for-send.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `buddiesForSend`, and call it in `send` after `siteForSend` and before the second `loadOutgoingDive`. The update path goes through the same `send`, so it gets it too. Keep its result across a retry after sign-in, the way `taken` is kept.
- [ ] **Step 4: Run** the file and `test/push*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Providers: a send adds a buddy by SSI account, links an entry later, never adds from scratch (piece 5)`.

### Task 5: Push runs: one add per Diver, and the dives sent without someone

**Files:**
- Modify: `apps/server/src/providers/push-run-service.ts` (the run's view), `apps/server/src/providers/push-run-routes.ts:37,72-75` (schema)
- Test: the existing Push run test file (`grep -l "pushRuns\|push-run" apps/server/test`), new cases

**Interfaces:**
- Consumes: `buddiesForSend` through `pushes.send` (no change of the step).
- Produces: the run's view gains `withoutSomeone: { diveId: string; startsAt: string; names: string[] }[]`: each item sent (`state: 'sent'`) whose Push recorded a non-empty `leftOut`, in the run's order, with `names` from that `leftOut`. It is read from the run's items and their Pushes: no logbook read, no Review entry.

- [ ] **Step 1: Write the failing tests:**
  - `a run adds one entry for a Diver on two dives`: two dives with the same Diver, who has an SSI account, give exactly one `save_buddy` in `fake.calls`.
  - `a run lists the dives that went without someone`: one dive with a Participant without an account or entry. The finished run's `withoutSomeone` is `[{ diveId, startsAt, names: ['…'] }]`.
- [ ] **Step 2: Run** them. Expected: FAIL (the second; the first may already pass through Task 4's lock and remembering: keep it as a guard).
- [ ] **Step 3: Implement** the view field and its schema.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Push runs: the report lists the dives sent without someone (piece 5)`.

### Task 6: Link or add, through the buddy service and the API

**Files:**
- Modify: `apps/server/src/providers/buddy-service.ts`
- Modify: `apps/server/src/providers/routes.ts:408-430` (`BuddyView`, new routes)
- Modify: `docs/spec/clients.md:503-511` (diver_mapping and leftOut duties; the new dialog duty)
- Test: `apps/server/test/buddy-link-api.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 1, 2 and 4 (`foldName` exported from `buddies-for-send.ts` for the sort), plus `divers.fillDetails`, `divers.createExternal`, and the existing external-ID setter used by `PUT /api/divers/{id}/external-ids/{source}` (with its `diver_external_id_taken`).
- Produces:
  - `Buddy` (the view) gains `entryId: string`. `diver` is now also set for an entry without an account that is remembered for a Diver. A new field `matches: boolean` is true when the entry's name or e-mail matches the `for` Diver (folded, trimmed). The e-mail itself is never in the view.
  - `list(userId, connectionId, options?: { forDiverId?: string }): Promise<Buddy[]>`: the entries with `matches` first, then by name.
  - `link(actor: DiverActor, connectionId: string, entryId: string, diverId: string): Promise<{ diverId: string }>`. For an entry with an account, it sets that account on the Diver (the same rules and error as the PUT) and also remembers the entry. For an entry without one, it only remembers it. An entry not in the list throws `provider_buddy_not_found` (404).
  - `add(actor, connectionId, diverId, person: { firstName: string; lastName: string; email: string | null; account: string | null }): Promise<{ added: { diverId: string; name: string }; knownAs: string | null }>`:
    - it reads the list first, and if an entry has `person.account`, it links that one instead of adding;
    - otherwise it calls `buddies.add`, then remembers the entry;
    - it fills what the Diver lacks (`firstName`, `lastName`, `email`) with `fillDetails`, and sets `person.account` on the Diver when it is given (scanned);
    - `knownAs` is the answered name when it differs (as in Task 4).
    - It holds the same `locked` key as the send.
  - `import(actor, connectionId, accounts: string[], entries?: string[])`: `entries` are entry IDs without an account. Each makes an external Diver from the entry's name and remembers the entry. One already remembered is skipped.
  - Routes:
    - `GET /api/connections/:id/buddies?for=<diverId>`.
    - `POST /api/connections/:id/buddies/link` with body `{ entryId: string, diverId: string }`; 200 `{ diverId }`; 404 `provider_buddy_not_found`; 409 `diver_external_id_taken`.
    - `POST /api/connections/:id/buddies/add` with body `{ diverId, firstName (1–100), lastName (1–100), email?: string (format email) | null, account?: digits | null }`; 200 `{ added, knownAs }`.
    - `POST …/buddies/import` body gains `entries?: string[]`.
    - Each route answers `connection_not_found` for a Connection that isn't the User's.

- [ ] **Step 1: Write the failing tests:**
  - `lists matching entries first, without e-mail`: the Diver is "Samuel Dreier", and the entries are "Anna Alt", "samuel dreier" and "Zoe Zed". The order is samuel, then Anna, then Zoe; `matches` is `[true,false,false]`; and no key `email` is in the JSON.
  - `links an entry without an account and remembers it`.
  - `links an entry with an account: the Diver gets the account`, and `409 diver_external_id_taken` when another Diver has it.
  - `adds a typed person, fills what the Diver lacks, shared with every User`: the body is `{firstName:'Dive Hub', lastName:'test', email:'t@example.com'}`. Result: one `save_buddy` from scratch, the entry remembered, and the Diver's e-mail set (it had none) while its name stays.
  - `adds a scanned code: the Diver gets the account, the entry is added by account`.
  - `an add for an account already in the list links that entry`: no `save_buddy`.
  - `imports an entry without an account as a Diver and remembers it`.
  - `another User gets connection_not_found and sees no remembered entry` (Review Focus 5).
- [ ] **Step 2: Run** `pnpm --filter @dive-hub/server exec vitest run test/buddy-link-api.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the service and routes (no `drizzle-orm` in routes), and update `docs/spec/clients.md`:
  - a Participant not in the list shows Link or add;
  - after an add, the client shows the add message and `knownAs`;
  - a send's `buddies` answer is shown;
  - the run's `withoutSomeone` is listed with links.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Buddies: link or add an entry of the User's list for a Diver (piece 5)`.

### Task 7: The dive import maps remembered entries

**Files:**
- Modify: `apps/server/src/providers/provider.ts:335-338,366-367` (`ImportContext`, `ImportedDive`)
- Modify: `apps/server/src/providers/ssi/ssi-import.ts:29,214`
- Modify: `apps/server/src/providers/dive-import.ts` (where `people` turn into Participants; also line 617's context copy)
- Test: the existing SSI dive import test (`grep -l "people" apps/server/test/*import*.test.ts`), a new case

**Interfaces:**
- Consumes: `rememberedEntries`, `listAccountOf` (Task 2).
- Produces:
  - `ImportContext.remembered?: Record<string, string>`: entry ID → Diver ID, filled by the generic import for the importing account before parsing.
  - `ImportedDive.diverIds?: string[]`: Divers found through a remembered entry for an entry without an account. They become Participants as `people` do, and the dive's own Diver is never one of them.
  - An entry with neither an account nor a remembered Diver is skipped, as today.

- [ ] **Step 1: Write the failing test** `imports a buddy added from scratch as the Diver it is remembered for`: the fake's dive carries entry 2 (no account), and 2 is remembered for d2. The imported Dive has d2 as a Participant.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and every `*import*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Dive import: an entry without an account comes back as the Diver it is remembered for`.

### Task 8: Web: Link or add, the send's answer, the buddy list page, the run report

**Files:**
- Modify: `apps/web/src/ProviderPanel.tsx:290-345` (requirements), `:490-560` (`BuddyPicker` → Link or add)
- Modify: `apps/web/src/ProviderBuddies.tsx` (entries without an account: Link, Import)
- Modify: the Push run report component (`grep -ln withLeftOut apps/web/src`)
- Modify: `apps/web/src/i18n/locales/en.json`, `de.json` (`providers.ssi.*` and the generic `providers.*` keys near lines 1276, 1287, 1550–1560)
- Regenerate the API types the way `docs/development.md` says (the web reads `paths` from the server's OpenAPI)
- Test: `apps/web/e2e/buddies.spec.ts` (new cases), `apps/web/e2e/ui-quality.spec.ts` (the dialog in en/de), `apps/web/e2e/push-run.spec.ts`

**Interfaces:**
- Consumes: Task 6 routes, Task 4's `buddies` in the send answer, Task 5's `withoutSomeone`.
- Produces (UI):
  - On the Dive's page, each unmet Participant offers **Link or add** (button text `Link or add {{diver}}`).
  - The dialog is titled `Who is {{diver}} at {{name}}?` (existing `findTitle`). It shows:
    - the SearchList of entries from `GET …/buddies?for=`, with every entry not yet a Diver's pickable, including those without an account;
    - an "Add them" section with two ways in: `Scan their buddy code` (the existing scanner component from ADR 0043, whose parsed account and names fill the form) and fields `First name`, `Last name` (both required), `E-mail (optional)`; then the button `Add to your {{name}} list`.
  - After an add or a send that added: the announce/Notice text is the Global Constraints copy. When `knownAs` is set, a warning reads `{{provider}} knows this account as {{name}}`, with a link to the Diver's page.
  - The `notInList` text and the `leftOut.not_at_provider` text drop "Add them in SSI's app…". New: `Sent without {{names}}: they aren't in your {{name}} list yet. Link or add them, then update the dive.`
  - `ProviderBuddies` lists entries without an account too. Each has `Link…` (a Diver picker, which calls `…/buddies/link`) and the import checkbox (`entries`).
  - The run report shows `withoutSomeone` as `Sent without someone` with one link per dive (its date) to the Dive's page.

- [ ] **Step 1: Write the failing browser tests** (each tagged):
  - `links a Participant to an entry without an account and sends the dive with them` `@dives`.
  - `adds a typed person to the SSI list from the dive page and shows the add message` `@dives`. It expects the exact text "Added Dive Hub test to your SSI list. It might take some time until they show up in SSI's app.".
  - `shows whom SSI knows the account as` `@dives`.
  - `imports an entry without an account from the buddy list page` `@account @divers`.
  - `the run report lists dives sent without someone` `@dives`.
  - The ui-quality case: the Link or add dialog, en and de, with `expectAccessible`, `@dives`.
- [ ] **Step 2: Run** `pnpm check --tests "Link or add|buddy|without someone"`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and the texts (en and de; German in the existing style, "du").
- [ ] **Step 4: Run** `pnpm check --tests "Link or add|buddy|without someone"`, then `pnpm check`. Expected: PASS. Review the screenshots of the changed UI (the review capture with `REVIEW_AREAS=dives,account`).
- [ ] **Step 5: Commit** `Web: Link or add a buddy on the Dive's page, entries without an account on the list page, dives sent without someone (piece 5)`.

### Task 9: Domain language and the design's pieces list

**Files:**
- Modify: `docs/glossary.md:408-409`
- Modify: `docs/superpowers/specs/2026-10-23-ssi-app-alignment-design.md` (pieces item 5: done, with the plan's link)
- Modify: `docs/index.md` only if it lists plans per file (it lists folders: then no change)

- [ ] **Step 1:** Load the `domain-modeling` skill and read its override.
- [ ] **Step 2:** In the glossary, replace **Connection Diver mapping** with **Remembered list entry**: "The entry of an account's own list of people at a Provider (SSI's buddy list) that Dive Hub remembers for a Diver, per account, not per Connection: set by a link, an add or an import, forgotten when the Provider no longer lists it; a Participant with one goes on a dive at that Provider without an account (ADR 0057)." Keep "Connection Diver mapping" as an alias line that points to it. Also add **Link or add**: "What the Dive's page offers for a Participant the account's list at a Provider doesn't hold: pick an entry, scan the person's buddy code, or type their name; never done by a send."
- [ ] **Step 3: Commit** `Docs: remembered list entry and Link or add in the glossary; piece 5 done in the design`.

### Finish

- [ ] `pnpm check` green. Then the final whole-branch review, then the `architecture-review` subagent; fix findings (at most 5 rounds).
- [ ] Push `ssi-buddies` and open a PR against `main`. The body has the goal, what each piece does, and the [T] notes. It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] Write the hand-over prompt ([working economically](../../agents/working-economically.md)).

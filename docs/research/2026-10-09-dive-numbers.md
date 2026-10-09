---
title: Dive numbers - what the code does today, the owner's answers, and the implementation plan (slice 22b)
summary: A Dive's number is today the dive computer's counter or a typed value; the owner chose a computed number (place by start time plus "dives before this logbook", apnea by a Diver's setting) and a Connection's setting that makes a Provider's numbers follow, never making a duplicate. The step-by-step plan with the SSI check script first, the tests to write first and their seams, the client duties, and the hand-over prompt for the implementation session.
status: decided
date: 2026-10-09
---

# Dive numbers: findings, answers and implementation plan (slice 22b)

Decided in [ADR 0048](../decisions/0048-dive-numbers.md) (proposed until the owner accepts it). This note holds what
the ADR rests on and how to build it. Where it started:
[Push runs, "Dive numbers first"](2026-10-09-push-runs.md#dive-numbers-first-slice-22b).

## What the code does today (read 2026-10-09)
- `dive.number` is one of `OVERRIDABLE_FIELDS` (`apps/server/src/db/schema.ts`). `valuesFromRecording`
  (`dives/dive-values.ts`) fills it from the Recording's `summary.diveNumber`; only the Garmin FIT parser sets that
  (`fit/fit-adapter.ts`, the computer's `dive_number`; left out for Suunto FIT). A Suunto JSON and a Provider's
  logbook entry give none. The edit form has a number field (`apps/web/src/DiveEditForm.tsx`).
- The list searches it (`q` that is a whole number matches `dive.number`) and sorts by it (`apps/server/src/routes.ts`).
- A Dive doesn't store whether it is scuba or apnea. The kind is worked out from the Recording at upload
  (`imports/import-service.ts` `kindOf`: `summary.diveMode === 'apnea'`), and the assessment reads the same value.
- The number is not in `OutgoingDive` and not in a fingerprint. SSI's adapter (`providers/ssi/ssi-adapter.ts`)
  creates with the highest `odin_user_log_nr` in the logbook plus one (`createRecord` also writes it to `internalPk`)
  and an update re-sends SSI's record, number included. The Push keeps the Provider's number (`remote_number`).
- `currentRemote` (`providers/push-service.ts`) takes the newest confirmed Push with a remote ID; "up to date" is
  that Push's fingerprint against the Dive's now.
- `round-trip.ts` (the owner's check script) has `read`, `token` and `write`: nothing changes a number.
- SSI's record has a key `reset_profile_divelog_number_with_deletion` (in `ssi-record.ts`'s list of keys sent as
  null). What it does is unknown; it suggests SSI's app can renumber after a delete. A fourth check below.
- The web client shows the computer's counter nowhere; the API's Recording summary has it (`diveNumber`).

## The owner's answers (2026-10-09)

| Question | Answer |
|---|---|
| The three SSI checks | First step of the build: the implementation session adds a mode to `round-trip.ts`, the owner runs it. The design holds for either result. |
| What the number is | The place by start time among the Diver's Dives plus "dives before this logbook" (per Diver). Always computed, nothing typed per Dive. The computer's counter stays on its Recording; typed numbers are history. |
| Which Dives count | Every Dive that isn't deleted. A setting per Diver says whether apnea sessions count; they count until it is changed. |
| How "use Dive Hub's numbers at SSI" is chosen | A setting on the Connection, off. No tick per send. |
| A number another dive at SSI has | Never make a duplicate: a new dive still goes, numbered "highest plus one", and shows "number differs"; setting a number is refused and names the dive that holds it. |

Settled without asking, in the ADR: the number stays a stored column kept by one module; a Deleted dive has no
number; a Dive without a Recording counts as a dive; a number change is a Push with its own action; turning the
setting on sends nothing; a Push run sets numbers first and in an order that keeps each free.

## Owner's checks (the build's first step)

A new mode of `apps/server/test/fixtures/ssi/round-trip.ts`, run by the owner with their own account; results go to
the [SSI reference](../references/ssi-app-api.md#owners-checks-pending). Everything it creates is a throwaway dive in
the year 2000 that it deletes again.

`round-trip.ts number [--pause]`:
1. Read the logbook; remember every dive's ID and number. `top` = the highest number.
2. Create dive A (2000-01-01 12:00) with `top + 1` and dive B (2000-01-02 12:00) with `top + 2`, as `write` does.
3. **Update changes the number?** Save A's record as read back with `odin_user_log_nr: top + 3` and nothing else
   changed; read back and print A's `odin_user_log_nr` and `internalPk`. If the number didn't move, try once more with
   `internalPk` set as well, and print which it took. Pause: "Is dive A number {top + 3} in the app?"
4. **A number twice on an update?** Save B with A's number. Print whether the save was refused (SSI's error text) or
   what B's and A's numbers are after the read-back. Pause to look in the app.
5. **A number twice on a create?** Create dive C (2000-01-03 12:00) with A's number; print the same.
6. Delete A, B, C; read the logbook and print every dive from step 1 whose number is not what it was (what a delete
   does to the others' numbers).

`round-trip.ts number --dive <SSI dive ID> --to <n>` (**a verified dive**, only if the owner wants to risk one): print
the dive's `ssiOrigin` (confirmed by centre, by leader) and number, save it with the number `n`, print both again.
Putting the number back doesn't bring a verification back.

What each result switches:

| Result | Then |
|---|---|
| step 3: the number moves | SSI declares `set: ['create', 'update']`; the adapter gets `setNumber` and passes the number on an update (with `internalPk` if step 3 needed it) |
| step 3: it doesn't | SSI stays `set: ['create']`; no `setNumber` for SSI. The generic layer is built and tested against the ledger all the same |
| steps 4, 5: refused or kept | Nothing in the code (Dive Hub never sends a taken number). Recorded in the reference; ADR 0047's order stays as planned |
| step 6: other numbers moved | Stop and tell the owner: SSI renumbers by itself, and "number differs" would appear after every delete there. Record it; build on |
| verified dive: verification kept | SSI declares `changeRemovesVerification: false` |
| verified dive: lost, or not run | It stays `true`: the client warns before "Set number", and a Push run needs its second opt-in for these |

## Implementation plan

For a session on Sonnet. Every design choice is in ADR 0048 or here; if something is missing, stop and ask the owner
instead of deciding. Tests first, one at a time (red, then green), in the order below. Line numbers are of 2026-10-09
(commit 773fda7): search for the name if they moved.

### Order of work
1. The check script's mode (above). Tell the owner it is ready and how to run it; go on with step 2 meanwhile.
2. The computed number (server, then web).
3. The Provider side against the ledger (server).
4. SSI's adapter, as far as the checks allow. If the owner hasn't run them by then, build SSI as `set: ['create']`,
   `changeRemovesVerification: true`, and say so in the hand-over.
5. Web for the Provider side, client contract, documents.

### Seams the tests sit at
1. **The HTTP API** (`app.inject` on `createTestApp`, `apps/server/test/support.ts`), with the fake SSI
   (`test/fake-ssi.ts`) and the ledger (`test/fake-ledger-provider.ts`). Numbers and states are read through the API
   (`GET /api/dives`, `GET /api/dives/{id}`, `GET /api/dives/{id}/providers/{provider}`), what a Provider got through
   the fakes' own records. Not from tables.
2. **The adapter** as the generic layer calls it (`ssi-adapter.test.ts`: `open(ctx).create/update/setNumber` against
   the fake SSI client) and the **contract suite** (`test/provider-contract.ts`).
3. **The browser** (`apps/web/e2e`), at the User's level.

There is no pure function to test apart: the numbering is one SQL statement and is tested through seam 1.

### Server: the computed number

**Data** (one migration generated with drizzle-kit from the schema, then one custom migration,
`drizzle-kit generate --custom`, for the data; both reviewed and committed; never `push`):
- `diver.dives_before integer not null default 0` with a check `between 0 and 100000`;
  `diver.apnea_counts boolean not null default true`.
- `dive.number` stays `integer`, nullable. Its comment in the schema says what it is now and who writes it.
- The custom migration: `update dive set overrides = array_remove(overrides, 'number') where 'number' = any(overrides)`,
  then the renumbering statement below for every Diver (without the `diver_id = any(...)` conditions).
  Run it on the development database and look at the logbook: numbers 1 to n by date, none missing.

**`apps/server/src/dives/dive-numbers.ts`** (new): `renumber(tx, diverIds: string[])`. Deep on purpose: callers say
"these Divers' Dives changed" and nothing else.
1. `select id from diver where id = any($ids) order by id for no key update` (two renumberings of a Diver wait for
   each other; inserts of Dives are not held up).
2. One statement:
   ```sql
   with numbered as (
     select d.id,
            case when d.deleted_at is null and (dv.apnea_counts or coalesce(r.summary->>'diveMode', '') <> 'apnea')
              then dv.dives_before + row_number() over (
                partition by d.diver_id,
                  (d.deleted_at is null and (dv.apnea_counts or coalesce(r.summary->>'diveMode', '') <> 'apnea'))
                order by d.starts_at, d.id)
            end as n
     from dive d
     join diver dv on dv.id = d.diver_id
     left join recording r on r.id = d.primary_recording_id
     where d.diver_id = any($ids)
   )
   update dive d set number = numbered.n from numbered
   where d.id = numbered.id and d.number is distinct from numbered.n
   ```
   Raw SQL through `tx.execute`, so that neither `version` nor `updated_at` changes (check how `updatedAt()` in the
   schema is kept: if by Drizzle's `$onUpdate`, raw SQL leaves it; if by a database trigger, stop and ask).
3. It is the last statement on Dives in its transaction. A caller that has no transaction opens one.

**Who calls it** (each inside the transaction that made the change; search for `insert(dive)`, `update(dive)`,
`update dive`):

| Where | When | Divers |
|---|---|---|
| `dives/dive-service.ts` create from a Recording (near :156) | always | the Dive's |
| `dives/dive-service.ts` `edit` (near :122), reset from the Primary (near :189), attach a Recording (near :239), and wherever the Primary recording is changed or detached | the start time or the Primary recording changed | the Dive's |
| `dives/dive-service.ts` delete (near :305), restore (near :333) | always | the Dive's |
| `dives/merging.ts` (near :154, :176, :181, :190) | always | the kept Dive's, and the other Diver's when a Dive moves |
| `providers/dive-import.ts` (near :321, :343, :509) | a Dive made, or its start time or Primary recording changed | the Dive's; once per import run is enough if the run has one transaction per Dive, call it per Dive |
| `users/user-admin.ts` (near :119, `primary_recording_id = null`) | always | the Dives' |
| `divers/` the PATCH below | `divesBefore` or `apneaCounts` changed | the Diver's |
| merging two Divers (search `mergedInto` in `divers/`) | Dives change their Diver | the Diver that receives them |
| the account import (ADR 0044; search where it inserts Dives) | Dives inserted | each Diver in it |

`siteId`, cylinders, weighting and notes don't change the order: no call.

**The number leaves the overridable values:**
- `OVERRIDABLE_FIELDS` loses `'number'`; `DiveValues` and `valuesFromRecording`/`valuesOfDive`/`columnsOf` lose it.
  The compiler shows the rest (`dive-service.ts`, `merging.ts`, `dives/routes.ts` `ValuesSchema`, `dive-import.ts`).
  Inserts of a Dive write no number; `renumber` sets it.
- Revisions written before carry the field `number`: the schema of the history's answer and the web's label for it
  keep it (a `REVISION_FIELDS = [...OVERRIDABLE_FIELDS, 'number']` where `dives/revisions.ts` or the route names the
  field). A test reads an old Revision after the change (insert the row directly in that one test: it is the past).
- `PATCH /api/dives/{id}` with `set.number` or `reset: ['number']` answers 400 as for any unknown field.
- Every view keeps `number: integer | null`. The Recording's `summary.diveNumber` stays.
- The list's sort by number: `nulls last` in both directions.

**The Diver's settings:** `PATCH /api/divers/{id}` (`divers/routes.ts` near :130) takes `divesBefore` (integer 0 to
100 000) and `apneaCounts` (boolean) beside `name`, each optional, with the rights a rename has. The Diver's view
(`divers/diver-service.ts` `list`, and wherever else a Diver is answered with its own fields) gains both.

**MCP:** no change (`number` is described as "the Dive's number in the Diver's logbook", which is now true).
`mcp-endpoint.test.ts` stays green.

### Server tests for the number, in this order (`apps/server/test/dive-numbers.test.ts`)
Dives come in as the other tests bring them in (uploads of the fixtures with different start times; look at
`dive-list.test.ts` for the helpers).
1. Three Dives uploaded newest first are numbered 1, 2, 3 by start time.
2. An older Dive added afterwards is 1 and the others are 2, 3, 4; their `version` is what it was, their history has
   no new entry, and an edit that names the old `version` still goes through.
3. Deleting the second makes the later ones move down; the Deleted dive's `number` is null in the deleted list;
   restoring puts all four back.
4. Overriding a start time so that two Dives change places swaps their numbers; resetting it swaps them back.
5. `divesBefore: 12` makes them 13 to 16; -1, 100 001 and 1.5 are refused; a User who doesn't manage the Diver is
   refused as for a rename; the Diver's view shows the value.
6. With an apnea Recording among them (a fixture whose dive mode is apnea: search `apnea` in `apps/server/test` for
   the one the upload-kinds tests use):
   it counts; with `apneaCounts: false` it has no number and the others close ranks; turned on again, it is back.
7. Merging two Dives (as `dive-merging.test.ts` sets them up) closes the gap; moving one to another Diver renumbers
   both Divers. Two Divers' numbers don't touch each other.
8. A Garmin file whose `dive_number` is 57: the Dive's number is its place, the Recording's summary still says 57.
9. `PATCH` with `set: { number: 5 }` is 400; `reset: ['number']` is 400; no Dive's `overrides` contains `number`.
10. `q=2` finds the Dive numbered 2; sorted by number descending and ascending, an apnea Dive that doesn't count is last.
11. A Dive made by an SSI dive import (`ssi-dive-import.test.ts` shows how) has a number, and the others moved.
12. An old Revision of the field `number` is still answered by the history.

Existing tests that set or expect a typed number change with this: `dive-editing.test.ts` (overrides of `number`),
`dive-list*.test.ts`, anything that reads `number` after an upload. Change what they assert, don't delete what they
cover.

### Server: the Provider side

**`apps/server/src/providers/provider.ts`**
- `DiveExport.numbers?: { set: ('create' | 'update')[]; changeRemovesVerification: boolean }`.
- `DiveExportAction`:
  - `create(dive, reference, number?: number | null)` and `update(remoteId, dive, previous, number?: number | null)`:
    with a number, the adapter uses it unless another dive there has it, as far as it can tell; then it numbers its
    own way (create) or leaves the number there (update). `Delivered.remoteNumber` is what the dive has afterwards.
    Without one: as today.
  - `setNumber?(remoteId: string, number: number): Promise<{ result: 'set'; remoteNumber: number } | { result: 'taken'; by: RemoteDive } | null>`:
    changes only the number; `taken` saves nothing; `null` when the remote dive is gone.
- The capabilities view in `providers/routes.ts` passes `numbers` on (absent stays absent).
- **Contract suite** (`test/provider-contract.ts`): `numbers.set` holds only operations the export has; `update` in
  it goes with `setNumber`, and `setNumber` without it fails; `numbers` with `delivery: 'handed_over'` fails.

**Data** (in the first migration above): `connection.follow_numbers boolean not null default false`; the enum
`push_action` gains `'number'` (`alter type … add value`, in its own migration file if drizzle-kit puts it with
statements that use the value).

**The Connection's setting:** `PATCH /api/connections/{id}` (`providers/routes.ts` near :351) takes
`diveNumbers: { follow: boolean }` beside `diveImport`; `connectionView` (near :253) answers `diveNumbers: { follow }`.
`follow: true` at a Provider without `numbers` answers `provider_unsupported`.

**`providers/push-service.ts`**
- A helper `numbersFor(conn, exports, row)`: `null` unless `conn.followNumbers`, `exports.numbers` and
  `row.number !== null`; else `{ wanted: row.number, onCreate, onUpdate, removesVerification }` from the capability.
- `send`: passes `wanted` to `create` when `onCreate`, to `update` when `onUpdate`. Nothing else changes; with the
  setting off the adapter is called exactly as today.
- `remoteState` gains `number`: `null`, or `{ wanted, differs: current.remoteNumber !== wanted, canSet: onUpdate,
  removesVerification }`. `updateRemovesVerification` becomes `!upToDate && (the adapter's answer || (number?.differs
  && number.canSet && number.removesVerification))`.
- `setNumber(userId, diveId, provider)`: loads as `send` does; `provider_not_connected` without a Connection;
  `provider_numbers_off` when it doesn't follow; `provider_unsupported` without `update` in `numbers.set`;
  `provider_not_sent` without a current remote dive; `provider_number_nothing_to_set` when the Dive has no number or
  `remoteNumber` equals it. Then, leased and with access as `send`: `action.setNumber(remoteId, wanted)`.
  - `set`: a Push `{ action: 'number', state: 'confirmed', remoteId, remoteNumber, diveVersion, fingerprint, payload,
    remoteReference }` with the last four copied from the current Push. Answers `{ result: 'set', push }`.
  - `taken`: a Push `{ action: 'number', state: 'failed', errorCode: 'provider_number_taken', remoteId }`, then the
    problem `provider_number_taken` with `existing` (the `RemoteDive`) and `diveId`: the Dive of this Diver whose
    current remote dive at this Provider has that remote ID, if any (look through `currentOf` or one query on `push`).
  - `null`: as an update that finds the dive gone (`provider_dive_gone`, `remoteGone: true`).
  - an error: a failed Push and the problem, as `send`'s `failed` does.
- Everything that lists or switches on a Push's action gets the new value: search `action ===` and `pushAction` in
  `apps/server/src` and `apps/web/src` (`providers/routes.ts` views, `dives/merging.ts`, `ProviderPanel.tsx`), and
  the account export (ADR 0044) if it names the actions.

**Route:** `POST /api/dives/:id/providers/:provider/number` in `providers/routes.ts`, after the send route (near
:590), no body, answers as the send route does (the result and the Dive's status there). The three new codes join the
problem-code list, their status (409) and their translations; `provider_number_taken` carries `existing` and `diveId`
as `exists` carries `existing` on a send.

**The ledger** (`test/fake-ledger-provider.ts`): declares `numbers: { set: ['create', 'update'],
changeRemovesVerification: true }`, keeps a number per entry, numbers its own way as "highest plus one", honours a
passed number unless taken, and has `setNumber`. A way for a test to put an entry there that Dive Hub doesn't know
(a dive only at the Provider).

**SSI** (`providers/ssi/ssi-adapter.ts`, `ssi-record.ts`):
- `SSI_CAPABILITIES…export.numbers = { set: ['create'], changeRemovesVerification: true }` (changed by the checks).
- `create`: with a number that no dive in the logbook read has, use it instead of "highest plus one".
- Only if the check showed it works: `update` passes a free number into the record it re-sends, and `setNumber` reads
  the logbook afresh (`byId`), answers `taken` with `remoteDive(holder)` when another record has the number, else
  saves the remote record with the number changed (a new `withNumber(record, n)` in `ssi-record.ts`, setting
  `internalPk` too only if the check needed it) through `saveAndReadBack`, and answers the number read back.
- The fake SSI (`test/fake-ssi.ts`) keeps what it is given; nothing to add unless it rejects unknown changes.

### Server tests for the Provider side, in this order (`apps/server/test/provider-numbers.test.ts`)
Against the ledger unless SSI is named.
1. `GET /api/providers`: the ledger shows `numbers`, the hand-over Provider none; SSI shows what it declares.
2. The contract suite's three new rules (in `provider-contract.test.ts`, with adapters that break each).
3. A new Connection answers `diveNumbers.follow: false`; PATCH turns it on and off; at the hand-over Provider
   `provider_unsupported`; another User's Connection is not found.
4. Follow off: a send creates with the ledger's own number; the status has `current.number: null`; "Set number"
   answers `provider_numbers_off`.
5. Follow on, three Dives here, nothing there: sending Dive 2 creates it as number 2; `current.number` is
   `{ wanted: 2, differs: false, … }`.
6. Follow on, a dive only at the ledger holds number 2: sending Dive 2 still creates it, with the ledger's own number;
   `differs: true`.
7. "Set number" where the number is free: the ledger's entry has it; only the number changed there (change the Dive's
   notes first: they are not sent, and `upToDate` is false before and after); a second identical test with an
   unchanged Dive keeps `upToDate: true`. The Dive's Pushes end with a confirmed `number` Push carrying the new number.
8. "Set number" where another Dive's remote dive holds it: 409 `provider_number_taken` with `existing` and that
   Dive's `diveId`; the ledger saved nothing; a failed `number` Push. Held by a dive only there: the same without `diveId`.
9. Setting the holder first, then the other, works (the order a Push run will use).
10. "Set number" again right after: `provider_number_nothing_to_set`. For a Dive never sent: `provider_not_sent`.
    For a remote dive deleted there: `provider_dive_gone`, and the Dive has none there afterwards.
11. Follow on: an update of a changed Dive whose number differs carries the number when free, and leaves it when taken.
12. `current.number.removesVerification` and `updateRemovesVerification` are true for a Dive whose number differs at
    the ledger; with follow off the second is what it was.
13. Adding an older Dive here moves the numbers: every Dive already at the ledger shows `differs: true` and
    `upToDate` as before; nothing was sent.
14. An apnea Dive of a Diver who doesn't count them: sent the ledger's own way, `current.number: null`.
15. While the Dive's lease is held, "Set number" answers `provider_busy` (as the send's lease test does it).
16. SSI, in `ssi-adapter.test.ts`: `create` with a free number sends it as `odin_user_log_nr`; with a taken one,
    "highest plus one"; without one, as today. If the check allows: `update` with a number; `setNumber` free (the
    record SSI holds is sent back with only the number changed: a rating set there survives), taken (no save), gone.
17. SSI through the API (fake SSI): follow on, a send creates the dive with the Dive's number.

### Web
- **`DiveEditForm.tsx`**: the number field and everything for it go (`draft.number`, the `case 'number'`, the hint).
  The translations for the history's old entries stay.
- **The Dive page's Recordings**: each Recording's facts gain "Number on the computer" when its summary has
  `diveNumber` (find where the Recording's other summary values are shown in `DiveDetail.tsx` or its parts).
- **`DiversPage.tsx`**: per Diver the User manages, under the name, a group "Dive numbers" in the pattern the rename
  uses (if that saves with a button, these do too):
  - a `NumberField` "Dives before this logbook" (0 to 100 000, whole numbers), with the description "Dives made
    before the first one here. The first dive here gets the next number.";
  - a checkbox "Count apnea sessions" (a choice saved with the form: a checkbox, not a switch; if the page saves each
    control at once, a switch);
  - saved values invalidate the logbook's and the Dives' queries.
- **`Connections.tsx`**: for a Connection whose Provider has `numbers`, beside the import settings and in their
  pattern: "Number dives at SSI as in Dive Hub", off. Under it, always visible: "New dives are sent with their
  number here. Dives already at SSI keep their number until you set it on the dive's page. Dives that are only at
  SSI keep theirs: import them first if the numbers should fit." with a link to the import on that page.
- **`ProviderPanel.tsx`**, when `current.number?.differs`: a line "At SSI this is dive 57; here it is dive 42." and,
  when `canSet`, a visible button "Set to 42 at SSI". With `removesVerification` it is a `ConfirmButton` whose body
  says that a verification by a dive centre at SSI may be lost. The result is announced as the send's is. The problem
  `provider_number_taken` shows as a notice with the danger tone that doesn't time out: "SSI's dive of 3 May 2024
  has number 42. Set that dive's number first.", the date linking to the Dive when the answer names one. Without
  `canSet` the line stands alone.
- The Pushes list in the panel names a `number` Push: "Number set to 42" (and its failure with the problem's text).
- API hooks in `api.ts`; texts in `en.json` and `de.json` (German: "Tauchgangsnummer", "Tauchgänge vor diesem
  Logbuch", "Apnoe-Sessions mitzählen", "Tauchgänge bei SSI wie in Dive Hub nummerieren", "Nummer bei SSI setzen").
- **Browser tests** (each with its area tag; `scripts/check-lib.mjs` if a new spec or module needs a path):
  - `logbook.spec.ts` or `dive-page.spec.ts`: the edit form has no number field; a Dive added with an earlier date
    renumbers the list; "Dives before this logbook" set to 12 shows on the list.
  - `ssi.spec.ts`: turning the setting on, sending a Dive, the panel shows no difference; a Dive whose number
    differs shows both numbers and (if SSI sets numbers on an update, else with the ledger if the browser tests'
    server has it) "Set to … at SSI" sets it.
  - A case in `e2e/ui-quality.spec.ts` for the Diver's settings, the Connection's setting and the "number differs" state.
- Review capture with the `REVIEW_AREAS` of the files changed, and look at the screenshots (phone width too).

### Client duties for clients.md
Under "Dives" (near line 266), "Divers and Devices" (near :578) and "Sending a Dive to a Provider (SSI)" (near :445):
- A Dive's `number` is computed. **Must not** offer to type it; `PATCH` refuses it. It can be null (a Deleted dive, an
  apnea session that doesn't count): name such a Dive by its date and time.
- Numbers of other Dives change when one is added, deleted, merged or re-timed: after such a change, fetch the list
  and open Dives again; don't keep a number as a reference, use the id.
- Show a Recording's `summary.diveNumber` as the computer's counter, never as the Dive's number.
- Offer the Diver's `divesBefore` and `apneaCounts` to a User who manages the Diver, and say what each does.
- Offer a Connection's `diveNumbers.follow` only where the Provider's capabilities have `numbers`; off until the User
  turns it on. **Must say** that it sends nothing by itself, that dives already there keep their number until set,
  and that dives only there keep theirs (point to the import).
- When a Dive's status has `current.number.differs`: **must show** both numbers (`wanted`, `remoteNumber`). Offer
  "Set number" only when `canSet`. **Must warn** before it when `removesVerification`, as before an update that
  removes a verification.
- `provider_number_taken`: show the dive that holds the number (`existing`) and lead to `diveId` when given; must not
  time the message out. `provider_number_nothing_to_set`: fetch the status again, no error.
- A Push with the action `number` is a number change: name it so in a Dive's history at the Provider.
- "Number differs" is not "changed since sent": don't offer "Send update" for it.

### Documents, in the same change as the code
- `docs/spec/clients.md` (above); `docs/spec/data-model.md` (the Dive's number, the Diver's two settings, the
  Connection's setting, the Push action); `docs/spec/architecture.md` ("Slice 22b (date): dive numbers", as built).
- `docs/references/ssi-app-api.md`: the checks' results with date and app version, `[S]` to `[R]` on the number
  line under "Saving", and what Dive Hub sends as the number now.
- `docs/decisions/0048-dive-numbers.md`: status "Accepted … Built in slice 22b", with an "as built" section for
  anything that turned out differently, and what SSI declares after the checks.
- `docs/decisions/0015-…`, `0027-…`, `0030-…` ("SSI's dive number is not taken"), `0040-…` ("numbers are to be
  calculated"): one line each pointing to ADR 0048.
- `docs/glossary.md`: take "(planned)" off **Dive number**. `docs/index.md`: the ADR's line.
- `docs/research/2026-10-09-push-runs.md`: in the 22c prompt, "4. State" and "5. Open" brought up to date (what SSI
  declares, which checks are done).

## Prompt: dive numbers (slice 22b), implementation

To paste into a fresh session once the owner has accepted ADR 0048.

```
Slice 22b: dive numbers (computed numbers; a Provider's numbers following them). Model: Sonnet.

1. Goal
Build ADR 0048 as planned: the SSI check script's mode first, then the computed number (server, web), the Provider
side (capability, the Connection's setting, "Set number"), SSI's adapter as far as the checks allow, the client
contract. Done: every test of the plan green, `pnpm check` green, the review capture looked at, the documents of the
plan's last list updated, one commit. If the plan leaves a choice open, stop and ask the owner; don't decide.

2. Read first
- docs/decisions/0048-dive-numbers.md, in full.
- docs/research/2026-10-09-dive-numbers.md, from "Owner's checks" to the end of "Documents".
- docs/decisions/0027-providers-as-adapters.md: "The adapter declares"; 0043: what removes a verification (search
  "start time"); docs/skills.md#overrides for each skill below.
- Code, the parts the plan names: apps/server/src/dives/ (dive-values.ts, dive-service.ts, merging.ts, routes.ts
  `EditBody`), db/schema.ts (`dive`, `diver`, `connection`, `push`, `OVERRIDABLE_FIELDS`), providers/ (provider.ts,
  push-service.ts `send`, `remoteState`, `currentRemote`; routes.ts; ssi/ssi-adapter.ts `open`),
  test/support.ts, test/fake-ledger-provider.ts, test/provider-contract.ts, test/fixtures/ssi/round-trip.ts,
  apps/web/src/DiveEditForm.tsx, DiversPage.tsx, Connections.tsx, ProviderPanel.tsx.

3. Decided (don't reopen without a new ADR)
- Everything in ADR 0048: the number is the place by start time plus the Diver's "dives before this logbook";
  apnea by the Diver's setting, counting by default; nothing typed; a stored column kept by `renumber`, which changes
  no version and writes no Revision; the Connection's setting, off; never a duplicate at a Provider; "Set number"
  changes only the number and makes a Push with the action `number`; the number is no part of "changed since sent".
- One action at a time per Connection and per Dive (leases, ADR 0027). Row actions stay visible; React Aria and the
  design system win over the uxcel skills; errors don't time out.

4. State
Branch main. ADR 0048 and the plan are committed (docs only). No code of this slice exists. `pnpm check` was green on
a0fa75f; `pnpm check:full` not run; not pushed. The three SSI checks are not run: the owner runs them with the mode
you add first.

5. Open
- The owner's checks (plan, "Owner's checks"): add the mode, tell the owner how to run it, build on meanwhile. Their
  results decide what SSI declares (the plan's table). Not run by the end: SSI stays `set: ['create']`,
  `changeRemovesVerification: true`; say so in the hand-over.
- If `updated_at` on `dive` is kept by a database trigger, stop and ask (the plan assumes it is not).
- The seams for the tests are in the plan; the owner accepted them with the ADR.
- Known flaky, not part of this slice: tools.spec.ts group plan (the "Ann" row) and logbook.spec.ts:68 ("Show only").

6. Skills to load (read each override in docs/skills.md#overrides first)
tdd, codebase-design, vitest, fastify-best-practices, postgres-drizzle, postgresql-table-design,
api-and-interface-design, security-and-hardening, tanstack-query-best-practices, accessibility, playwright-cli,
ux-inputs-and-forms, ux-selection-controls, ux-tables, ux-notifications-and-toasts.

7. Model
Sonnet.

8. Don't
- Don't call the real SSI: the owner runs round-trip.ts. Don't commit samples/private/.
- Don't put the number into `OutgoingDive` or a fingerprint. Don't change what a send does while a Connection's
  setting is off.
- Don't build a Push run, a logbook filter for "number differs", or anything of slice 22c or 23.
- Don't push, add CI or install git hooks. Don't store project knowledge outside the repository (AGENTS.md Rule #1).
- After the commit, write the hand-over prompt for slice 22c's session: the prompt in
  docs/research/2026-10-09-push-runs.md with its "State" and "Open" brought up to date.
```

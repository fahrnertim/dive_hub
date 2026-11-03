---
title: "Plan: tidy piece 6's automation, web (backlog 0010, points 12-14)"
summary: The i18n plural casts and filterName={String} gone, the fetch settings always showing a selected interval, switches pending while they save, the fetch help read before switching, a stopped row readable on a phone, Retry's error out of the span, a Dive without a site getting a control to choose one, and "Delete in SSI" hidden while an automatic delete waits.
status: done
date: 2026-11-03
---

# Tidy piece 6's automation, web: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Points 12-14 of backlog 0010 fixed, each behaviour change with a browser test; `pnpm check` green, then the PR.

**Architecture:** Web client only (`apps/web/src`): `lib/providers.ts` (text key type), `ProviderAutomation.tsx`,
`ImportPanel.tsx`, `PushRun.tsx`, `WaitingPush.tsx`, `ProviderPanel.tsx`, `DeletedDives.tsx`, `ui/Choice.tsx`,
`pages.css`, the en/de locales, and `apps/web/e2e/waiting-pushes.spec.ts` / `ui-quality.spec.ts`. No server change,
no new module.

**Tech Stack:** React + React Aria Components, TanStack Query, i18next (typed resources), Vite, Playwright.

**Spec:** [docs/backlog/0010-provider-automation-follow-ups.md](../../backlog/0010-provider-automation-follow-ups.md)
(points 12-14, and its "Decided" for point 14). The server half was
[the plan of 2026-10-29](2026-10-29-automation-follow-ups-server.md) (PR #13).

## Global Constraints

- [ADR 0053](../../decisions/0053-module-boundaries.md): no new import across modules; `ui/` stays free of page code.
- [ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md): fetch intervals (60, 360, 1440), the 6-hour
  preselection and the quiet periods don't change. API shapes don't change.
- Nothing in `docs/decisions/`, no migration. Live updates (backlog 0009) are out of scope.
- Design system ([design-system.md](../../spec/design-system.md), "Rules every page follows"): WCAG 2.2 AA, React Aria
  components from `apps/web/src/ui/`, tokens from `design/tokens.css`, hover rules inside `@media (hover: hover)`.
  Every new text in **en and de**.
- Browser tests at the User's level (roles, labels, visible text), each with an area tag; a new page state gets a case
  in `e2e/ui-quality.spec.ts`.
- After a failing check iterate with `pnpm check --failed` or `pnpm check --tests <filter>`; one full `pnpm check`
  after the last edit of a task, then commit at once. `pnpm`, never `npm`.
- `karpathy-guidelines` (load it before Task 1): every changed line traces to a point below.
- Skills: `tanstack-query-best-practices`, `accessibility`, `playwright-cli`, `mobile-native` (Task 4), each with its
  override in [skills.md](../../skills.md#overrides).

## Rulings (made while planning, owner agreed 2026-11-03 in chat)

- **Stored interval no longer offered (13):** the radio group lists it as well, as the selected choice, so a radio is
  always selected; picking another one moves to an offered interval for good.
- **`fetchNeedsImport` (13):** becomes the fetch switch's help text (`aria-describedby`, like the delete help), shown
  whenever the Connection's import is off, so it is read before switching on, not after.
- **Pending switches (13):** while a save of that setting runs, its switch is read-only and shows it is busy; the
  others stay usable.
- **Dive without a site (14):** the requirements block gets a button "Add dive site" that opens the Dive page's
  existing `SitePicker`; the fix button under the words then focuses that button (it is the first control in
  `.provider-needs`).
- **"Delete in SSI" (14, decided in the backlog):** hidden for a Provider copy while the Dive has a queue entry for
  that Provider with action `delete` in state `waiting`. Held or stopped, the manual button shows again (a stopped
  one has Retry beside it as well).

## Rulings made while executing (2026-11-03)

- **Save errors (final review):** each setting keeps its own last save error, so a second setting's successful save
  doesn't hide the first one's failure; equal messages show once.
- **Focus after choosing a site (final review):** the chosen site removes "Choose dive site", so focus goes to the
  line's own button. It is moved when the Dive has its site (at close, or when the Dive refreshes later), and only once
  the closing dialog has let go of focus (React Aria keeps it there for a few frames).
- **Busy switch (13):** React Aria's `Switch` passes no `aria-busy` to its input, so `ui/Choice.tsx` sets it through
  `inputRef`; `data-pending` on the label reuses the Button's busy look (`.btn[data-pending], .switch[data-pending]`).
- **`fetchNeedsImport` (13):** the wording stays; it reads well as help in en and de.
- **"Choose dive site", not "Add dive site" (14):** the Dive page already has an "Add site" button, and a page may not
  have two buttons with the same name (`ui-quality.spec.ts` caught it). The button uses `dive.chooseSite`.
- **Retry's error (14):** the retry mutation moved into a `useRetry` hook; `WaitingPushState` shows its error, in a
  row as a `<span role="alert">` on its own line after the words, in the panel as the `Notice` it was. The phone
  layout uses the logbook's container query (`dives`, 38rem), as the rows do; the dot rule of `.dive-facts` leaves out
  the dot before the error.
- **Tests:** "a Dive without a site…" connects SSI itself so it runs alone; the Task 5 assertions are scoped to the
  entry's list item; no new `ui-quality.spec.ts` case for Task 4, as "a dive stopped on its way to SSI" already checks
  the stopped row at phone width.
- The branch was rebased onto `main` (PR #18) after Task 1, at the owner's request.

## Review Focus

1. A Connection whose stored `fetchEveryMinutes` isn't in `offers.fetchEvery` (Provider narrowed it): one radio is
   selected and labelled with the stored interval → Task 2 test.
2. Two switches pressed quickly one after the other: only the one saving is busy, the second save still goes through
   → Task 2 test.
3. A stopped Dive row at 360 px width: the words read as one block, Retry below them, no horizontal scroll → Task 4 test.
4. Retry failing (500) in a logbook row: the error is announced (`role="alert"`) and the row stays a valid link row
   (no `<div>` inside a `<span>`) → Task 4 test.
5. A deleted Dive whose waiting delete stopped: "Delete in SSI" is back next to Retry → Task 5 test.

---

### Task 1: Plural text keys typed, `filterName={String}` gone (point 12)

**Files:**
- Modify: `apps/web/src/lib/providers.ts:13` (`ProviderTextKey`)
- Modify: `apps/web/src/ImportPanel.tsx:267`, `apps/web/src/ProviderAutomation.tsx:84,149`, `apps/web/src/PushRun.tsx:77,108-109,150,193-205`

**Interfaces:**
- Produces: `ProviderTextKey` that accepts a plural's base key (`'automation.unsent'`) as well as the full keys.

- [ ] **Step 1:** Remove the three `as 'automation.…_one'` casts. Run `pnpm --filter @dive-hub/web exec tsc --noEmit`;
  expected: three errors, "not assignable to ProviderTextKey".
- [ ] **Step 2:** In `providers.ts`, define `type PluralBase<K> = K extends \`${infer B}_${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}\` ? B : never`
  and `ProviderTextKey = Paths<…> | PluralBase<Paths<…>>`. The `t(...)` call in `useProviderTexts` keeps its one cast.
- [ ] **Step 3:** `filterName={String}`: `SendDialog`'s `filterName` becomes optional and `SendDivesDialog` stops
  passing it (with `ids` there is no scope picker). `ScopePicker` keeps it required; `SendDialog` renders it only when
  `!ids && filterName`.
- [ ] **Step 4:** Typecheck clean; `pnpm check`; commit `Web: plural text keys typed, no filterName={String} (backlog 0010, point 12)`.

### Task 2: Fetch settings — stored interval selected, help before switching, pending switches (point 13)

**Files:**
- Modify: `apps/web/src/ui/Choice.tsx` (`Switch`), `apps/web/src/ui/ui.css` (busy look)
- Modify: `apps/web/src/ProviderAutomation.tsx:43-50,59,97-133`
- Modify: `apps/web/src/i18n/locales/en.json`, `de.json` (`automation.fetchNeedsImport` wording if it no longer reads well as help)
- Test: `apps/web/e2e/waiting-pushes.spec.ts` (`@account`)

**Interfaces:**
- Produces: `Switch` takes `isPending?: boolean`: read-only, `aria-busy="true"` on the switch, and the same busy
  indicator `Button` shows for `isPending` (reuse its markup/class, not a new spinner).

- [ ] **Step 1: Write the failing tests** (in `waiting-pushes.spec.ts`, after "the settings show only what the Provider offers…"):
  - `'a stored interval the Provider no longer offers is still the selected one'`: route `/api/connections` so the
    Connection has `fetchEveryMinutes: 60` and `offers.fetchEvery: [360, 1440]`; expect
    `getByRole('radio', { name: 'Every hour' })` to be checked, and three radios in the group. Pick "Every 6 hours";
    the PATCH body is `{ fetchEveryMinutes: 360 }`.
  - `'the fetch switch says first that it needs the import'`: import mode off; the fetch switch has an accessible
    description equal to the `fetchNeedsImport` text while it is **off** (`toHaveAccessibleDescription`).
  - `'a switch is busy while its setting saves'`: hold the PATCH with `page.route` until released; press "send
    changes"; expect it `aria-busy="true"`, and a second press of it sends no second PATCH; press "send new dives"
    meanwhile: it is not busy and its PATCH goes out; release; both settle and no switch is busy.
- [ ] **Step 2:** Run `pnpm check --tests "stored interval|needs the import|busy while"`; expected: 3 FAIL.
- [ ] **Step 3: Implement.**
  - `intervals` for the radio group = offered ones plus the stored one when it isn't offered (in ascending order);
    the switch's "on" default stays as it is.
  - The `fetchNeedsImport` text moves under the fetch switch as `<p id={fetchHelpId} className="muted provider-settings-help">`,
    linked with `aria-describedby`, rendered whenever `c.diveImport?.mode === 'off'` (switch on or off).
  - Pending per setting: keep the one `save` mutation and a `pending: ReadonlySet<keyof Settings>` state, added to in
    `onMutate` and removed from in `onSettled` (keys of the body). A switch gets `isPending={pending.has(key)}`; the
    interval radio group is read-only while `fetchEveryMinutes` is pending. Each `mutate` call runs its own PATCH, so a
    second setting saves at once.
- [ ] **Step 4:** Tests pass; add a `ui-quality.spec.ts` case (`@account`) for the settings with the help text shown
  and a switch busy (axe light and dark). `pnpm check`; commit `Web: fetch settings keep the stored interval, say what they need first, and show a save (backlog 0010, point 13)`.

### Task 3: A Dive without a site gets a control to choose one (point 14)

**Files:**
- Modify: `apps/web/src/ProviderPanel.tsx:336-355` (`Requirements`)
- Test: `apps/web/e2e/waiting-pushes.spec.ts` ("a Dive without a site says it needs one", `@dives`)

**Interfaces:**
- Consumes: `SitePicker({ dive, onClose })` from `apps/web/src/SitePicker.tsx`; `useFocusBackWhenClosed` as
  `DivePage.tsx:319` uses it; label `dive.addSite` ("Add dive site").

- [ ] **Step 1: Write the failing test:** extend "a Dive without a site says it needs one" with a Dive that has **no**
  site (clear it through the API as other specs do): after pressing "See what is needed", expect
  `line.getByRole('button', { name: 'Add dive site' })` to be focused (replacing the `.provider-needs` focus assertion);
  press it, the site picker dialog opens; close it with Escape, focus is back on "Add dive site".
- [ ] **Step 2:** Run it; expected FAIL (no such button).
- [ ] **Step 3:** In `Requirements`, the `!d.site` branch renders the `needsSite` text plus that button, which opens
  `SitePicker` for `d`. The `!u.siteId` with a site keeps its text only (nothing to fix here).
- [ ] **Step 4:** Test passes; `pnpm check`; commit `Web: a Dive without a site can choose one from what the Provider needs (backlog 0010, point 14)`.

### Task 4: A stopped row on a phone, and Retry's error outside the span (point 14)

**Files:**
- Modify: `apps/web/src/WaitingPush.tsx:63-93,125-141` (`Retry`, `WaitingPushState`)
- Modify: `apps/web/src/pages.css:680-682`
- Test: `apps/web/e2e/waiting-pushes.spec.ts` (`@dives`), `apps/web/e2e/ui-quality.spec.ts`

**Interfaces:**
- Produces: `Retry` no longer renders the error itself in the row variant; `WaitingPushState` renders it.

- [ ] **Step 1: Write the failing tests:**
  - `'Retry in a logbook row that fails says why'`: a stopped Dive; `page.route` answers the retry POST with 500;
    press the row's Retry; expect `row.getByRole('alert')` visible, and
    `await expect(row.locator('span div')).toHaveCount(0)`.
  - `'a stopped row on a phone keeps its words together'` (viewport 360×740): the words' box width is at least 60 %
    of the row's, and Retry's box top is ≥ the words' box bottom; `document.documentElement.scrollWidth` ≤ 360.
- [ ] **Step 2:** Run them; expected FAIL.
- [ ] **Step 3:**
  - Row variant: the error goes after the row's `<span>` as phrasing content (`<span role="alert" class="…">` with the
    danger icon), or the row wrapper becomes a block element if the row's markup allows it — whichever keeps the
    row's click-to-open behaviour and passes axe. The panel variant keeps `Notice`.
  - CSS: `.waiting-push` wraps (`flex-wrap: wrap`), the words take the line (`flex: 1 1 100%` below the phone
    breakpoint the pages already use), Retry and the fix link follow on the next line. Wider screens unchanged.
- [ ] **Step 4:** Tests pass; add the stopped row at phone width to `ui-quality.spec.ts`'s logbook case if it isn't
  covered there. `pnpm check`; commit `Web: a stopped row reads on a phone, and Retry's error is outside the row's words (backlog 0010, point 14)`.

### Task 5: "Delete in SSI" hidden while an automatic delete waits (point 14)

**Files:**
- Modify: `apps/web/src/DeletedDives.tsx:159-163` (`copies`)
- Test: `apps/web/e2e/waiting-pushes.spec.ts` (`@dives`)

- [ ] **Step 1: Write the failing tests:**
  - In "the delete dialog doesn't ask for a Provider that deletes by itself…", after "Will be deleted in SSI in 5 min"
    is visible: `await expect(panel.getByRole('button', { name: /^Delete in SSI/ })).toHaveCount(0)` for that entry.
  - In "a delete that stopped shows the error in the deleted dives…": the entry shows Retry **and** "Delete in SSI".
- [ ] **Step 2:** Run them; expected: the first FAILs, the second passes already.
- [ ] **Step 3:** `copies` leaves out a `stillAt` copy when `g.waiting` has an entry with the same `provider`,
  `action === 'delete'` and `state === 'waiting'`. The menu/one-button switch keeps counting what is left.
- [ ] **Step 4:** Tests pass; `pnpm check`; commit `Web: no "Delete in SSI" while the automatic delete waits (backlog 0010, point 14)`.

### Task 6: Close the backlog task

- [ ] Backlog 0010: points 12-14 marked done with this plan's link, `status: done`; this plan `status: done` with any
  ruling made while executing. Docs only, no check. Commit, then the final review, the `architecture-review` subagent,
  push and the PR (skills.md, Superpowers overrides 4-5).

## Deferred minors (final review, 2026-11-03)

- Two "Choose dive site" buttons when a Dive is held by several Providers (latent: only SSI asks for a site).
- The settings cache can go stale when two saves answer out of order.
- `i18n.exists(own)` is checked without a count, so a plural-only key is not found.
- A dot after the Retry error when several Providers wait in one row.
- `useRetry`'s `diveId!` has no guard for a missing id.

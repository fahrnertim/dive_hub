---
title: UI overhaul - implementation plan
summary: Ten tasks for the UI overhaul. Tokens and contrast, the shell, Settings, skeletons, motion and phone menus, then the logbook, dive, Divers and Tools pages, and a pass over the remaining pages with the docs.
status: accepted
date: 2026-11-02
---

# UI overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A redesign of the web client. It gets a framed-sheet shell, a new palette, less at first glance,
skeletons for loading and subtle motion. The API and the schema don't change.

**Architecture:**

- **The look** comes from `apps/web/src/design/tokens.css`, `apps/web/src/ui/ui.css` and
  `apps/web/src/pages.css`.
- **The shell** moves out of `App.tsx` into `ui/Shell.tsx`.
- **Settings** becomes its own page, `SettingsPage.tsx`, with routes and redirects from `lib/settings.ts`.
- **Skeletons** are a new component, `ui/Skeleton.tsx`.
- **The pages** are reorganised in place.

**Tech Stack:**

- React 19 with React Aria Components, plain CSS with tokens, i18next (en and de);
- Vitest (jsdom) for web unit tests, Playwright for browser tests.

**Spec:** [docs/superpowers/specs/2026-11-02-ui-overhaul-design.md](../specs/2026-11-02-ui-overhaul-design.md). Read
the sections your task names. The spec wins over this plan.

## Global Constraints

- **Accessibility.** WCAG 2.2 AA: text ≥ 4.5:1 and control boundaries ≥ 3:1, in light and dark.
  `expectGoodPage` (axe, one h1, no sideways scroll from 320 to 1440 px and at 200 % text) passes on every page.
- **Motion.** Only `transform`, `opacity`, and on hover `background-color`/`color` animate, on `--ease-out` and the
  `--duration-*` tokens. Every duration drops to 0 with `prefers-reduced-motion`, and the skeleton pulse stops.
- **No new dependencies.** No new fonts, no images, no API or schema changes, and no edits under
  `docs/decisions/`, `apps/server/src/db/schema.ts` or `apps/server/drizzle/`.
- **Words.** Every new string goes in both `apps/web/src/i18n/locales/en` and `…/de`. Existing texts keep their
  words. Sentence case. German puts a no-break space before "…".
- **Nothing is lost.** Every action that exists today stays reachable. A browser test that checked the old structure
  is rewritten to check the same behaviour in the new one; none is deleted to make the run pass.
- **Old links redirect** (the spec's Shell and Settled sections):

  | Old address | New address |
  |---|---|
  | `#/account` | `#/settings/display` |
  | `#/account?tab=connections[&connection=…]` | `#/settings/connections[?connection=…]` |
  | `#/account?tab=ai` | `#/settings/ai-access` |
  | `#/admin` | `#/settings/admin` |
  | `#/divers?certifications=own` and `?certifications=<id>` | `#/divers/<id>?open=certifications` |

- **Fixed values:**

  | What | Value |
  |---|---|
  | Sidebar width | about 232px, from 64rem |
  | Top bar (below 64rem) | 52px |
  | Sheet | inset 8px, radius 16px |
  | Radius inside the sheet | boxes 10px, controls 8px |
  | Skeleton delay | 150 ms |
  | Skeleton pulse | 1.6 s, opacity 1 → 0.55 → 1 |
  | Content fade-in | 150 ms |
  | Disclosure | 200 ms |
  | Hover colour | 120 ms |
  | Phone menu sheet | below 40rem, rises 16px, 200 ms |

- **New files** get their paths in `scripts/check-lib.mjs` `AREAS`. Shared UI under `apps/web/src/ui/` and the
  design files already run `@layout`.

## Review Focus

Each of these failure modes gets its test in the task that owns the code.

- **An old bookmark** (`#/account?tab=connections&connection=<id>`, which the Provider OAuth callbacks also produce)
  must land on that Connection's settings. Task 3 owns it: a unit test for `legacyRedirect` and a browser test that
  follows a callback-style link.
- **A long German label in the 320 px bottom bar** ("Tauchplätze", "Werkzeuge") must not overflow or scroll
  sideways. Task 2 owns it: the `ui-quality` 320 variant.
- **A fast load must not flash a skeleton**, and a slow one must not shift the layout when the data lands. Task 4
  owns it: a unit test with fake timers.
- **A non-admin opening `#/settings/admin`** gets the "admins only" notice, not a crash or a blank page. Task 3
  owns it.
- **Reduced motion:** nothing moves, the skeleton pulse included, and the bottom-sheet menu appears without
  animating. Task 5 extends the ADR 0018 motion test.

---

### Task 1: Tokens, palette and contrast

**Files:**

- Modify: `apps/web/src/design/tokens.css`, `apps/web/src/design/base.css`, `apps/web/src/ui/ui.css` (the button
  variants), `apps/web/index.html` (`theme-color` per scheme)
- Create: `apps/web/test/contrast.test.ts`
- Modify: `docs/spec/design-system.md` (Direction, Color with the measured contrast table, Type/space/shape)

**Interfaces:**

- **Produces these new semantic tokens:**
  - `--color-active` (the nav pill);
  - `--color-primary` and `--color-on-primary` (the ink primary button);
  - `--radius-sheet` (16px), `--radius-box` (10px) and `--radius-control` (8px);
  - `--shell-sidebar` (14.5rem) and `--shell-topbar` (3.25rem);
  - `--duration-hover` (120ms), `--duration-reveal` (150ms) and `--duration-disclosure` (200ms);
  - `--text-hero` (2rem) and `--text-title` (1.75rem).
- **Existing token names stay** (`--color-bg`, `--color-surface`, …), so pages keep working. `--radius-md` and
  `--radius-lg` map onto the new radii.

- [ ] **Step 1: Write the failing test `apps/web/test/contrast.test.ts`.** It reads `tokens.css` as text and
  resolves `--palette-*` references. For the light `:root` block and the dark `@media (prefers-color-scheme: dark)`
  block, it asserts:
  - ≥ 4.5 for text and muted on bg, surface and surface-sunken;
  - ≥ 4.5 for accent, danger and success on surface;
  - ≥ 4.5 for on-primary on primary;
  - ≥ 3 for border-strong on bg and surface.

  Use the WCAG relative-luminance formula, with a small helper `contrast(a: string, b: string): number` in the
  test file.
- [ ] **Step 2: Run it.**
  - Run: `pnpm --filter @dive-hub/web exec vitest run test/contrast.test.ts`
  - Expected: FAIL. `--color-primary` is undefined.
- [ ] **Step 3: Set the palette.**
  - Use the values in the spec's Palette table, in `tokens.css` for light and dark.
  - Set the type sizes 12/14/16/20/28/32 as rem tokens, the weights 400/500/600, and the radii and durations
    above. `--duration-hover`, `--duration-reveal` and `--duration-disclosure` go to 0ms under reduced motion.
  - The primary `Button` variant fills with `--color-primary`.
  - Where a pair fails, adjust that value within its role until the test passes.
- [ ] **Step 4: Run the test again.**
  - Run: `pnpm --filter @dive-hub/web exec vitest run test/contrast.test.ts`
  - Expected: PASS.
- [ ] **Step 5: Record the measured ratios.** Put them in design-system.md's contrast table. Rewrite its Direction
  for the framed sheet, the water face and the profile as the signature.
- [ ] **Step 6: Check and commit.**
  - Run: `pnpm check`. Expected: green.
  - Commit: `Web: overhaul palette, type and radii on the same tokens, with a contrast test (UI overhaul)`

### Task 2: The shell - sidebar, top bar, bottom bar, sheet

**Files:**

- Create: `apps/web/src/ui/Shell.tsx`
- Modify:
  - `apps/web/src/App.tsx`: `Navigation` moves out, and the layout becomes `<Shell>`;
  - `apps/web/src/ui/ui.css` or `pages.css`: the shell styles;
  - `apps/web/src/lib/nav.ts`;
  - `apps/web/test/nav-section.test.ts`;
  - `apps/web/e2e/navigation.spec.ts`;
  - i18n en/de: `nav.settings`.

**Interfaces:**

- **Produces:**
  - `export type NavSection = 'logbook' | 'divers' | 'sites' | 'centres' | 'tools' | 'settings'`;
  - `navSection('/settings/display')` returns `'settings'`, and `/account` and `/admin` return `'settings'` too;
  - `Shell({ me, route, children }: { me: Me; route: string; children: ReactNode })` renders the sidebar
    (`nav[aria-label=Main]`), the top bar and the bottom bar (below 64rem), and `<main id="content">` as the
    sheet.
- **The user menu** (an `ActionMenu` on the user row or avatar): Settings (`#/settings`), My certifications (the
  `#/divers?certifications=own` link, which Task 8 redirects) and Sign out. Settings is also a sidebar item at the
  bottom.

- [ ] **Step 1: Unit test.** Add cases to `nav-section.test.ts`:
  - `expect(navSection('/settings/display')).toBe('settings')`;
  - `expect(navSection('/account')).toBe('settings')`;
  - `expect(navSection('/admin')).toBe('settings')`.

  Run it. Expected: FAIL.
- [ ] **Step 2: Implement `navSection` for settings.** Run the test again. Expected: PASS.
- [ ] **Step 3: Rewrite `navigation.spec.ts`'s layout tests.**
  - "on a wide screen the navigation stays in the header" becomes "on a wide screen the navigation is a sidebar
    beside the page". At 1280 the `Main` nav's box is left of `main`'s box, and the current link has
    `aria-current=page`.
  - The phone test keeps its assertions: a bottom bar, icons and text, and the page not hidden behind it.
  - Add: at 320 px in German, every bottom-bar link is fully inside the viewport and the page doesn't scroll
    sideways.
- [ ] **Step 4: Build `Shell.tsx`** and its styles to the spec's Shell section:
  - the tinted frame on `--color-bg` and the sheet on `--color-surface`;
  - an inset of 8px from 64rem, and none below;
  - the active item as an `--color-active` pill;
  - the to-decide count on Logbook as today;
  - `theme-color` matching the frame.
- [ ] **Step 5: Run the tests.**
  - Run: `pnpm check --tests navigation` and `pnpm check --tests ui-quality`.
  - Expected: PASS. Fix layout findings until both pass.
- [ ] **Step 6: Check and commit.**
  - Run: `pnpm check`.
  - Commit: `Web: a framed-sheet shell - sidebar on desktop, top and bottom bars on a phone (UI overhaul)`

### Task 3: Settings - one area, a view per section, redirects

**Files:**

- Create:
  - `apps/web/src/lib/settings.ts`;
  - `apps/web/test/settings-routes.test.ts`;
  - `apps/web/src/SettingsPage.tsx`;
  - `apps/web/src/Devices.tsx` (moved out of `DiversPage.tsx`: `Devices` and `DeviceRow`, unchanged inside).
- Modify:
  - `apps/web/src/App.tsx` (routes and redirect);
  - `apps/web/src/AccountPage.tsx` (split into `DisplaySettings` and `SecuritySettings` exports, with no page
    header);
  - `apps/web/src/AdminPage.tsx` (an export without a page header);
  - `apps/web/src/lib/account-tabs.ts` (removed; its `connectionHref` moves to `settings.ts`, and callers are
    updated);
  - `apps/web/src/DiversPage.tsx` (Devices removed);
  - `scripts/check-lib.mjs`: `SettingsPage` and `lib/settings` go with `@account` and `@admin`, `Devices` with
    `@divers` and `@account`;
  - the e2e specs that open `#/account…` or `#/admin`, which keep working through the redirect. Change only the
    assertions on the old page structure.
  - i18n: the section names and `settings.title`.

**Interfaces:**

- **Produces:**
  - `SETTINGS_SECTIONS = ['display', 'security', 'connections', 'ai-access', 'devices', 'admin'] as const`;
  - `type SettingsSection`;
  - `settingsHref(section: SettingsSection, query?: Record<string, string>): string`, which returns
    `#/settings/<section>[?…]`;
  - `connectionHref(id: string): string`, which returns `#/settings/connections?connection=<id>`;
  - `legacyRedirect(route: string): string | null`, which maps each old address in the Global Constraints table.
    Divers certifications are left to Task 8 and return `null` here.
- **Behaviour:**
  - `SettingsPage({ section, me, params })` puts the sub-navigation beside the section on desktop.
  - On a phone, `#/settings` alone shows the list, and each section has a `BackLink` to it.
  - On desktop, `#/settings` opens Display.
  - The section's name is the h1. Administration is listed only for admins; for others its direct link shows
    `errors.admins_only`.
  - `App.tsx` applies `legacyRedirect` with `location.replace` before routing.

- [ ] **Step 1: Write `settings-routes.test.ts`.** It asserts:
  - `legacyRedirect('/account')` returns `'#/settings/display'`;
  - `legacyRedirect('/account?tab=connections&connection=c1')` returns
    `'#/settings/connections?connection=c1'`;
  - `legacyRedirect('/account?tab=ai')` returns `'#/settings/ai-access'`;
  - `legacyRedirect('/admin')` returns `'#/settings/admin'`;
  - `legacyRedirect('/sites')` returns `null`;
  - `settingsHref('devices')` returns `'#/settings/devices'`.

  Run it. Expected: FAIL (module missing).
- [ ] **Step 2: Implement `lib/settings.ts`.** Run the test again. Expected: PASS.
- [ ] **Step 3: Write the browser tests** (`@account`, in a new describe in `ai-access.spec.ts` or a new
  `settings.spec.ts` with its area tag). They cover:
  - `#/account?tab=connections` lands on the h1 "Connections" with the address `#/settings/connections`;
  - a non-admin's `#/settings/admin` shows the admins-only notice;
  - a phone at `#/settings` lists the sections, and opening one shows a back link.
- [ ] **Step 4: Build `SettingsPage.tsx`,** move Devices, and split the Account page. Update every caller of
  `accountHref` and `connectionHref`. Rewrite the e2e assertions that named the old Account page h1 or its tabs.
- [ ] **Step 5: Run the tests.**
  - Run: `pnpm check --tests settings`, then `pnpm check --tests @account`, `@admin` and `@divers`.
  - Expected: PASS.
- [ ] **Step 6: Check and commit.**
  - Run: `pnpm check`.
  - Commit: `Web: one Settings area with a view per section; old account and admin links redirect (UI overhaul)`

### Task 4: Skeletons

**Files:**

- Create: `apps/web/src/ui/Skeleton.tsx` (exported from `ui/index.ts`), `apps/web/test/skeleton.test.tsx`
- Modify:
  - every `<Muted>{t('common.loading')}</Muted>`: in App, BodyWeight, CentresPage, Certifications, DeletedDives,
    DeleteDive, AppendDive, DiveList, DivePage (`DiveLoading`), DiverCodes, DiversPage, Devices and the Settings
    sections;
  - `apps/web/test/source-rules.test.ts`;
  - `ui.css`.

**Interfaces:**

- **Produces:**
  - `Skeleton({ children, label? }: { children: ReactNode; label?: string })`: a wrapper with `aria-busy="true"` and
    one visually hidden `common.loading`. It renders nothing until 150 ms have passed, then its children with the
    pulse.
  - `SkeletonLine({ width }: { width: string })`: one text line at the current font size.
  - `SkeletonBlock({ height, width? }: { height: string; width?: string })`.
  - `useDelayed(ms: number): boolean`.
  - `.reveal`: a class whose content fades in over `--duration-reveal`. It is applied where the data replaces a
    skeleton.
- **Shaped skeletons:**
  - `LogbookSkeleton` (eight rows on the `DiveList` grid, with a block the size of the profile thumbnail);
  - `DiveSkeleton` (the title line, the facts strip, a profile-height block);
  - `RowsSkeleton({ rows })` for the Divers, sites, centres and settings lists.

  Each lives beside its page or in `Skeleton.tsx` when it is shared.

- [ ] **Step 1: Write `skeleton.test.tsx`** (jsdom, `vi.useFakeTimers()`). It asserts:
  - right after render, the container has no `.skeleton-bar`;
  - after `vi.advanceTimersByTime(150)`, bars are present and the wrapper has `aria-busy="true"`;
  - the text "Loading…" exists once.

  Run it. Expected: FAIL.
- [ ] **Step 2: Implement `Skeleton.tsx`** and its CSS:
  - the bars use `--color-surface-sunken` with `--radius-control`;
  - the pulse is `@keyframes` on opacity, inside `@media (prefers-reduced-motion: no-preference)`.

  Run the test again. Expected: PASS.
- [ ] **Step 3: Add a rule to `source-rules.test.ts`:** no `t('common.loading')` in a page file outside
  `ui/Skeleton.tsx` and `App.tsx`'s Suspense fallback. Run it. Expected: FAIL. Replace every use with its fitting
  skeleton, and run it again. Expected: PASS.
- [ ] **Step 4: Run the browser tests.**
  - Run: `pnpm check --tests @dives`, `@divers` and `@sites`.
  - Expected: PASS. Tests wait on visible content.
- [ ] **Step 5: Check and commit.**
  - Run: `pnpm check`.
  - Commit: `Web: skeletons in the final layout replace "Loading…", shown after 150 ms (UI overhaul)`

### Task 5: Motion and phone menus

**Files:**

- Modify: `apps/web/src/ui/Disclosure.tsx`, `apps/web/src/ui/Menu.tsx`, `apps/web/src/ui/ui.css`,
  `apps/web/e2e/ui-quality.spec.ts` (the ADR 0018 motion test)

**Interfaces:**

- **Produces:**
  - `ActionMenu`, unchanged in its props. Below 40rem it renders the menu in a React Aria `Modal` as a bottom sheet
    (`.menu-sheet`: full width, safe-area padding, `--shadow-overlay`), rising 16px with a fade. Above that it
    keeps its popover.
  - `Disclosure`'s panel animates by height, using `grid-template-rows: 0fr → 1fr` with opacity over
    `--duration-disclosure`. Its content stays in the DOM only while open, as today.
  - Hover background transitions use `--duration-hover` on rows, nav items and buttons.

- [ ] **Step 1: Extend the motion test** ("menus grow from their trigger; with reduced motion nothing moves"). It
  covers:
  - at 390 px, opening the user menu shows `.menu-sheet` at the viewport bottom, and its `getAnimations()` is
    non-empty;
  - with `reducedMotion: 'reduce'`, the menu sheet, an opened disclosure and a visible skeleton bar each have no
    running animation (use `getAnimations().length === 0` or a duration of 0).

  Run: `pnpm check --tests ui-quality`. Expected: FAIL.
- [ ] **Step 2: Implement the sheet, the disclosure motion and the hover transitions.** Run again. Expected: PASS.
- [ ] **Step 3: Check and commit.**
  - Run: `pnpm check`.
  - Commit: `Web: disclosures open by height, hover colour eases, menus are bottom sheets on a phone (UI overhaul)`

### Task 6: Logbook - less at first glance

**Files:**

- Modify:
  - `apps/web/src/DiveList.tsx`;
  - the logbook page that holds `PageHeader`, Import files and the Imports and Deleted dives links (find it from
    `App.tsx`'s `/` route);
  - `apps/web/src/ReviewStrip.tsx` (the decision line);
  - `pages.css`;
  - `apps/web/e2e/logbook.spec.ts`;
  - i18n: `logbook.summary`, `logbook.filters`, `logbook.more`.

**Interfaces:**

- **Consumes:** `ActionMenu` (Task 5), `Disclosure` (Task 5) and the skeletons (Task 4).
- **Behaviour:**
  - **The title row:** "Logbook", a summary line from the same figures the stats block shows today (count, time
    under water, deepest), the primary Import files button, and More (Imports, Deleted dives).
  - **The decision line:** one line plus a link, replacing the tinted panel.
  - **One filter row:** search, the Diver select only when there is more than one Diver, the sort select, and a
    Filters button with the number of active chips that opens the "Show only" chips (a disclosure under the row,
    open by itself when a chip is on). The address keeps every filter (ADR 0040).
  - **Rows:** titles without underline, a hover tint on the whole row, and a larger profile thumbnail.
  - **The drop hint** shows only in the drop overlay and the empty logbook.

- [ ] **Step 1: Update `logbook.spec.ts`** (`@dives`). It covers:
  - the stats block is gone, and the summary line shows "5 dives" in the fixture;
  - Imports and Deleted dives are reached through More;
  - turning on "No dive site" through Filters keeps `only=no-site` in the address, and after a reload the Filters
    panel is open with the chip pressed;
  - with one Diver, no Diver select is shown.

  Run: `pnpm check --tests logbook`. Expected: FAIL.
- [ ] **Step 2: Implement the title row, the decision line, the filter row and the row look.** Run again.
  Expected: PASS.
- [ ] **Step 3: Run the other tests.**
  - Run: `pnpm check --tests @dives`.
  - Expected: PASS. Fix the tests that used the old links by following them through More.
- [ ] **Step 4: Check and commit.**
  - Run: `pnpm check`.
  - Commit: `Web: the logbook shows a summary, one filter row and its rows first; the rest is one step away (UI overhaul)`

### Task 7: Dive page - the profile as the hero

**Files:**

- Modify: `apps/web/src/DivePage.tsx`, `apps/web/src/Assessment.tsx`, `apps/web/src/DepthProfile.tsx` (height
  only), `pages.css`, `apps/web/e2e/dive-page.spec.ts`, `apps/web/e2e/assessment.spec.ts`, i18n `dive.addDetails`
  and `dive.about`

**Behaviour:** as in the spec's Dive section.

- **The title row:** Previous and next in it, plus Edit and More.
- **The facts strip:** max depth, duration, water temperature and gas at `--text-hero`. Average depth and water
  type follow as smaller facts.
- **The profile** at full sheet width and taller.
- **Details with values** are shown.
- **Empty details** become one row of "Add …" chips, each opening the same editor its "Add" link opens today.
- **Recording tabs** only when there is more than one Recording; with one, "Recording actions" sit in More.
- **The assessment:** its summary and the flying-after line are shown, and its notes sit in a disclosure.
- **"About this dive":** Provider status and History at the end.

- [ ] **Step 1: Update `dive-page.spec.ts`** (`@dives`). It covers:
  - on a dive with no site, buddies, cylinders, suit or notes, a group "Add details" holds five buttons, and
    "Add cylinders" opens the cylinders form;
  - a dive with one Recording shows no Recording tab list, and "Split off" (or that Recording's actions) is reached
    through More;
  - a dive with two Recordings shows the tabs.

  Run: `pnpm check --tests dive-page`. Expected: FAIL.
- [ ] **Step 2: Implement.** Run again. Expected: PASS.
- [ ] **Step 3: Run the other tests.**
  - Run: `pnpm check --tests @dives`.
  - Expected: PASS. Rewrite the assertions that relied on the old layout (the Recording tabs, the dashes).
- [ ] **Step 4: Check and commit.**
  - Run: `pnpm check`.
  - Commit: `Web: the dive page leads with its facts and profile; empty details become "Add" chips (UI overhaul)`

### Task 8: Divers - rows, a page per kept Diver, row menus

**Files:**

- Create: `apps/web/src/DiverPage.tsx`
- Modify:
  - `apps/web/src/DiversPage.tsx`;
  - `apps/web/src/App.tsx` (the `#/divers/<id>` route);
  - `apps/web/src/lib/settings.ts` (`legacyRedirect` for `?certifications=`, which needs the Divers list, so it is
    resolved in `DiversPage`: see below);
  - `scripts/check-lib.mjs` (`DiverPage`: `@divers`);
  - `apps/web/e2e/certifications.spec.ts`, `diver-codes.spec.ts`, `body-weight.spec.ts`, `buddies.spec.ts` and
    `decisions-and-divers.spec.ts`;
  - i18n `divers.actions`.

**Interfaces:**

- **The list.** `DiversPage` lists the kept Divers as rows: avatar, name, the dive count as a link to their
  logbook, and the certification count. Each row links to `#/divers/<id>`. The other divers are rows with one
  `ActionMenu` labelled `common.forItem(divers.actions, name)` holding Codes, Rename, Merge into… and Delete, which
  open today's dialogs.
- **`DiverPage({ id, open }: { id: string; open?: 'certifications' })`** holds Certifications, Dive numbers, Codes,
  Body weight, Rename and Delete. The h1 is the Diver's name, and a BackLink leads to Divers.
- **`#/divers?certifications=own|<id>`** replaces the address with `#/divers/<resolved id>?open=certifications`
  once the list is loaded; an unknown id goes to `#/divers`.

- [ ] **Step 1: Update `certifications.spec.ts`** (`@divers`). It covers:
  - the user menu's "My certifications" lands on the own Diver's page with the certifications open;
  - in `buddies.spec.ts`, Merge into… for an other diver is reached through its Actions menu.

  Run: `pnpm check --tests @divers`. Expected: FAIL.
- [ ] **Step 2: Implement.** Run again. Expected: PASS. Rewrite the other `@divers` assertions that expanded rows
  inline.
- [ ] **Step 3: Check and commit.**
  - Run: `pnpm check`.
  - Commit: `Web: Divers lists people; each kept Diver gets a page; row actions in one menu (UI overhaul)`

### Task 9: Tools - the answer beside the inputs

**Files:** `apps/web/src/ToolsPage.tsx`, `ToolsPlan.tsx`, `ToolsLead.tsx`, `pages.css`, `apps/web/e2e/tools.spec.ts`,
i18n `tools.settingsSummary`

**Behaviour:** as in the spec's Tools section.

- **The estimate notice** is one quiet line under the title.
- **The layout.** The inputs and the result sit side by side from 64rem, with the result at `--text-hero` and its
  limits table.
- **Settings** is closed by default, with a summary line built from the current values ("Salt · sea level · fixed
  reserve 60 bar · 20 L/min · GF 85", in the units' format).
- **"What this assumes"** sits in a disclosure. Settings opens by itself when the address carries a settings value.

- [ ] **Step 1: Update `tools.spec.ts`** (`@tools`). It covers:
  - Settings is collapsed on first visit, and its summary contains "60 bar";
  - changing the reserve through Settings updates the summary and the bottom time.

  Run: `pnpm check --tests tools`. Expected: FAIL.
- [ ] **Step 2: Implement.** Run again. Expected: PASS.
- [ ] **Step 3: Check and commit.**
  - Run: `pnpm check`.
  - Commit: `Web: Tools shows the answer beside the inputs; its settings fold into one summary line (UI overhaul)`

### Task 10: The remaining pages, docs and the look check

**Files:**

- Modify:
  - `pages.css` and the page files of Dive sites, Dive centres, Review, Deleted dives, Imports, sign-in, invitation
    and not-found. Only their panels become sheet sections, and lists with more than two row actions get a row
    menu.
  - `docs/spec/design-system.md`: Components (Shell, Skeleton, Settings layout, row menu, menu sheet), the motion
    paragraph and the layout bullet.
  - `docs/glossary.md`, only if a new UI term needs one.
  - `apps/web/e2e/review-material.capture.ts`: shots for Settings, the Diver page, a skeleton (by delaying a route)
    and the phone menu sheet.

- [ ] **Step 1: Run the capture.** Run `REVIEW_AREAS=dives,divers,sites,tools,account pnpm --filter @dive-hub/web
  review:capture`, then look at every screenshot in `apps/web/review-output/`: light, dark, German and phone. Fix
  what is wrong:
  - a panel inside a panel;
  - ragged rows;
  - text under 12px;
  - a colour off its role;
  - anything sideways at 320.
- [ ] **Step 2: Run the tests.**
  - Run: `pnpm check --tests ui-quality`.
  - Expected: PASS.
- [ ] **Step 3: Update `design-system.md`.**
- [ ] **Step 4: Check and commit.**
  - Run: `pnpm check`.
  - Commit: `Web: the remaining pages on the sheet; design system updated for the overhaul (UI overhaul)`

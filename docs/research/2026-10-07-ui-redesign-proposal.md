---
title: UI redesign proposal - less text, dive rows, a review page, navigation
summary: From the review screenshots of 2026-10-07 - the assessment and "Needs your decision" as walls of text, the logbook table as dive rows with a profile sketch, filters such as "No recording", a Review page for housekeeping, navigation for more areas and for phones. Proposals with a mock; the owner chose (Outcome).
status: decided
date: 2026-10-07
---

# UI redesign proposal

Material: the screenshots in `apps/web/review-output/` from 2026-10-07 (01 logbook, 03b dive with assessment,
70b logbook check, 08 and 09b German phone), the components (`DiveList.tsx`, `Assessment.tsx`, `Decisions.tsx`,
`LogbookChecks.tsx`, `DiveDetail.tsx`, `App.tsx`), the English texts, and the skills `better-layout`, `ux-tables`,
`ux-menus` and `ux-search` with their [overrides](../skills.md#overrides).

Mock: [assets/2026-10-07-ui-redesign-mock.html](assets/2026-10-07-ui-redesign-mock.html). Open it in a browser from the
repository; the bar at the top switches between Logbook, Dive and Review, 1280 and 390 px, light and dark. Made-up
data, our tokens. It shows structure and amounts of text, not final styling.

The owner's answers are under [Outcome](#outcome-2026-10-07).

## What the screenshots show

| Where | Measured | Cause |
|---|---|---|
| Dive page, assessment (03b, 1280 px) | The panel is about 1,750 of the page's 3,870 px with four findings; on a phone (09b) about 3,000 of 5,560 px | Every finding shows everything at once: summary, guidance, "based on", "next time", sources, two buttons. Four findings are sixteen labelled paragraphs and eight buttons. `info` findings ("nothing to change") weigh as much as the ones that differ from guidance |
| Dive page, above the profile | Facts, notes, "Buddies and guides" and the recording's device values take about 900 px before the profile starts | Two empty states ("No notes yet.", "Nobody else is on this dive yet.") each get a heading or a whole panel |
| Logbook, "Needs your decision" (70b) | Two items take 650 px, before the first dive | Every item is open; the explanation ("If they are the same dive, merge them. If a time is wrong …") repeats per pair; the panel has no upper bound, and after an import with many pairs the logbook itself is out of sight |
| Logbook table | A row says date, Diver, site, depth, duration. Six of thirteen rows read "30 min", "18.5 m", "–" | The row carries no shape of the dive, and nothing says what is missing (no recording, no site) |
| Navigation (08) | Four items wrap into two rows at 390 px | A top bar with text links; equipment ([ADR 0034](../decisions/0034-equipment-items-and-service-schedules.md)) and planning will add more |

The texts themselves are careful and should stay. The problem is that all of them are on screen at once.

## 1. Assessment: one line per finding, the rest on demand

[ADR 0036](../decisions/0036-dive-assessment.md) already describes it this way: "a tap highlights the stretch and shows
the numbers, the guidance, the evidence, the recommendation". The panel that was built shows all of it always.

| # | Change | Why |
|---|---|---|
| 1.1 | **A finding is one row**: title, severity badge, the sentence with the numbers, the time on the right. A disclosure arrow opens guidance, next time, sources and the two actions. Selecting a bar in the lane opens that finding and closes none | The numbers are what differs per dive and stay visible; the guidance is the same on every dive with that finding and is read once. The arrow is the visible cue (better-layout: hint at hidden content) |
| 1.2 | **`info` findings behind one line**: "2 more for information: Fast descent, Short safety stop" | They don't mark the dive in the list (ADR 0036), so they shouldn't lead its page. Their names stay visible, so nothing is hidden without a cue |
| 1.3 | **Shorter summaries in the row**: "Up to 13 m/min for 162 s, from 39.2 m to 5 m." instead of "You ascended at up to …" | The title already says "Fast ascent". Needs a second, short text per rule (`assessment.short.*`); the long sentence stays for MCP and screen readers |
| 1.4 | **"Based on" joins the guidance** as its last sentence; sources become one line of links | Two labelled blocks fewer per finding |
| 1.5 | **The panel's head counts**: "2 findings differ from guidance · 2 for information". The lead sentence goes | The lead explains what an assessment is on every dive; the count says what this one found |
| 1.6 | **No-fly as one line**: "Flying after this dive: not before Feb 21, 4:20 AM (12 hours)" with the source link | Today a heading and two paragraphs |
| 1.7 | **The fixed note in two sentences** with a link to the full text ("What the assessment can and can't tell") | ADR 0036 requires the note with every assessment. Shortening it is a change to what that ADR decided, so it needs an amendment. If the owner prefers, the note stays as it is: it is 5 lines, not the main cost |

With four findings the panel goes from about 1,750 px to about 480 px with one finding open (mock, Dive).

Not proposed: moving the assessment to a tab or another page. It belongs to the profile (the lane and the list select
each other), and a tab would hide that a dive has findings.

## 2. Dive page: the profile on the first screen

| # | Change | Why |
|---|---|---|
| 2.1 | **Buddies and notes become facts** in the facts grid, with "Add someone" and "Add notes" as their empty value. With content, notes get their paragraph back under the grid | Two empty states stop costing a panel and a heading |
| 2.2 | **Facts and profile in one panel**; the recording's device values (computer, mode, deco model) as one line under the chart, with "All values of the recording". Gas moves up into the facts | The profile is the design's one bold element ([design system](../spec/design-system.md#direction)); it should be visible without scrolling at 1280 × 800. With several Recordings the tabs stay, above the chart |
| 2.3 | **SSI and History collapsed** to one line each that says their state ("Erika isn't connected", "created from an import on Oct 7") | Both are rarely the reason to open a dive. A failed or outdated push opens its panel by itself |
| 2.4 | **Previous and next dive** in the page head, in the order of the list the User came from | Reading a dive day or a trip without going back to the list each time |
| 2.5 | **"Logbook" goes back to the list as it was** (filter, sort, page) | Today the link is `#/`, which drops what the address held ([ADR 0017](../decisions/0017-logbook-list-paging.md)) |

## 3. Logbook: dive rows instead of a table

**Table or list?** ux-tables: a table is for comparing attributes across columns, a list for scanning items one after
another. A logbook is scanned ("the second dive that day at the Lighthouse") and searched; comparing is occasional
and is served by sorting. So: a list of rows, with the two numbers kept in right-aligned columns in tabular figures,
which keeps what the table was good at.

**Rows, not boxed cards.** The visual refresh removed boxes in boxes, and the design system rules out identical
shadowed cards ([ADR 0019](../decisions/0019-tonal-surfaces.md)). A row is separated by a divider (ux-tables: dividers
when items span more lines).

| # | Change | Why |
|---|---|---|
| 3.1 | **Profile sketch** per row (112 × 40 px, the depth gradient), all on one depth scale, so a 40 m dive looks deeper than a 12 m one. A stretch of fast ascent is drawn in the ascent colour. A Dive without a Recording shows a dashed box "no recording" | Sawtooth, square, multilevel are recognised before any number is read. The dashed box makes missing computer data visible in the list |
| 3.2 | **The site is the row's title**; the date and time when there is none ("No dive site" then stands in the line below) | "Where" is how divers remember a dive. Today the site is the fourth column |
| 3.3 | **A second line with what makes the dive this dive**: weekday and time, Diver (with several), buddies, gas, "from SSI", the surface interval when it was a repeat dive that day | Buddies and gas are on the Dive already and nowhere in the list |
| 3.4 | **Marks at the end of that line**: "2 findings" (as today), "same time as another dive" | The second connects the list with the review (section 4) |
| 3.5 | **Month headings** with "3 dives · 2 h 15 min", only while sorted by date | Structure in a long list; a trip reads as a block |
| 3.6 | **Totals above the list**: dives, time under water, deepest, last dive, following the Diver filter | Four numbers every logbook has on its first page |
| 3.7 | **One toolbar**: search, Diver, "Sort by", the range. The Diver filter moves down from the page head | It filters the list, so it sits with the list (better-layout: group what belongs together). Sorting needs its own control once the column headers go (ux-search: sorting separate from filtering) |
| 3.8 | **Imports and Deleted dives leave the page** for Review (section 4); a line of two links under the list remains | The logbook page is then head, at most one strip, the list |

Row height is about 68 px instead of 37 px. A page of 50 dives becomes about 3,500 px. Proposed: a page of 25.

On a phone the sketch narrows to 84 px and depth and duration join the second line (mock, 390). The date link and
the whole-row click stay as they are.

Kept: paging, sorting, search and filters in the address (ADR 0017); the date or site as the link for keyboard and
screen readers; `expectGoodPage` rules.

### Filters: "Show only"

Asked for by the owner on 2026-10-07: finding the dives whose computer recording is missing.

| Filter | Meaning | Data |
|---|---|---|
| **No recording** | Dives that only have a logbook entry (from SSI or typed), no dive computer file | `recordings = 0`, known on the Dive |
| **No dive site** | No site chosen | `siteId is null` |
| **With findings** | The list's mark is set | the existing count |
| **Not in SSI** | Connected, and this Dive has no current link (per Provider when there are several) | the Push state |

- **As toggle chips in one row under the toolbar**, each with its count ("No recording 14"). ux-search: chips for
  quick filters, a handful visible, results update at once, the applied ones stay visible. A pressed chip is the
  applied-filter display; no second row of tags. Chips combine with "and".
- **A chip with a count of 0 is not shown.** A logbook with every recording in place has no "No recording" chip.
- **On a phone** the row takes three lines (mock). ux-search puts filters behind a "Filters" button there; with four
  chips a horizontally scrolling row with the next chip peeking in (as our tab list does) is lighter. To be tried in
  the slice.
- **In the address** (`?only=no-recording,no-site`), as everything else the User picks.
- **No results** names the filters and offers "Show all dives" (ux-search: no dead ends).
- The counts need the API: one more field on `GET /api/dives` (`counts`), computed for the current Diver and search.
  A new duty for clients, so the [client contract](../spec/clients.md) changes with it.
- "No number" was in the first draft and is left out (owner, 2026-10-07): numbers are to be calculated later, so a
  Dive without one won't exist.
- Later candidates, same pattern: "No buddies", "Edited by hand", "Time zone unknown", a year or date range, depth
  range. Not in the first step: each chip costs a line on a phone.

### Buddies as stacked avatars

The owner's idea (2026-10-07): overlapping round avatars instead of "with Lena" in the second line; initials in a
circle until Divers have pictures. In the mock (Logbook).

- **A column of its own on desktop**, between the dive and the numbers: up to three circles of 28 px, overlapping by
  6 px, then "+2". The stacks line up down the list, so "who was I with" is scanned like a column. The second line
  gets shorter.
- **Two letters** (the initials of first and last name, or the first two letters of a single name). One letter collides
  too often (Lena, Lars, Lukas).
- **A tone per Diver**, always the same for the same person, from a few of our soft surface tones. It helps telling two
  people apart; it never carries the meaning alone.
- **The names stay as text for screen readers** ("with Lena Meier, Tom Keller"; the circles are `aria-hidden`). No
  `title` tooltip ([page rules](../spec/design-system.md#rules-every-page-follows)).
- **What it costs**: initials say less than a name. In a family or a club the handful of people is recognised; with many
  external Divers (a dive center) "TK" is a guess until the dive is opened. Guides and instructors look like buddies.
- **On a phone it does not save space**: the stack takes a line of its own under the row's text (mock, 390), where
  "with Lena" sat inside the line. Proposed there: the stack at the end of the title line, or names as before. To be
  tried in the slice.
- **One `Avatar` component**, also for the Diver of a row (with several Divers), the Participants panel, the Divers
  page and the account menu. Pictures later are their own decision (upload, storage, who may set one for an external
  Diver).

### What the sketch needs

`DiveSummaryView` has no samples. Proposed: the server stores a reduced profile of the Primary recording with the Dive
(about 48 depth points, plus the ascent bands the assessment already computes) when a Recording is imported or the
Primary recording changes, and sends it in the list as `profile: number[] | null`. 50 rows × 48 numbers is about 10 KB
uncompressed. This is a data-model and contract change, so it gets an ADR and a migration that fills existing Dives.
Without it, everything else in this section still works: the sketch is its own slice.

## 4. "Needs your decision" becomes a strip and a Review page

| # | Change | Why |
|---|---|---|
| 4.1 | **On the logbook, one line**: "3 things need your decision: 1 recording, 2 pairs of dives at the same time." with "Review them". Tinted as today (`attention`). Nothing shown when nothing waits | The logbook is never pushed off its own page, whether 1 or 40 things wait |
| 4.2 | **A page "Review"** (`#/review`) with four parts: To decide, Imports, Decided (discarded recordings, pairs kept as two dives), Deleted dives | Today these are five panels and three "Show …" buttons on the logbook page. They are one job, tidying the logbook, done now and then |
| 4.3 | **A count beside "Logbook" in the navigation** while something waits | Visible from every page; a badge is the quiet form for "something waits" and needs no dismissing |
| 4.4 | **Items grouped by kind, explained once per group**: "Dives at the same time", with the how-to sentence and "Merge the 2 clear pairs…" in the group's head; "Recordings without a dive" | The explanation is read once instead of per pair |
| 4.5 | **The two candidates side by side as dive rows with their sketches**, the values that differ marked (16.4 m / 16.1 m), "stays when merged" on the one that stays. The reason a recording was not added is a badge ("max depth differs too much") | "Is this the same dive?" is answered by looking at two profiles. Stacked below each other on a phone |
| 4.6 | **Buttons name their target**: "Add to Dive 42" | One line less ("It might belong to") and no button whose meaning depends on its position |
| 4.7 | **After the first import**, when everything is new, the strip is the only notice; the Imports panel stays on the logbook only until the first dives exist (as today) | The first-run flow of UI review B5 is kept |

The merge hint on the dive page (`MergeHint`) stays: it is one notice at the place where the User is.

Open point: whether deciding from the strip without leaving the logbook should remain possible (the strip opens in
place for up to three items, the page for more). Proposed: no. One place, one behaviour.

## 5. Navigation

No installed skill covers navigation as a whole: `ux-menus` covers menus and names `ux-navigation` (same source,
uxcel-lab/product-skills) for "where menus live", which we haven't installed. The points below rest on `ux-menus`,
`better-layout` and what the screenshots show. Before a navigation slice, `ux-navigation` should be vetted and proposed
the usual way ([skills](../skills.md)), and `mobile-native` loaded for the bottom bar (safe areas).

| # | Change | Why |
|---|---|---|
| 5.1 | **Admin moves into the account menu** ("Account", "Administration", "Sign out") | It is for one role and rare; the bar keeps the areas every User has. ux-menus: related items, most used first, three is far from too many |
| 5.2 | **Top bar order by use**: Logbook, Dive sites, Divers, later Equipment and Planning. Up to five fit beside the brand at 1120 px in both languages | Order by importance (better-layout) |
| 5.3 | **On a phone, a bottom bar** with icon and text for up to four areas and "More" (account, administration, the rest); the top bar keeps brand and nothing else | Today four links wrap to two rows and take 130 px of every page (08). Icons keep their text ([ADR 0018](../decisions/0018-icons-and-motion.md)). A hamburger would hide where one is |
| 5.4 | **Review is a sub-page of the logbook**, not a top-level item: reached from the strip, the count in the navigation and the links under the list | It is empty most of the time; a permanent item for it would be noise |
| 5.5 | **Sub-navigation as tabs under the page head** where a page has parts (Review; later Account, Admin) | One pattern instead of long pages of unrelated panels; the tab is in the address |

Not proposed: a sidebar. Five areas don't need one, and it would take the width the profile and the list use.

## Order and size

Each row is a slice of its own ([one slice, one session](../agents/working-economically.md)).

| Slice | Contains | Needs |
|---|---|---|
| A | Assessment compact (1.1–1.6), dive page order (2.1–2.3) | Web only. 1.7 only with an amendment to ADR 0036 |
| B | Review page and strip (4.1–4.7), navigation count (4.3), Admin into the account menu (5.1) | Web only; a new page in `scripts/check.mjs` and `e2e/ui-quality.spec.ts` |
| C | Dive rows without the sketch (3.2–3.8), "Show only" filters | API: filter parameter and counts, buddies and gas in the summary; client contract; amends ADR 0017 (page size, filters) |
| D | Profile sketch (3.1), also in Review (4.5) | ADR, migration, contract |
| E | Phone bottom bar (5.3), previous/next dive (2.4, 2.5) | Skills `ux-navigation` (to vet) and `mobile-native` |

A and B remove the walls of text and touch no API. C is what the owner asked for on top (filters). D is the most
visible and the most work.

## What the owner decides

1. **Assessment**: collapsed findings with `info` behind one line (1.1, 1.2)? Shorten the fixed note (1.7), or leave it?
2. **Dive rows** instead of the table (section 3)? If yes: with month headings and totals, or plain?
3. **Profile sketch** in the list: worth the data-model change (slice D)?
4. **Filters**: are the five chips the right first set? Which later candidates matter?
5. **Review page**: move Imports, Decided and Deleted dives there (4.2), or only the open decisions?
6. **Navigation**: Admin into the account menu (5.1)? Bottom bar on phones (5.3)?
7. **Page size** 25 with the taller rows?

## Outcome (2026-10-07)

The owner's answers to the choices above.

- **Assessment** (choice 1): yes, collapsed findings with `info` behind one line. The fixed note is shortened as in the
  mock (1.7), with the full text behind its link; slice A amends ADR 0036 for it.
- **Dive rows** (choice 2): yes.
- **Filters** (choice 4): the chips No recording, No dive site, With findings, Not in SSI. Not "No number".
- **Page size** (choice 7): 25.
- **Review page** (choice 5): yes, Imports, Decided and Deleted dives move there.
- **Navigation** (choice 6): yes, Admin into the account menu and a bottom bar on phones.
- **Buddies as stacked avatars** with initials: the owner's proposal, worked out [above](#buddies-as-stacked-avatars).
- **`ux-navigation`** vetted and installed ([skills log](../skills.md#decisions-log)). It supports 5.1 to 5.5: a top
  bar for up to 7 stable sections, a bottom bar for 3 to 5 destinations on phones, tabs for 2 to 9 parallel parts, icons
  with text, essentials never behind a hamburger.

Not yet an ADR: these are answers to a proposal. Slices C and D need one each (list filters and summary fields; the
stored profile sketch).

## Built

- **Slice A (2026-10-07):** the compact assessment (1.1 to 1.7) and the dive page order (2.1 to 2.3).
  [ADR 0036](../decisions/0036-dive-assessment.md#amendment-2026-10-07-compact-presentation-ui-redesign-slice-a) is
  amended for the note and the rows. Different from the mock: the note's full text is a dialog; buddies are a fact
  with their roles as text ("Kai Lund (Buddy)"), changed in a dialog (avatars come with slice C); the device is named
  in the line under the chart only when no tab names it; SSI opens by itself when the Dive changed since it was sent,
  the last sending failed, or the connection needs a new sign-in. Checked in the browser tests in English and German,
  light and dark, at 320 px, at 200 % text and with axe (`e2e/ui-quality.spec.ts`), which the mock was not.

- **Slice B (2026-10-07):** the Review page (`#/review`, part in `?tab=decide|imports|decided|deleted`) and the strip on
  the logbook (4.1 to 4.7), the count beside "Logbook" in the navigation (4.3, 5.4: Review is a sub-page, so "Logbook"
  stays the current item), Admin in the account menu as "Administration" (5.1). Different from the mock: the sketches are
  left out until slice D, so a candidate is a row of facts with the differing values marked (`<mark>`); the parts are
  links with `aria-current`, not React Aria tabs (the part is in the address); the logbook keeps the running imports and
  upload errors, the history of Imports is the Review page's; under the logbook list, links to Imports, Decided and
  Deleted dives (with counts); the "Show deleted dives" reminder is a link to the Review page; a pair says its rule only
  when the group holds more than one kind. Checked in the browser tests (English and German, light and dark, 320 px, 200 %
  text, axe; Review is in the width sweep).

- **Slice C, part 1 (2026-10-07):** the API for the rows and the "Show only" filters, [ADR 0040](../decisions/0040-logbook-rows-and-filters.md)
  (amends ADR 0017): page size 25, `only`, `counts`, `totals`, `months`, and per Dive the Recordings, gas, surface interval,
  source and Participants. The filter for Not in SSI is `not-at-provider`; "same time as another dive" is left to the strip and
  the Review page.

- **Slice C, part 2 (2026-10-07):** the web client's logbook (3.1 to 3.7, without the sketch): dive rows under month
  headings, the totals above, "Show only" chips with counts (`?only=` in the address), "Sort by" as a choice, buddies as
  stacked circles with two letters (`ToggleChip`, `Avatar`, `lib/logbook.ts`). Different from the mock:
  - No profile sketch and no column head (slice D). Depth and duration are right-aligned numbers.
  - "No recording" and "from SSI" are text in the row's facts, not an empty sketch.
  - The range ("1–25 of 214 dives") stands above the list; the pager has only its buttons, and only with more than a page.
  - "Sort by" has eight choices, every way the API sorts in both directions.
  - The day is in the facts without the UTC offset; with its year only when not sorted by date (no month headings then).
    A Dive without a site has its date and time as the title and says "No dive site".
  - The surface interval is shown only under 24 hours.
  - Month headings are `h2`; each counts all its Dives, not the page's share.
  - A chip released at count 0 stays until focus leaves it, so the focus doesn't jump.
  - The Diver choice moved from the page header into the toolbar, beside the search.
  - With no result, the message names the search and the filters, and "Show all dives" clears both and focuses the search.
  - Circles are in the logbook only. Decided by the owner (2026-10-07), as a small slice before D: a circle beside
    each name on the dive page's Participants and on the Divers page, so the circle seen in a row is learned where the
    name is. Left out: the account menu (it shows one person, so a circle tells nothing apart) and the Diver of a
    row (beside the buddies' circles, "whose dive" and "with whom" would look the same). The dive page keeps the
    names beside the circles, not the stack alone: it is where "TK" stops being a guess, the roles (Guide,
    Instructor) would be hidden too, and the names would be reached only through the dialog that changes them.

  Tried on the phone: the chips wrap (two lines at 390 and 320 px in English and German), because a pressed chip must stay
  in sight, which a row that scrolls sideways doesn't promise. The circles were tried at the end of the title's line (at
  320 px the title broke into three lines) and as a third column (its width is every row's, so rows without buddies wrapped
  their numbers too). Kept: depth, duration and the circles share the line under the facts, the numbers keeping clear of
  the widest stack. Checked in the browser tests (`e2e/logbook.spec.ts`, `e2e/ui-quality.spec.ts`: English and German, light
  and dark, 320 px, 200 % text, axe) and in the review screenshots at 1280, 390 and 320 px. Not checked: 320 px together
  with 200 % text and a full stack of circles; real names and a full page of 25 real Dives; a screen reader's reading of
  a row (the names and roles are in the accessibility tree, how it sounds was not listened to).
- **Slice D (2026-10-07):** the profile sketch in the logbook rows (3.1), [ADR 0041](../decisions/0041-logbook-profile-sketch.md):
  stored with the assessment, sent as `profile`, drawn by `ProfileSketch`. Different from the mock: the dashed box is
  empty (the row's facts already say "No recording"); on a phone the sketch is a third column, and a line of its own
  under 26 rem. **Left out: the sketch on the Review page (4.5)**, because its candidates have no profile in their views.
  Checked in the browser tests (the sweeps at 320 px, 200 % text and axe) and in the review screenshots at 1280 and 320 px;
  not looked at: dark mode and German of the sketch, 25 real Dives.

## Not verified

- The mock was looked at in Edge at 1280 and 390 px, light, and the logbook in dark. Not in German, not at 320 px,
  not at 200 % text, no axe run. German runs longer; the toolbar and the chip row are where it will show.
- The mock's disclosure is a plain `<details>`; in the app it would be a React Aria `Disclosure`, and the lane's
  selection must open it. Not prototyped.
- The counts in the mock are invented. How many of the owner's Dives lack a Recording is not measured.
- Row height and page length are from the mock, not from a build with real names.

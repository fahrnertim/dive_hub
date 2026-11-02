---
title: Design system
summary: Visual direction, tokens, components, writing, localization and units of the web client; the brief every screen follows.
status: living
date: 2026-10-05
---

# Design system

Decided in [ADR 0014](../decisions/0014-design-system-and-localization.md), surfaces and density amended by
[ADR 0019](../decisions/0019-tonal-surfaces.md) (visual refresh, 2026-10-04). Code:
`apps/web/src/design/` (tokens, base styles), `apps/web/src/ui/` (components), `apps/web/src/i18n/`
(translations), `apps/web/src/lib/units.ts` (units and formatting).

## Direction

**Subject:** a logbook that a family, club or dive center hosts for itself. Its main job is reading
and keeping dive records: dense numbers, profiles, lists.

**Vocabulary taken from diving:** the water column getting darker with depth, the red-and-white
diver-down flag, the plain clarity of a wet-notes slate.

**One framed sheet, the water face and the profile as the signature.** The app is a white sheet (16 px
radius) on a pale frame; the logbook and the dive page stand on it, and everything else is calm. The depth
profile's area darkens from the surface to the deepest point, like the water column, and is the one bold
element. The diver-down flag is the brand mark. The primary button is ink (near-black, inverted in the dark);
the accent colour means only "link, focus or data". One typeface, no decoration that carries no information.
Design of the overhaul: [spec](../superpowers/specs/2026-11-02-ui-overhaul-design.md).

Checked against generic defaults (frontend-design skill). No cream background, no all-caps labels,
no identical shadowed cards, no gradients as decoration (the only gradient encodes depth), no
monospace for data (tabular figures instead).

## Tokens

Defined once in `design/tokens.css`. Components use only the **semantic** tokens (`--color-*`,
`--space-*`, `--text-*`, `--radius-*`); the `--palette-*` values feed them and are not used directly.

### Color

| Palette name | Hex | Role |
|---|---|---|
| Slate | `#eef3f6` | the frame around the sheet (light) |
| Wet notes | `#ffffff` | panels, inputs (light) |
| Abyss | `#0e1a23` | ink: text and the primary button (light) |
| Open water | `#0f5e8c` | accent: links, focus, data (light) |
| Surface light | `#8fd3e8` | shallow end of the depth ramp |
| Dive flag | `#c8102e` | brand mark only |
| Kelp | `#2a7150` | success |

Dark mode follows `prefers-color-scheme` and is a near-neutral with a faint cool tint, not navy. Frame
`#0b0d0f`, sheet `#131619`, text `#e9eef2`, primary `#e9eef2` with `#0b0d0f` on it, accent `#62b6e6`.
New semantic tokens: `--color-active` (the navigation pill), `--color-primary` and `--color-on-primary`.
`apps/web/test/contrast.test.ts` reads `tokens.css` and checks the pairs below in both schemes.

**Contrast (WCAG 2.2 AA), measured:**

| Pair | Light | Dark |
|---|---|---|
| Text on frame / sheet / sunken | 15.8 / 17.6 / 16.4 | 16.7 / 15.5 / 14.4 |
| Muted text on frame / sheet / sunken | 5.6 / 6.3 / 5.9 | 8.4 / 7.9 / 7.3 |
| Accent on frame / sheet / accent tint; text on accent | 6.3 / 7.0 / 5.9; 7.0 | 8.7 / 8.1 / 6.1; 8.0 |
| Text on primary (the ink button) | 17.6 | 16.7 |
| Danger on sheet | 6.9 | 7.2 |
| Success on sheet | 5.9 | 8.5 |
| Control border on frame / sheet / sunken (≥ 3:1, WCAG 1.4.11) | 3.5 / 3.9 / 3.6 | 4.3 / 4.0 / 3.7 |
| Sheet on frame (decorative, no meaning) | 1.1 | 1.1 |

`--color-border` (dividers between rows) is decorative and lighter; anything that marks a control's
boundary uses `--color-border-strong`. Panels have no outline (ADR 0019); the sheet is set off by tone.

### Type, space, shape

- **Typeface:** IBM Plex Sans (variable, OFL, bundled, never from a CDN), one family.
  Numbers in tables and facts use tabular figures.
- **Scale:** six sizes in rem: `--text-xs` 12, `--text-sm` 14, `--text-md` 16 (body and inputs), `--text-lg` 20
  (section heading), `--text-title` 28 (page title; `--text-xl` and `--text-2xl` are the same), `--text-hero` 32
  (the dive page's facts). Weights 400, 500, 600.
- **Space:** 4 px steps, `--space-1` (4 px) … `--space-7` (48 px).
- **Radius by hierarchy:** `--radius-sm` 2 px (small marks), `--radius-control` 8 px (controls; `--radius-md`),
  `--radius-box` 10 px (boxes inside the sheet; `--radius-lg`), `--radius-sheet` 16 px (the sheet); chips, badges
  and avatars are fully round.
- **Shell and durations:** `--shell-sidebar` 14.5 rem, `--shell-topbar` 3.25 rem; `--duration-hover` 120 ms,
  `--duration-reveal` 150 ms, `--duration-disclosure` 200 ms (all 0 with reduced motion).
- **Surfaces** ([ADR 0019](../decisions/0019-tonal-surfaces.md)): white panels on the slightly deeper page tone,
  no outline, `--panel-padding` 32 px (24/16 px on a phone). Something that waits for the User (Duplicate
  candidates) is tinted with `--color-accent-soft` (`Panel attention`). Terms to confirm before going on (the ODbL before an OSM import) use the same tint in a box (`.terms`), not a `Notice`, which announces itself. One comfortable density: table rows
  keep `--space-3` vertical padding.
- **Text roles:** `.muted` is colour only, so leads and sentences stay at body size; `.meta` is small, muted
  secondary text (counts, entry dates). Large headings use `--tracking-heading` (−0.01em).
- **Elevation:** only things floating above the page (dialogs) get `--shadow-overlay`.
- **Motion** ([ADR 0018](../decisions/0018-icons-and-motion.md)): only entries that explain where
  something came from. Menus and selects grow from their trigger (`--duration-popover`, 150 ms),
  dialogs fade and scale in (200 ms), notices rise in (200 ms). The curve is always `--ease-out`, and
  only `transform` and `opacity` animate. Pages, table rows, the chart, tabs and focus never move.
  All `--duration-*` drop to 0 with `prefers-reduced-motion`.
- **Icons** ([ADR 0018](../decisions/0018-icons-and-motion.md)): Lucide through `ui/Icon.tsx`
  (`<Icon name="edit" />`, or `icon="edit"` on `Button` and menu actions), always beside a visible
  label, `aria-hidden`, in the colour of the text. Table row actions stay text only.
- **Interaction states** (React Aria data attributes, `ui/ui.css`): hover darkens control borders
  (inputs, select, checkbox, radio) or the background (buttons); pressed buttons scale to 0.97
  (`--duration-fast`, ease-out); disabled controls are dimmed with `cursor: not-allowed`; busy
  buttons (`data-pending`) are dimmed with `cursor: progress`; an open select keeps the focus colour on
  its border. CSS `:hover` rules sit inside `@media (hover: hover)`, so they don't stick on touch screens.
- **Touch** (mobile-native skill): links and buttons have `touch-action: manipulation` and no tap highlight;
  buttons, tabs and menu items don't select their label on a long press. Inputs stay at 16 px or more (iOS zooms
  into smaller ones). The browser bar (`theme-color`) has the frame's colour per scheme. Quiet buttons are 32 px tall.
- **Layout:** content up to `--width-content` (72 rem), left-aligned. Every page starts with `PageHeader`
  (h1, meta, lead, the page's actions), then its panels. Single forms (sign-in, setup) are a narrow centered
  panel (`--width-form`, 28 rem) whose title is the h1.

## Components

In `apps/web/src/ui/`, built on React Aria Components (behaviour, keyboard, ARIA) with our CSS
(`ui/ui.css`). Pages use these, not raw form elements.

| Component | Use |
|---|---|
| `Button` | `primary`: the one main action of a form or panel. `secondary`: other actions. `quiet`: inline, text-like (table actions). `danger`: destructive confirmation. `size="small"` (32 px) for an action inside a row (Add to this dive, pager). |
| `TextField` | Label, input, description and error. Validation messages come from our translations. |
| `Checkbox`, `RadioGroup` | Choices. A radio group saves immediately where that is expected (display settings). |
| `Switch` | A setting that takes effect at once (role `switch`, `apps/web/src/ui/Choice.tsx`). `Checkbox` is for a choice submitted with a form. |
| `Form` | React Aria's form with native validation on submit, and the line "* required" at its top while a field carries the mark (hidden in one-line `form-inline` forms). |
| `PageHeader` | The page's h1 with optional meta (a dive's date and Diver), a lead sentence and the page's actions. |
| `Panel` | A titled area of a page; `narrow` for single forms; `attention` for something waiting for the User. |
| `Notice` | What just happened: `info`, `success`, `danger` (announced at once). |
| `Table` | Data tables; numeric columns are right-aligned, header included. The first and last columns line up with the panel's text. A table switches layout by its own width (container query), not the window's: `cards` (tables with an actions column) below 48rem become blocks of label–value lines separated by dividers, and below 22rem the label sits above its value; `stacked` (the Dive sites list) below 40rem becomes two lines per row (`cell-lead` and `cell-main`, then the `cell-sub` cells). Date cells (`date`) don't wrap; e-mail cells (`email`) may break anywhere. |
| `Dialog` | Modal with focus kept inside, for confirmations that need input (deleting a User). Its title row has a close button ("Close dialog"), so no dialog is closed only by Esc or a tap on the rim. |
| `Disclosure` | One line that opens what is behind it (a finding's details, the Dive at a Provider, a Dive's history): the title is the button, with an arrow as the cue; a `summary` stays in sight beside it; the whole line can be pressed. Only the arrow moves. For what most Users need now and then; what waits for the User opens by itself. |
| `ConfirmButton`, `ConfirmDialog` | An action that is hard to undo asks first, in a dialog that says what will happen. The dialog alone serves menu items. |
| `ActionMenu` | Secondary actions behind one button ("Recording actions", "More", the account menu). The panel shows only its main action. |
| `CopyField` | A value shown once with a copy button (invitation and reset links). |
| `NumberField` | Numbers in the UI language's format ("18,5" in German), with a unit after the input. The value commits on blur; `onInput` reacts while typing (the dive form marks a field "edited" then, so nothing moves under a pointer about to press Save). |
| `Select` | One choice from a short list (e.g. a site's water type). `size="small"` inside a table row. |
| `SearchList` | Picking one item from many (a Dive's site, the SSI site): a search field with the results right under it, updated while typing (React Aria `Autocomplete`). At most 10 rows, the typed part of each name marked, a status line with how many match, and a way on when nothing does ("Create … as a new dive site"). Picking a row saves; there is no separate confirm button. Radios are for up to about five fixed options (ux-selection-controls, ux-search). |
| `TextArea` | Multi-line text (notes). |
| `DateTimeField` | Date and time typed by segment, in the UI language's order. |
| `Badge` | A short state: `neutral` ("edited", "open", "processing"), `success` ("done", "accepted"), `danger` ("failed"). States never use the accent colour, which means "you can click this". |
| `ToggleChip` | A filter that is on or off (the logbook's "Show only"): a pill with its count, pressed with a check mark and `aria-pressed`, never by colour alone. Chips stand in a labelled group (`chips`) that wraps; a chip whose count is 0 is not offered unless it is pressed. |
| `Avatar` | A person as a circle with two letters (`initials` in `lib/avatar.ts`), in one of three tones that tell people apart and mean nothing. Always `aria-hidden`: the name stands beside it as text, visible or for screen readers only. Several overlap as an `avatar-stack`, at most three and then "+N". Used in the logbook's rows, beside the names of the dive page's Participants and on the Divers page (`DiverAvatar`, `inline` for body text). |
| Dive rows (`DiveList`) | The logbook is a list, not a table: one row per Dive under month headings, on one grid so numbers, depth and duration line up down the page. The title is the row's link and the whole row can be pressed. Below 38rem of its own width the title keeps the row, and depth, duration and the circles share the line under the facts. |
| `ErrorBoundary` | Keeps a failing part (e.g. the chart) from blanking the page. |
| `BrandMark` | The diver-down flag. |
| `Icon` | A Lucide icon by meaning (`edit`, `import`, `move`, …); the set lives in `ui/Icon.tsx`. |

## Writing

- Plain words from the [glossary](../glossary.md), sentence case, active voice. A button says what
  happens ("Create invitation link"), and the result uses the same verb.
- Errors say what happened and what to do; they don't apologize.
- German uses informal **du**, common in dive clubs. German UI terms are listed per glossary entry.

## Localization

- **i18next** with bundled translations: `i18n/locales/en.json` (source and fallback), `de.json`.
  Keys are grouped by screen (`signIn.*`, `admin.*`, …) and typed: an unknown key is a type error.
- The **language** is the User's preference (`/api/me/preferences`), else the browser's, else English.
  `<html lang>` follows it.
- **Plurals** use i18next suffixes (`_one`, `_other`). Markup inside a sentence uses `<Trans>`
  with named tags (`<strong>`, `<code>`), never sentences glued together from pieces.
- **Server texts are codes.** Every API refusal carries `code` (and an English `error` for logs).
  Import outcomes carry `reason`, failed Imports `errorCode`. The client translates them under
  `errors.*`, `import.reason.*`, `import.errorCode.*`.
- **Tests** (`apps/web/test/translations.test.ts`) check that every translation has the same keys
  and placeholders as English, and that every code in the OpenAPI document has an English text.
- **Adding a language:** copy `en.json`, translate, register it in `i18n/languages.ts` and
  `i18n/index.ts`, and add it to the translation test.

## Units

- Stored in SI-based units (m, °C, bar), converted only for display (`lib/units.ts`).
- The **unit system** (metric or imperial) is a User preference, separate from language. Unset means
  the browser's region decides (imperial for US, LR, MM).
- Numbers and units are formatted with `Intl.NumberFormat` (`style: 'unit'`) in the UI language,
  e.g. "18,5 m", "60.7 ft".
- Pages use `useDisplay()` (`lib/display.ts`) for depth, temperature, duration and dive times.

## Accessibility baseline

WCAG 2.2 AA (accessibility skill): visible focus on everything interactive, keyboard-operable
controls (React Aria), labels on every field, errors announced, tables with headers and a label,
contrast as measured above, `prefers-reduced-motion` respected, a "skip to content" link, `lang`
on the document and on the language names in the picker.

## Rules every page follows

From the [UI review](../research/2026-10-03-ui-review.md). `expectGoodPage` in `apps/web/e2e/support.ts`
checks them. `e2e/ui-quality.spec.ts` runs it on every page in four variants: English light desktop (1280), German dark phone (390),
English light small phone (320) and German light tablet (768), with crowded data (long names and e-mail addresses).
It also sweeps every page from 320 to 1440 px and checks text at 200 % ([responsiveness](../research/2026-10-04-responsiveness.md)).
**A new page gets a test there.**

- **One `h1` per page.** It is the page's title, in `PageHeader` (single forms: `<Panel narrow level={1}>`).
  Headings inside a panel go one level down (`h2.subheading`).
- **The browser tab names the page.** Each page calls `usePageTitle()` (`lib/page.ts`) with its
  h1 text, giving e.g. "Dive 42 – Dive Hub". After navigating, focus moves to the new h1.
- **axe-core finds nothing** (WCAG 2.2 AA plus best practices), in both themes.
- **Nothing scrolls sideways**, neither the page nor a table, from 320 to 1440 px and at 200 % text (WCAG 1.4.10,
  1.4.4). A table that would scroll uses `cards` or `stacked` instead. The `Table` box is positioned so that
  visually hidden labels stay inside it.
- **No two buttons have the same name.** A button repeated per row (Revoke, Rename, Sign out) gets
  `aria-label={t('common.forItem', { action, item })}` ("Revoke: new@example.com"). The visible
  text comes first, so voice control still works (WCAG 2.5.3).
- **No empty table headers.** An actions column is `{ label: t('common.actions'), hidden: true }`.
- **Busy buttons use `isPending`, not `isDisabled`.** Pending keeps keyboard focus and is announced.
  When several buttons share one mutation, the one pressed is pending and the others are disabled.
- **Information is text, not a `title` tooltip.** Keyboard and touch users can't reach tooltips.
- **Units belong to the field's name** (`NumberField unit`), and hints are the field's `description`,
  so screen readers read them with the field.
- **Targets are at least 24 × 24 px** (WCAG 2.5.8), including date segments.
- **Names stay as they are**: the brand, device names and serial numbers carry `translate="no"`.
- **Sentences come whole from the translations** (`history.change`, not `field + ': ' + value`).
  German puts a no-break space before "…".

`apps/web/test/source-rules.test.ts` checks the rules a browser can't easily see: no `title`
tooltips on elements, `isPending` on busy buttons, no empty table headers, `:hover` only for
pointers, no `transition: all`, "…" instead of "...", no line break before "…", and inputs at 16 px or more.
- **A query that fails with a 4xx is not retried** (`shouldRetry` in `api.ts`), so "not found"
  shows at once.
- **Focus never falls to the page.** When the focused element goes away, focus moves on. A form that
  opens focuses its first field, and on closing focus returns to the button that opened it. After an
  item is removed from a list, `refocusAfterRemoval` (`lib/focus.ts`) focuses the next item, else the
  panel heading.
- **One button order, in forms and dialogs alike: the main action first, then Cancel, left-aligned** (`.form-actions`).
  The close button in a dialog's title row is the way out of a dialog that has no Cancel. `source-rules.test.ts`
  fails a row that puts Cancel before a `primary`/`danger`/submit button, and the class `dialog-actions`.
- **Actions that are hard to undo ask first** (`ConfirmButton`): split off, revoke, disable,
  sign out everywhere, demoting yourself. Easily undone actions offer "Undo" instead (discarding a
  Recording).
- **Results are announced.** `Notice` (info, success) and `announce()` (`lib/announce.ts`) speak
  through one polite live region that is always in the page; errors are `role=alert`.
- **Unsaved edits aren't lost silently.** A form with changes calls `useLeaveGuard`
  (`lib/leave-guard.ts`); leaving the page or cancelling then asks first.
- **One main action per panel; the rest in a menu** (`ActionMenu`). Tables whose last column
  holds actions use `cards`, so the actions stay in sight on a phone.
- **Required fields are marked, optional ones are not described.** `isRequired` puts a muted `*` after the label (`aria-hidden`: the
  field's name is unchanged and the input is `required` for assistive technology) and the form says "* required" once. Don't write
  "(optional)" in a label. A field sits at the top of its grid cell (`.field` has `align-content: start`), so a hint beside it never
  pushes its input down. A count of zero is left out of a list row ("0 dives" says nothing).
- **Buttons beside a field line up with its input** (`form-inline`), not with the bottom of its hint.
- **States are badges, dead ends lead somewhere**: an empty or not-found page says why and offers the way
  on ("Back to logbook"); a search field only shows when there is something to search.
- **What the User picks is in the address**: the logbook's Diver filter, search, sort, "Show only" filters
  (`?only=no-recording,no-site`) and page (`lib/logbook.ts`, [ADR 0017](../decisions/0017-logbook-list-paging.md),
  [ADR 0040](../decisions/0040-logbook-rows-and-filters.md)), the dive page's Recording tab (`?recording=`).
  Sortable table headers are buttons with `aria-sort` (`Table` column `sort`); the logbook's rows have no
  headers, so it sorts by a "Sort by" choice.
- **Pictures have text.** The depth profile has a text summary (`aria-describedby`) and its samples
  as a table under "Profile as a table".

## Checking the look

Browser tests (`apps/web/e2e`, Playwright, ADR 0015) cover the main flows. Type checks and unit tests don't show layout. After visual changes, look at the pages in light and
dark mode, in English and German, at phone width (390 px), e.g. with a Playwright script that
takes screenshots (`page.screenshot`), as slice 5 did.

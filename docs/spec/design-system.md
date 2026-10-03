---
title: Design system
summary: Visual direction, tokens, components, writing, localization and units of the web client; the brief every screen follows.
status: living
date: 2026-10-04
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

**One bold element, everything else quiet.** The depth profile's area darkens from the surface to
the deepest point, like the water column. The diver-down flag is the brand mark. Everything else is
calm: panels set off from the page by tone alone (no outline, no shadow), one typeface, no decoration
that carries no information.

Checked against generic defaults (frontend-design skill). No cream background, no all-caps labels,
no identical shadowed cards, no gradients as decoration (the only gradient encodes depth), no
monospace for data (tabular figures instead).

## Tokens

Defined once in `design/tokens.css`. Components use only the **semantic** tokens (`--color-*`,
`--space-*`, `--text-*`, `--radius-*`); the `--palette-*` values feed them and are not used directly.

### Color

| Palette name | Hex | Role |
|---|---|---|
| Slate | `#e9eef2` | page background (light); panels lift off it by tone |
| Wet notes | `#ffffff` | panels, inputs (light) |
| Abyss | `#0b2236` | text (light) |
| Open water | `#0f5e8c` | accent: links, primary buttons, focus (light) |
| Surface light | `#8fd3e8` | shallow end of the depth ramp |
| Dive flag | `#c8102e` | brand mark only |
| Kelp | `#2a7150` | success |

Dark mode ("night dive") follows `prefers-color-scheme`. Background `#061522`, panels `#0e2338`,
text `#dce8f0`, accent `#62b6e6`.

**Contrast (WCAG 2.2 AA), measured:**

| Pair | Light | Dark |
|---|---|---|
| Text on background / panel / attention tint | 13.9 / 16.2 / 13.7 | 14.8 / 12.8 / 10.6 |
| Muted text on background / panel / tint | 5.2 / 6.1 / 5.1 | 7.3 / 6.3 / 5.2 |
| Accent on background / panel; text on accent | 6.0 / 7.0; 7.0 | 8.2 / 7.1; 8.0 |
| Danger on panel; text on danger | 6.9; 6.9 | 6.3; 7.1 |
| Success on panel | 5.9 | 7.5 |
| Badges: neutral, success, danger on their fill | 5.2, 5.1, 5.9 | 6.8, 6.7, 6.3 |
| Control border on background / panel / tint (≥ 3:1, WCAG 1.4.11) | 3.3 / 3.9 / 3.3 | 4.7 / 4.1 / 3.4 |
| Panel on background (decorative, no meaning) | 1.17 | 1.19 |

`--color-border` (dividers between rows) is decorative and lighter; anything that marks a control's
boundary uses `--color-border-strong`. Panels have no outline (ADR 0019).

### Type, space, shape

- **Typeface:** IBM Plex Sans (variable, OFL, bundled, never from a CDN), one family.
  Numbers in tables and facts use tabular figures.
- **Scale:** minor third (×1.2) on 16 px: `--text-xs` … `--text-2xl`.
- **Space:** 4 px steps, `--space-1` (4 px) … `--space-7` (48 px).
- **Radius by hierarchy:** `--radius-sm` 2 px (small marks, badges), `--radius-md` 6 px (controls, rows inside a
  panel), `--radius-lg` 14 px (panels).
- **Surfaces** ([ADR 0019](../decisions/0019-tonal-surfaces.md)): white panels on the slightly deeper page tone,
  no outline, `--panel-padding` 32 px (24/16 px on a phone). Something that waits for the User (Duplicate
  candidates) is tinted with `--color-accent-soft` (`Panel attention`). One comfortable density: table rows
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
- **Touch:** links and buttons have `touch-action: manipulation` and no tap highlight. Quiet
  buttons are 32 px tall.
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
| `Form` | React Aria's form with native validation on submit. |
| `PageHeader` | The page's h1 with optional meta (a dive's date and Diver), a lead sentence and the page's actions. |
| `Panel` | A titled area of a page; `narrow` for single forms; `attention` for something waiting for the User. |
| `Notice` | What just happened: `info`, `success`, `danger` (announced at once). |
| `Table` | Data tables that scroll sideways on phones; numeric columns are right-aligned, header included. The first and last columns line up with the panel's text. `cards`: on a phone each row becomes a block of label–value lines, separated by dividers (tables with an actions column). `stacked`: on a phone each row becomes two lines (`cell-lead` and `cell-main`, then the `cell-sub` cells), as in the logbook. |
| `Dialog` | Modal with focus kept inside, for confirmations that need input (deleting a User). |
| `ConfirmButton`, `ConfirmDialog` | An action that is hard to undo asks first, in a dialog that says what will happen. The dialog alone serves menu items. |
| `ActionMenu` | Secondary actions behind one button ("Recording actions", "More", the account menu). The panel shows only its main action. |
| `CopyField` | A value shown once with a copy button (invitation and reset links). |
| `NumberField` | Numbers in the UI language's format ("18,5" in German), with a unit after the input. The value commits on blur; `onInput` reacts while typing (the dive form marks a field "edited" then, so nothing moves under a pointer about to press Save). |
| `Select` | One choice from a short list (e.g. water type). `size="small"` inside a table row. |
| `TextArea` | Multi-line text (notes). |
| `DateTimeField` | Date and time typed by segment, in the UI language's order. |
| `Badge` | A short state: `neutral` ("edited", "open", "processing"), `success` ("done", "accepted"), `danger` ("failed"). States never use the accent colour, which means "you can click this". |
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
checks them. `e2e/ui-quality.spec.ts` runs it on every page, in English on a light desktop and in
German on a dark phone. **A new page gets a test there.**

- **One `h1` per page.** It is the page's title, in `PageHeader` (single forms: `<Panel narrow level={1}>`).
  Headings inside a panel go one level down (`h2.subheading`).
- **The browser tab names the page.** Each page calls `usePageTitle()` (`lib/page.ts`) with its
  h1 text, giving e.g. "Dive 42 – Dive Hub". After navigating, focus moves to the new h1.
- **axe-core finds nothing** (WCAG 2.2 AA plus best practices), in both themes.
- **Nothing scrolls the page sideways** at 390 px. Wide tables scroll inside `Table`, whose box
  is positioned so that visually hidden labels stay inside it.
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
pointers, no `transition: all`, "…" instead of "...", and no line break before "…".
- **A query that fails with a 4xx is not retried** (`shouldRetry` in `api.ts`), so "not found"
  shows at once.
- **Focus never falls to the page.** When the focused element goes away, focus moves on. A form that
  opens focuses its first field, and on closing focus returns to the button that opened it. After an
  item is removed from a list, `refocusAfterRemoval` (`lib/focus.ts`) focuses the next item, else the
  panel heading.
- **Actions that are hard to undo ask first** (`ConfirmButton`): split off, revoke, disable,
  sign out everywhere, demoting yourself. Easily undone actions offer "Undo" instead (discarding a
  Recording).
- **Results are announced.** `Notice` (info, success) and `announce()` (`lib/announce.ts`) speak
  through one polite live region that is always in the page; errors are `role=alert`.
- **Unsaved edits aren't lost silently.** A form with changes calls `useLeaveGuard`
  (`lib/leave-guard.ts`); leaving the page or cancelling then asks first.
- **One main action per panel; the rest in a menu** (`ActionMenu`). Tables whose last column
  holds actions use `cards`, so the actions stay in sight on a phone.
- **Buttons beside a field line up with its input** (`form-inline`), not with the bottom of its hint.
- **States are badges, dead ends lead somewhere**: an empty or not-found page says why and offers the way
  on ("Back to logbook"); a search field only shows when there is something to search.
- **What the User picks is in the address**: the logbook's Diver filter, search, sort and page
  (`lib/logbook.ts`, [ADR 0017](../decisions/0017-logbook-list-paging.md)), the dive page's Recording
  tab (`?recording=`). Sortable table headers are buttons with `aria-sort` (`Table` column `sort`).
- **Pictures have text.** The depth profile has a text summary (`aria-describedby`) and its samples
  as a table under "Profile as a table".

## Checking the look

Browser tests (`apps/web/e2e`, Playwright, ADR 0015) cover the main flows. Type checks and unit tests don't show layout. After visual changes, look at the pages in light and
dark mode, in English and German, at phone width (390 px), e.g. with a Playwright script that
takes screenshots (`page.screenshot`), as slice 5 did.

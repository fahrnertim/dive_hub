---
title: UI overhaul - a calmer, more striking web client
summary: A redesign of the web client's look and structure. A framed-sheet shell (sidebar on desktop, top bar and bottom bar on a phone), a new palette on the same typeface, and the depth profile as the one striking element. Less at first glance - setup and rare actions move behind menus, per-Diver pages and one Settings area. Skeletons replace "Loading…", and subtle motion is added where it helps. The ADR changes are drafted at the end for the owner.
status: accepted
date: 2026-11-02
---

# UI overhaul

## Why

In the owner's words (2026-11-02): "It looks ok as is but it just does not give me the wow effect when looking at
it." The owner also said the app "feels pretty overwhelming because of too much content on settings etc."

The owner wants three things:

- **Rethink first glance.** Decide what must show at first glance and what can sit one step away.
- **Skeletons for loading.**
- **Some neat animations,** "loading, states etc. don't overdo it just subtle and where it helps".

**Owner decisions (2026-11-02):**

- **Free to redesign.** A new palette, type and style are allowed, within WCAG 2.2 AA, in light and dark mode
  and on phones.
- **Navigation is open too:** "there is no need to stick to existing navigation, look and feel. If it can be
  done cleaner/better looking and feeling it's worth doing."
- **The taste skill.** It is installed (`design-taste-frontend`) with the override in
  [docs/skills.md](../../skills.md#overrides): its app-screen rules, none of its scripts, and our accessibility
  and motion rules win.
- **How the work runs.** It is built unattended on branch `ui-overhaul` (from `dive-continuation`). It ends
  as a PR with before/after screenshots, and the branch may be thrown away.
- **Protected paths.** Changes to ADRs, the schema and migrations are drafted for the owner. They never
  block the work (see [Pending ADR changes](#pending-adr-changes)).

Everything below that the owner did not decide is marked **(my call)**.

## Goals

1. **A product with a face.** The app should look designed, not like a kit. It keeps one striking element,
   the depth profile as the water column, and everything else stays quiet and exact.
2. **Less at first glance.** Each screen answers its one question first. Setup, rare actions and
   explanations sit one step away: in a menu, a disclosure, a Diver's own page, or Settings.
3. **Loading looks like the page.** Skeletons in the final layout replace every "Loading…" line of a page or
   panel.
4. **Subtle motion where it explains:** content arriving, disclosures opening, hover and press feedback. It
   is never decoration, and nothing moves with reduced motion.

## Non-goals

- **No new features, no API or schema changes.** The [client contract](../../spec/clients.md) is unchanged:
  every duty it lists is still met, some of them one step further away.
- **No new typeface download, no images.** IBM Plex Sans stays and is already bundled. The taste override
  forbids photographs and downloaded assets.
- **No change to wording.** Texts move or fold away but keep their words, except the few new labels named
  here.

## Anti-goals (a failure even if it works)

- **A generated dashboard look:**
  - gradients on chrome;
  - glows or glass;
  - icons in tinted circles;
  - a dark navy sidebar;
  - KPI cards with sparklines;
  - an accent colour on every button.
- **A function the owner can no longer find.** Every action that exists today stays reachable, at most two
  steps from where it was. The browser tests prove it.
- **Motion that performs:** entrances on page load, bouncing, or anything that slows a frequent action.
- **Losing accessibility:**
  - axe must stay clean;
  - one h1 per page;
  - focus rules and 24 px targets stay;
  - nothing scrolls sideways from 320 to 1440 px or at 200 % text.

## Constraints

- **The [design system](../../spec/design-system.md) still applies:** its rules list, accessibility baseline,
  writing and localization. Its tokens, Direction and Components sections are rewritten by this work.
- **Checks.** `expectGoodPage` and `ui-quality.spec.ts` keep passing in all four variants, and
  `source-rules.test.ts` keeps passing.
- **Motion tokens:**
  - only `transform` and `opacity` animate, plus `background-color`/`color` on hover (my call);
  - the curve is `--ease-out`;
  - every `--duration-*` drops to 0 with `prefers-reduced-motion`.
- **Old links keep working.** Old hash routes redirect: `#/account?tab=…` goes to the matching settings
  view, and `#/divers?certifications=own` still opens the certifications.
- **i18n.** Every new string is added in English and German.

## The direction (my call)

The taste skill's app-screen run was done by reading its library rather than running `draw.mjs`. The style is
**`framed-sheet`**, because it suits a tool people work in for long sessions and its typeface is IBM Plex Sans,
which we already bundle. Its one move is kept: the app chrome is a tinted frame, and the work sits on one
white sheet with a hairline edge and soft corners.

**Its face:** a ground tinted from the water, plus the water hue on the main data element (the depth
profile). The brand red (the diver-down flag) appears in the mark only.

**The signature element:** the depth profile drawn as the water column. It is the hero of the dive page and
a larger, clearer thumbnail on every logbook row.

### Palette

These are starting values. The builder measures every text pair (≥ 4.5:1) and every control boundary
(≥ 3:1). Where a value fails, the builder adjusts it within its role and records the measured table in the
design system.

| Role (token) | Light | Dark |
|---|---|---|
| Frame / ground `--color-bg` | `#eef3f6` | `#0b0d0f` |
| Sheet / surface `--color-surface` | `#ffffff` | `#131619` |
| Raised, hover, sunken `--color-surface-sunken` | `#f4f7f9` | `#1a1e22` |
| Active nav pill `--color-active` (new) | `#e2e9ee` | `#23292e` |
| Hairline edge, row rule `--color-border` | `#e1e7ec` | `#22272c` |
| Control boundary `--color-border-strong` | `#6e8497` | `#6b7782` |
| Ink `--color-text` | `#0e1a23` | `#e9eef2` |
| Muted `--color-text-muted` | `#52626f` | `#a1acb5` |
| Primary fill `--color-primary` (new) / on it | `#0e1a23` / `#ffffff` | `#e9eef2` / `#0b0d0f` |
| Accent (links, focus, data, active tab line) | `#0f5e8c` | `#62b6e6` |
| Depth ramp shallow → deep | `#8fd3e8` → `#0f5e8c` | `#62b6e6` → `#1b4867` |

- **Status colours keep their roles:** danger, success, and the ascent ramp (ADR 0036). Each is re-measured
  on the new surfaces.
- **The dark mode is a true near-neutral** with a faint cool tint, not navy. This is the skill's rule and
  my call; it replaces the "night dive" navy.
- **The primary button turns ink** (near-black on light, inverted on dark). The accent colour now means
  "link, focus or data" only. Secondary buttons are white with a control border; quiet buttons are text.

### Type, space, shape

- **Typeface:** IBM Plex Sans.
- **Sizes:**

  | Use | Size |
  |---|---|
  | Meta | 12 |
  | Secondary | 14 |
  | Body and inputs | 16 |
  | Section heading | 20 |
  | Page title | 28 |
  | Hero figure (dive page facts) | 32 |

  That is six sizes, all in rem.
- **Weights:** 400, 500 and 600. 600 is for titles and hero figures. Tabular figures are used everywhere a
  number aligns.
- **Radius:**

  | Thing | Radius |
  |---|---|
  | The sheet | 16 px |
  | Boxes inside the sheet | 10 px |
  | Controls | 8 px |
  | Chips, badges, avatars | Full round |

- **Separation inside the sheet:** space and 1px rules. No panels nested in panels; a box inside the sheet
  uses one tone step (`--color-surface-sunken`), never a border and a shadow together.
- **Shadows:** only on what floats (menus, dialogs, sheets).

## The shell (my call)

**Desktop (≥ 64rem):**

- **No top bar.** A labelled sidebar of about 232px sits on the tinted ground.
- **The sidebar, top to bottom:**
  - the flag mark and "Dive Hub";
  - the main destinations, each with an icon and a label: Logbook (with its to-decide count), Divers,
    Dive sites, Dive centres, Tools;
  - at the bottom: Settings, then the user row (avatar and name), which opens a menu with
    Certifications and Sign out.
- **The active item** is a neutral pill (`--color-active`) with the label in ink.
- **The page** is the white sheet, inset 8px from the window's top, right and bottom edges, with a
  16px radius and a 1px edge. The sheet scrolls; the sidebar stays.

**Below 64rem:**

- **The sidebar folds.** A 52px top bar shows the mark and wordmark on the left and the avatar button on the
  right (Settings, Certifications, Sign out).
- **The destinations** move to a bottom bar of the same five items, with short labels, safe-area padding
  and the count on Logbook. This keeps today's phone pattern, restyled.
- **The sheet** runs full width with no inset.

**Settings** (the owner's "too much content on settings") is **one area with its own sub-navigation**. Each
section is its own view, `#/settings/<section>`, with its name as the h1:

| Section | Holds (from today's page) |
|---|---|
| Display | Language and units (the Account tab's Display) |
| Sign-in and security | Change password, where you're signed in |
| Connections | The Account page's Connections tab, unchanged inside |
| AI access | The AI access tab, unchanged inside |
| Devices | The Divers page's Devices table |
| Administration (admins only) | Today's admin page |

- **The sub-navigation** is a list beside the content on desktop. On a phone, `#/settings` shows the list,
  and each section has a back link to it.
- **Old routes redirect:**
  - `#/account` → `#/settings/display`;
  - `?tab=connections` → `#/settings/connections` (the `connection=` parameter is kept);
  - `?tab=ai` → `#/settings/ai-access`;
  - `#/admin` → `#/settings/admin`.

## First glance, screen by screen

Each screen names its one question. What leaves the first glance stays one step away.

### Logbook - "What did I dive lately, and does anything need me?"

**At first glance:**

- **The title row:** "Logbook" with a one-line summary ("7 dives · 3 h under water · deepest 40 m"),
  replacing the four-figure stats block, plus one primary action, Import files. A "More" menu holds
  Imports and Deleted dives.
- **The decision line.** When something waits, one compact line names it with its link ("1 recording
  needs your decision · Review"). It replaces the tinted banner.
- **One filter row:**
  - search;
  - the Diver select, shown only when there is more than one Diver;
  - sort, as a compact select;
  - the "Show only" chips, folded behind a "Filters" button with a count when some are on.
- **The rows** on the existing grid: number, title (date or site), meta, a larger profile thumbnail
  (the signature), depth and duration. Titles are not underlined; the whole row has a hover tint.

**One step away:**

- the drop-anywhere hint (it shows in the drop overlay and the empty state);
- the stats (they stay in the summary line);
- the "Show only" filters (behind Filters).

### Dive - "What did this dive look like?"

**At first glance:**

- **The title row:** "Dive 42", the date and the Diver, with Edit and More. Previous and next sit in the
  title row.
- **A facts strip** at hero size: max depth, duration, water temperature and gas. Average depth and water
  type follow as smaller facts.
- **The depth profile** at full sheet width, taller than today: the signature.
- **The details that have values:** site, buddies, cylinders, suit and lead, notes.

**One step away:**

- **Empty details** become one row of "Add …" chips (Add site, Add buddies, Add cylinders, Add suit and
  lead, Add notes), replacing a grid of dashes, each with its own Add link.
- **The Recording tabs** show only when there is more than one Recording. With one, its actions sit in
  More.
- **The assessment** keeps its one-line summary and the flying-after line. Its notes and "what it can and
  can't tell" sit in a disclosure.
- **Provider status (SSI) and History** go into one quiet "About this dive" section at the end.

### Divers - "Whose dives do I keep, and who did I dive with?"

**At first glance:**

- **Logbooks you keep** as rows: avatar, name, the dive count as a link to their logbook, and the
  certification count.
- **Other divers** as rows, with search. Each row's actions (Codes, Rename, Merge into…, Delete) move into
  one row menu ("Actions: Kai Lund").
- **The add fields** stay at the end of each list.

**One step away:**

- **Each kept Diver gets their own page,** `#/divers/<id>`, holding everything today's page expands
  inline: certifications, dive numbers, codes, body weight, rename and delete. The `?certifications=` link
  opens that page at its certifications.
- **Devices** move to Settings → Devices.

### Tools - "How long can I stay, and on how much gas?"

- **At first glance:** the dive inputs (oxygen, helium, depth, cylinder) and, beside them on desktop or
  right under them on a phone, the result at hero size ("Bottom time 16 min, limited by gas") with its
  limits table.
- **The settings disclosure** is closed by default. Its summary line names the current values ("Salt ·
  sea level · fixed reserve 60 bar · 20 L/min · GF 85").
- **One step away:**
  - "What this assumes" in a disclosure;
  - the gas figures (MOD and so on) stay, under the result.
- **The estimate notice** stays visible: it is a safety line. It becomes one quiet line under the title,
  not a box.

### Other pages

Dive sites, Dive centres, Review, Deleted dives, Imports, sign-in, invitation and not-found take the new
shell, tokens and components without being reorganised. Each page's own panels become sections of the
sheet.

**A list page's row actions** follow the Divers pattern when a row has more than two actions (my call).

## Loading: skeletons

**`ui/Skeleton.tsx`:**

- **The pieces:**
  - `SkeletonLine` (a text line at a given width);
  - `SkeletonBlock` (a box of a given height);
  - `Skeleton` (a wrapper with `aria-busy` and one hidden "Loading…" for screen readers, so nothing
    announces each bar).
- **The look:** flat `--color-surface-sunken` bars at the real size of the text they stand for, with no
  shimmer gradient. Labels and headings that don't depend on the data render at once.

**The behaviour:**

- **A short delay.** A skeleton shows only after 150 ms. A fast load shows nothing, then the content, so
  there is no flash.
- **A pulse.** Once shown, the bars pulse gently (opacity 1 → 0.55 → 1, 1.6 s, ease-in-out, infinite).
  With reduced motion they are static.
- **The arrival.** The real content replaces the skeleton with a 150 ms opacity fade, and the layout does
  not shift. The skeleton has the content's shape.
- **A refresh** of data already on screen keeps the old values. There is no skeleton then.

**Shaped skeletons** for:

- the logbook rows (eight rows on the row grid, with a profile-sized block);
- the dive page (title, facts strip, profile block);
- the Divers rows;
- the Settings sections;
- the sites and centres lists;
- the app's first load (the shell with an empty sheet).

Smaller panels and dialogs (body weight, codes, the restore preview) use two or three `SkeletonLine`s in
place of "Loading…".

## Motion (my call, within the owner's "subtle and where it helps")

| What | How | Why |
|---|---|---|
| Content replacing a skeleton | opacity 0 → 1, 150 ms | the data arrives instead of popping |
| Skeleton pulse | as above, off with reduced motion | shows that it is still working |
| Disclosure opens/closes | height via `grid-template-rows` 0fr → 1fr plus opacity, 200 ms, `--ease-out`; the arrow rotates | shows where the content came from |
| Hover on rows, nav items and buttons | `background-color` 120 ms | feedback that doesn't flicker |
| Bottom bar and sidebar active pill | none (instant) | navigation is frequent |
| Menus, dialogs, notices, pressed buttons | unchanged (ADR 0018) | already right |
| A row added or removed | none | frequent, and it is data |
| Menus on a phone (below 40rem) | the shared `ActionMenu` opens as a bottom sheet, rising 16px with a fade over 200 ms; exits are instant. On wider screens menus stay as ADR 0018 has them | a phone-native place for a menu |

Page changes, sorting, tab switches and the chart stay still, as ADR 0018 says.

## Settled after the builder check (my calls)

- **The Account tab** holds Display, Change password and Where you're signed in, nothing else. The Settings table
  is complete.
- **`#/divers?certifications=own`** and the user menu's Certifications open the User's own Diver page at its
  certifications: `#/divers/<own id>?open=certifications`. Every account has its own Diver. If one can't be
  found, the link goes to `#/divers`. `?certifications=<id>` redirects the same way to that Diver's page.
- **Other divers** (non-kept) get no page. Their row menu holds Codes, Rename, Merge into… and Delete, which
  open today's dialogs.
- **Menus.** There is one menu component: `ActionMenu` becomes a bottom sheet below 40rem for every menu
  (focus trapped, Esc and the backdrop close it), and stays a popover above that.
- **Administration.** The sidebar and bottom bar are the same for every User. The Administration section is
  listed only for admins. A direct link from a non-admin shows today's "admins only" notice.
- **Bottom bar.** It holds all five destinations at 320 px with no overflow. `ui-quality.spec.ts` checks this.
- **Filters.** The Filters button opens a disclosure panel under the filter row, which opens by itself when a
  filter is on. The filter state stays in the address as today.
- **Tests and skeletons.** Tests wait on the visible content, not on `aria-busy`.

## Left to the builder

- Exact component structure, class names, and how the sheet and sidebar are laid out in CSS.
- Contrast adjustments to the palette, measured and recorded.
- Which existing tests change, and how. A test that checked the old structure is rewritten to check the same
  behaviour in the new one. A test is never deleted to make the run pass.
- The skeleton shape of each page, within the rules above.
- Updating [design-system.md](../../spec/design-system.md): its Direction, tokens, contrast table,
  components (Skeleton, Sidebar, Settings layout, row menu) and motion. Also `scripts/check-lib.mjs`
  areas for new files.

## Pending ADR changes

These are drafted for the owner, who pastes them in. `docs/decisions/` is a protected path and was left alone.

**ADR 0064 - UI overhaul: framed sheet, sidebar, skeletons and motion** (new, `accepted` on the owner's
approval). It supersedes parts of ADR 0014 (palette and direction), ADR 0018 (motion) and ADR 0019 (surfaces).

> **Context.** The owner asked on 2026-11-02 for a redesign with "the wow effect", less at first glance, skeletons
> and subtle motion, and freed the navigation and look. Design: `docs/superpowers/specs/2026-11-02-ui-overhaul-design.md`.
>
> **Decision.**
> - **Shell.** A tinted frame (a sidebar on desktop; a top bar and a bottom bar below 64rem) holds the page,
>   which sits on one white sheet with a 1px edge and 16 px corners.
> - **Surfaces.** Sections inside the sheet are separated by space and rules, and a box inside it by one tone
>   step. This supersedes ADR 0019's white panels on a slate page.
> - **Palette and buttons.** A near-neutral palette with the water hue on links, focus and data only, and an
>   ink primary button. Dark mode is near-neutral, not navy. This supersedes ADR 0014's palette table; the flag
>   mark and IBM Plex Sans stay.
> - **Settings.** One Settings area with a view per section (Display, Sign-in and security, Connections,
>   AI access, Devices, Administration), and a page per kept Diver.
> - **Skeletons.** Flat bars in the final layout replace "Loading…". They show after 150 ms and pulse gently
>   (off with reduced motion), and the content fades in over 150 ms.
> - **Motion.** Added to ADR 0018's list:
>   - the skeleton pulse;
>   - content arrival;
>   - disclosures opening by height;
>   - hover colour transitions of 120 ms;
>   - phone menus as bottom sheets.
>
>   ADR 0018's "loading placeholders never animate" is replaced by the skeleton rules above. Everything else
>   in ADR 0018 stands.
>
> **Consequences.** The browser tests are updated for the new structure. Old `#/account` and `#/admin` links
> redirect. ADRs 0014, 0018 and 0019 get a "Partly superseded by ADR 0064" line.

**Status lines** to add to ADRs 0014, 0018 and 0019: "Partly superseded by [ADR 0064](0064-ui-overhaul.md)
(2026-11-02)."

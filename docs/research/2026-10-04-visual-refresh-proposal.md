---
title: Visual refresh proposal
summary: Ranked changes from the 16 review screenshots (2026-10-04) and three options for the direction (surfaces, radius, density), with a mocked logbook page. Proposals only; the owner picks before the app changes.
status: done
date: 2026-10-04
---

# Visual refresh proposal

Step 3–4 of the [visual refresh brief](2026-10-03-visual-refresh.md). Material:
`pnpm --filter @dive-hub/web review:capture` on 2026-10-04 (16 screenshots, all looked at), the
tokens and CSS (`design/tokens.css`, `ui/ui.css`, `pages.css`), and the skills `frontend-design`,
`emil-design-eng` and the uxcel `ux-*` set. Mock: [assets/2026-10-04-visual-refresh-mock.html](assets/2026-10-04-visual-refresh-mock.html)
(open it in a browser from the repository; the switcher at the top changes direction, density and theme).

Screenshots are named as in `apps/web/review-output/`: 01 logbook, 02 dive, 03 dive edit, 04 divers,
05 account, 06 admin, 07 logbook dark, 08–11 German phone, 12 sign-in errors, 13 invitation,
14 empty logbook, 15 empty divers, 16 dive not found.

## What the screenshots show overall

The pages are correct and accessible, but they read as "default": every section is the same white box
with the same border on a grey page, the most important thing on a page is not always first, and
small muted text does too many jobs. "Clean and modern" here means **fewer, clearer levels**:
one page head, sections that differ only where they mean something different, text roles that don't
shrink unrelated things, and states that look like states.

## Ranked changes within the design system (no ADR needed)

Ranked by how many places one fix reaches and how much it helps the User. All of them are shown in the
mock in every direction.

| # | Change | Before (where) | After | Why |
|---|---|---|---|---|
| 1 | **Split text colour from text size.** `.muted` sets colour *and* `--text-sm`; make it colour only and add a size role (`.small`, `.hint`). Leads stay at body size. | Reason in the decision panel shrinks mid-sentence (01, 07, 08); the sign-in and invitation intro is smaller than the sentence after it (12, 13); "Diver: Erika" and "It might belong to" in tiny type (01, 02); "No notes yet." (02) | Lead sentences at `--text-md` in muted colour; hints, meta and counts at `--text-sm` | One shared class causes all of these; one fix in `ui.css` and `Muted` |
| 2 | **One page head on every page:** h1, optional lead, the page's actions on the right. Sections follow. | The Logbook's h1 is the third panel, under "Needs your decision" and "Imports" (01); Divers, Account, Admin put the h1 above the panels, Logbook and Dive inside one (two patterns) | `PageHeader` component; Logbook order: head → decision → dives → recent imports; Dive: head with date, Diver and Edit/More, facts below | The page title is where people look first; one pattern for all pages |
| 3 | **States are badges, not coloured words.** | "done" in green and "open" in the accent colour, the colour that means "you can click this" (01, 06, 11) | `Badge` with `neutral`, `success`, `danger` tones (contrast 5.1–6.8:1, measured); accent never on static text | Colour has one meaning (better-colors "one colour, one meaning"); states read as states |
| 4 | **Decision panel: what, why, choices.** | One run-on line with the reason in small grey text; "Add to this dive" is a link-styled button glued to the end of the candidate line; three action styles in one panel (01, 08) | Tinted "attention" section; recording on one line, the reason as a full sentence below; each candidate a row with its own small secondary button; "Make it a new dive" and "Discard" as the footer | It's the one thing on the page that waits for the User; the choices should be obvious |
| 5 | **Lighter, aligned tables.** | Cell padding pushes the first column 12 px in from the section's edge (04, 05, 06); visible "Actions" header in Users but hidden in Invitations; full-strength underlines on every date link; 40 px selects inside device rows | First and last column flush with the section edge; header padding reduced; underline at 40 % of the link colour (still visible, WCAG 1.4.1); a small select size for rows; no border under the last row | Less chrome around the numbers people read |
| 6 | **Phones.** | Logbook table cut after "Max depth" (08); cards inside panels make boxes in boxes, with bold labels and regular values, so the labels outweigh the values (10, 11); the two Recording tabs stack into two rows (09) | Logbook rows as two lines (date link, then "Erika · 18.5 m · 30 min"), no sideways scroll; `cards` rows separated by dividers instead of boxes, labels in muted regular; tab list scrolls sideways with the next tab peeking in | The brief's last open layout flaw, and the nested boxes are what make phones look busy |
| 7 | **Form alignment.** | The "Add" button sits ~5 px lower than its field (04, 15: `form-inline` aligns to the bottom of the field, which includes the gap for its hint); in the edit form "UTC offset" hangs alone under Start and leaves a hole (03); date segments show as "1 /15/2026" (03) | Align inline buttons to the input, not the field; Start and UTC offset share one grid cell; no padding on literal date segments | Small, but these are the "something is off" moments |
| 8 | **Empty and error states that lead somewhere.** | Empty logbook shows a search field with nothing to search (14); "Dive not found" is a small red strip with no next step (16) | Hide search until there are dives; "Dive not found" as an empty state: a sentence and a "Back to logbook" button | ux-empty-states: an empty screen invites the next action |
| 9 | **Headings.** | h1 is `--text-2xl` on Divers/Account/Admin but `--text-xl` inside a panel (Logbook, Dive); large headings at default tracking | One h1 size; `letter-spacing: -0.01em` on h1 and h2 | Consistent hierarchy; large Plex looks loose without it |
| 10 | **Chart and small details.** | Rotated "°C" axis label (02, 09); one-item bullet lists in History (02); the info notice wraps its sentence at 70ch while the link below runs full width (06) | Unit as a horizontal label at the top of the axis; History changes as plain lines; notices without the paragraph cap | Each is small; together they remove the remaining rough edges |

Out of scope (owner's earlier "not wanted" list still holds): cream backgrounds, serif headings,
uppercase pills, glass, scroll reveals, decorative gradients.

## Direction options (surfaces, radius, density)

These change ADR 0014's "panels with borders instead of shadows" wording (A doesn't). Whichever is
picked gets a new ADR amending ADR 0014. None of them uses shadows on the page; `--shadow-overlay`
stays for dialogs and popovers only. Control borders stay at ≥ 3:1 in all options (WCAG 1.4.11).

| | A: Refined panels | B: Tonal surfaces | C: One sheet |
|---|---|---|---|
| Idea | Today's look, tidied: the fixes above, slightly rounder panels | Panels lift off a slightly deeper page tone; no outline | The page *is* the surface; sections are separated by space and a rule under each heading |
| Page background | `#f3f6f8` (as now) | `#e9eef2` (dark `#061522`) | `--color-surface` `#ffffff` (dark `#0e2338`) |
| Panel | white, 1 px `#d5dfe6` border | white, no border | none |
| Panel radius | 10 → 12 px | 10 → 14 px | — (12 px on the one tinted "attention" block) |
| Panel padding | 24 px (16 px phone) | 32 px (24/16 px phone) | 0; sections 48 px apart |
| Attention (decision) | tinted, accent-tinted border | tinted | tinted block, the only box on the page |
| Contrast panel/page (decorative) | 1.09 + border | 1.17 (light), 1.19 (dark) | — |
| Feels | familiar, safe | calmer, the most "modern" of the three | most open; long pages (Dive) depend on headings alone |
| Effort | tokens + the fixes | tokens + the fixes | tokens + the fixes + check every page's grouping (Dive has facts, recordings, chart, history) |

**Density** is a separate choice (mock switch "Density"):

- **Comfortable** (as now): table rows ≈ 45 px (`--space-3` vertical padding).
- **Compact:** table rows ≈ 37 px (`--space-2`). More dives per screen; row links stay ≥ 24 px apart
  (WCAG 2.5.8 spacing exception).

A per-User density setting is possible later, but it doubles what each page must be checked in; one
fixed density is recommended for now.

**Recommendation: B with comfortable density**, compact only for the logbook table if you want more
rows per screen. B removes the most visual noise (thirty-odd panel outlines across the app) without
losing the grouping that the Dive page and Admin need, and its tonal step works in the night-dive
theme too. A is the fallback if you'd rather not touch ADR 0014. C is the most distinctive but makes
the Dive page harder to scan.

## Outcome (2026-10-04)

The owner chose all ten changes and direction B with comfortable density ([ADR 0019](../decisions/0019-tonal-surfaces.md)).
Implemented in tokens and components (`PageHeader`, `Badge`, `Panel attention`, `Table stacked`, small
`Button` and `Select`), then pages. Notes per change:

- 1–6, 8–10: as proposed. The import list keeps its title "Imports" and stays under the logbook.
- 7: the Add button and the edit form's grid are fixed. The date segments' spacing ("1 /15/2026") stays: they
  need 24 px each for WCAG 2.5.8, and pulling the separators in made axe report overlapping targets.
- Found on the way: in the dive form, a number's value commits on blur, and the "edited" mark appearing then
  moved the Save button away under the pointer, so the click was lost. Fields are now marked while typing.
- Light control borders moved to `#6e8497`, dark to `#6a849d`, to stay ≥ 3:1 on the new page tone and on the
  attention tint (dark tint measured 2.9:1 with the old value).

## Next steps (as proposed)

1. Owner picks: the ranked changes (all, or which), direction A/B/C, density.
2. If B or C: new ADR amending ADR 0014; update the design-system spec and its contrast table.
3. Implement in batches (tokens and components first, then pages), keeping `e2e/ui-quality.spec.ts`
   and `test/source-rules.test.ts` green; re-capture and look again in light/dark, English/German, 390 px.

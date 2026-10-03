---
title: Visual refresh (planned)
summary: Brief and handover for a "clean and modern" pass within the design system, after the UI review and the icons-and-motion slice. Owner chooses the direction before anything changes.
status: planned
date: 2026-10-03
---

# Visual refresh (planned)

## Why

The project owner asked for a "clean and modern" look (2026-10-03). The skills check found no
design skill that fits a data-dense product UI. The popular ones prescribe landing-page aesthetics
that contradict [ADR 0014](../decisions/0014-design-system-and-localization.md) and WCAG (see
[skills](../skills.md), decisions log 2026-10-03). The agreed route: keep the design system and refine
it with the installed skills.

## Starting point

- The [UI review](2026-10-03-ui-review.md) is fully fixed. Icons and motion are in
  ([ADR 0018](../decisions/0018-icons-and-motion.md)).
- Brief and tokens: [design system](../spec/design-system.md), `apps/web/src/design/tokens.css`,
  `apps/web/src/ui/ui.css`, `apps/web/src/pages.css`.
- Skills to use: `frontend-design` (brief: our design system, not a landing page), `emil-design-eng`
  (polish), the uxcel `ux-*` skills (tables, forms, menus, states, notifications),
  `find-animation-opportunities` / `review-animations` if motion changes. AGENTS.md lists their overrides.
- Undecided: uizze `ui-taste` ("pending owner discussion" in [skills](../skills.md)). Offer it only if
  the pass with the installed skills turns out thin.

## Candidate changes (proposals, not decisions)

**Within the current design system** (no ADR needed):
1. **Spacing and hierarchy:** more room between panel title, intro text and content; consistent
   vertical rhythm on the 4 px scale; check panel padding on phones.
2. **Type:** slightly tighter tracking on large headings; check the weight and size steps (title-meta,
   muted text at `--text-sm` may be too small in places).
3. **Fewer boxes inside panels:** dividers instead of nested borders (decision panel, imports list,
   history), and lighter table chrome.
4. **States read as states, not links:** "open" invitation status and "done" Import status use the
   accent/success colours that also mean "clickable"; consider badges.
5. **Small layout flaws seen in the screenshots:**
   - the "Add" button sits lower than its text field (`form-inline` alignment on the Divers page);
   - the decision panel's reason in small muted text wraps mid-sentence;
   - the chart's rotated "°C" axis label;
   - on a phone the logbook's last column is cut until you scroll.

**Changing the direction** (needs a new ADR amending ADR 0014; the owner decides):

6. **Calmer surfaces:** panels set off by a slightly different surface tone instead of a strong
   border, borders only where they mark a control (WCAG 1.4.11 stays).
7. **Radius and density:** a little more radius on panels; a compact or comfortable density for tables.

Not wanted: cream backgrounds, serif headings, uppercase pills, glass, scroll reveals, decorative
gradients (they contradict ADR 0014; see the skills decisions log).

## How

1. Read AGENTS.md, docs/index.md, the design system, ADR 0014, ADR 0018 and this note. Run the skills
   check for anything new (AGENTS.md rule).
2. Capture the current state: `pnpm --filter @dive-hub/web review:capture` (PostgreSQL via
   `docker compose -f compose.dev.yaml up -d`; pnpm as `npx pnpm@12.8.1`). Look at every screenshot.
3. **Propose before changing.** Give a ranked list of changes with before/after reasoning. For 6–7,
   give two or three concrete options (token values, one mocked page). The owner picks; nothing
   changes in the app before that.
4. Implement in batches, committing between them when the owner allows. Change tokens and components,
   not single pages. Keep the [page rules](../spec/design-system.md#rules-every-page-follows) and
   tests green (`e2e/ui-quality.spec.ts`, `test/source-rules.test.ts`). Re-measure contrast for any
   new colour and update the contrast table. Check light and dark, English and German, 390 px.
5. Record the outcome here (`status: done`), in the design system, and in an ADR if the direction
   changed.

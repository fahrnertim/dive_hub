---
title: Visual refresh
summary: Brief and handover for a "clean and modern" pass, after the UI review and the icons-and-motion slice, including research on UI component libraries. Owner chooses the direction before anything changes.
status: done
date: 2026-10-03
---

# Visual refresh

## Progress

- 2026-10-04: library research done ([UI component libraries](2026-10-04-ui-component-libraries.md)); screenshots captured and reviewed, ranked changes and directions proposed ([proposal](2026-10-04-visual-refresh-proposal.md)).
- 2026-10-04: the owner chose library option 1 (keep our React Aria components), all ten changes, direction B
  (tonal surfaces) with comfortable density, and the skills `better-layout`, `better-typography`, `better-colors`.
  Recorded in [ADR 0019](../decisions/0019-tonal-surfaces.md) and the [design system](../spec/design-system.md);
  implemented with all browser tests (44) and unit tests (47) green. Outcome per change: see the proposal.

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

## Component library research

The owner wants UI component libraries researched as part of the refresh (2026-10-03). Starting points:

- [shadcn/ui](https://ui.shadcn.com/)
- [Kibo UI](https://www.kibo-ui.com/)
- [Untitled UI: React component libraries](https://www.untitledui.com/blog/react-component-libraries)
- [awesome-react-components](https://github.com/brillout/awesome-react-components)

Do your own research beyond these as well (for example libraries built on React Aria, which we
already use).

**Question:** should Dive Hub keep its own components on React Aria with our tokens
([ADR 0014](../decisions/0014-design-system-and-localization.md)), adopt a library for some parts
(e.g. data tables, date pickers, toasts, charts), or move to a library as the base? What would each
gain or cost in look, accessibility, maintenance and bundle size?

**Vet every candidate for:**
- **License and free use, including commercial use.** Dive Hub is Apache-2.0 and self-hosted, and
  others may run it commercially. The license must allow redistribution inside an Apache-2.0 project
  without fees or seats: MIT, Apache-2.0, ISC or BSD are fine; GPL, "free for non-commercial use" and
  source-available are not. Record any attribution duties. Check for "pro" tiers, and what is really
  free versus paid (components, templates, Figma kits, icons).
- **Fit with our stack:** React 19, Vite SPA (no Next.js or RSC), React Aria compatibility or
  equivalent behaviour, styling model (Tailwind, CSS-in-JS, or plain CSS) versus our token CSS,
  i18n (German number and date formats), dark mode.
- **Quality:** accessibility (WCAG 2.2 AA, keyboard, screen readers), maintenance (releases,
  maintainers, issues), bundle size and tree-shaking, supply-chain risk (dependencies, install
  scripts, copy-in versus package).
- **What it would mean for us:** migration effort, what our tests (`e2e/ui-quality.spec.ts`,
  `test/source-rules.test.ts`) and page rules would need, and which ADRs it touches.

**Output:** a dated research note `docs/research/YYYY-MM-DD-ui-component-libraries.md` (sources
linked, licenses quoted), a shortlist with a recommendation, and a decision for the owner. Adopting
a library, or Tailwind, needs a new ADR.

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
2. Research UI component libraries (section above) and write the research note. The owner decides
   on that first, because it can change the direction of everything below.
3. Capture the current state: `pnpm --filter @dive-hub/web review:capture` (PostgreSQL via
   `docker compose -f compose.dev.yaml up -d`; pnpm as `npx pnpm@12.8.1`). Look at every screenshot.
4. **Propose before changing.** Give a ranked list of changes with before/after reasoning. For 6–7,
   give two or three concrete options (token values, one mocked page). The owner picks; nothing
   changes in the app before that.
5. Implement in batches, committing between them when the owner allows. Change tokens and components,
   not single pages. Keep the [page rules](../spec/design-system.md#rules-every-page-follows) and
   tests green (`e2e/ui-quality.spec.ts`, `test/source-rules.test.ts`). Re-measure contrast for any
   new colour and update the contrast table. Check light and dark, English and German, 390 px.
6. Record the outcome here (`status: done`), in the design system, and in an ADR if the direction
   changed.

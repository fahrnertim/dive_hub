---
title: Agent skills
summary: Which agent skills the project uses, which were considered and rejected, and why.
status: living
date: 2026-10-07
---

# Agent skills

Rule (see [AGENTS.md](../AGENTS.md#skills)): before starting anything new, search for
specialized skills, vet them, propose them to the user, and record the outcome here.
Installed skills are there to be loaded: before working in an area, load the ones under [Installed](#installed)
that fit it, also for familiar tools (14 of them were never loaded in the first 20 sessions,
[ADR 0039](decisions/0039-working-economically.md)). Before using one, read its entry under [Overrides](#overrides).

## How to search and install

- Search: `npx skills find <topic>`, or browse [skills.sh](https://skills.sh/).
- Vet: author/affiliation, repo activity, the SKILL.md and every bundled file (scripts,
  remote fetches), overlap with skills we already have. Install counts alone are not a signal.
- Install at project level, copied and pinned: `npx skills add <owner/repo> -s <skill> --copy`
  (files land in `.claude/skills/`, the version is pinned in `skills-lock.json`).
- Project-specific adjustments go under [Overrides](#overrides), never into the skill files.

## Installed

| Skill | Source | For | Since |
|---|---|---|---|
| domain-modeling | mattpocock/skills | glossary and ADRs | 2026-10-02 |
| tdd | mattpocock/skills | test-first development | 2026-10-02 |
| codebase-design | mattpocock/skills | module/interface vocabulary (used by tdd) | 2026-10-02 |
| vitest | antfu/skills | unit and integration tests | 2026-10-02 |
| vite | antfu/skills | web client build | 2026-10-02 |
| pnpm | antfu/skills | monorepo, workspaces | 2026-10-02 |
| postgresql-table-design | wshobson/agents | schema design | 2026-10-02 |
| api-and-interface-design | addyosmani/agent-skills | API-first contract design | 2026-10-02 |
| security-and-hardening | addyosmani/agent-skills | uploads, auth, personal data | 2026-10-02 |
| tanstack-query-best-practices | deckardger/tanstack-agent-skills | server state in the web client | 2026-10-02 |
| vercel-react-best-practices | vercel-labs/agent-skills | React performance (SPA rules only) | 2026-10-02 |
| fastify-best-practices | mcollina/skills | Fastify routes, plugins, schemas, OpenAPI | 2026-10-02 |
| postgres-drizzle | ccheney/robust-skills | Drizzle schema, queries, migrations | 2026-10-02 |
| better-auth-best-practices | better-auth/skills | Better Auth setup and usage | 2026-10-02 |
| better-auth-security-best-practices | better-auth/skills | Better Auth hardening | 2026-10-02 |
| email-and-password-best-practices | better-auth/skills | password policy, reset flows, hashing | 2026-10-03 |
| frontend-design | anthropics/skills | visual direction, tokens, interface writing | 2026-10-03 |
| accessibility | addyosmani/web-quality-skills | WCAG 2.2 rules, keyboard and screen-reader patterns, audits | 2026-10-03 |
| playwright-cli | microsoft/playwright-cli | driving a browser, writing and debugging Playwright tests | 2026-10-03 |
| emil-design-eng | emilkowalski/skills | interaction polish: component feel, pressed/hover states, motion | 2026-10-03 |
| review-animations, find-animation-opportunities | emilkowalski/skills | reviewing motion, finding where motion helps | 2026-10-03 |
| ux-tables, ux-inputs-and-forms, ux-empty-states, ux-menus, ux-loaders-and-progress, ux-notifications-and-toasts | uxcel-lab/product-skills | usability rules for tables, forms, menus, states and notifications | 2026-10-03 |
| suggest-lucide-icons | nweii/agent-stuff | picking Lucide icons by real, verified names | 2026-10-03 |
| better-layout, better-typography, better-colors | jakubkrehel/skills | grouping and alignment, type roles, colour roles and contrast (visual refresh) | 2026-10-04 |
| mcp-builder | anthropics/skills | designing and testing the MCP endpoint's tools | 2026-10-06 |
| mobile-native | emilkowalski/skills | platform fixes so the web app feels native on a phone (input zoom, long-press, `theme-color`, safe areas) | 2026-10-04 |
| ux-search, ux-selection-controls | uxcel-lab/product-skills | live search results, choosing the right selection control (the site picker) | 2026-10-05 |
| ux-navigation | uxcel-lab/product-skills | choosing the navigation pattern (top bar, tabs, bottom bar on phones), "where am I" signals, pagination | 2026-10-07 |

Install with telemetry off: `DISABLE_TELEMETRY=1 npx skills add <owner/repo> -s <skill> -a claude-code --copy -y`.

## Overrides

Where a skill and this project disagree, these rules win. They lived in AGENTS.md until 2026-10-07
([ADR 0039](decisions/0039-working-economically.md)); rows of the decisions log that say "AGENTS.md overrides" mean this section.

- **domain-modeling**: the glossary is `docs/glossary.md` (not root `GLOSSARY.md`);
  ADRs go in `docs/decisions/` using our [template](decisions/template.md)
  (not `docs/adr/`). Its "offer ADRs sparingly" criteria apply.
- **tdd**, **codebase-design**: same paths — glossary is `docs/glossary.md`, ADRs are in
  `docs/decisions/`. Test and interface names use the glossary's terms.
- **vercel-react-best-practices**: our web client is a Vite SPA, not Next.js. Ignore the
  `server-*` rules (React Server Components, server actions).
- **tanstack-query-best-practices**: community skill, not from TanStack; official docs win on conflict.
- **better-auth-\***: follow [ADR 0011](decisions/0011-better-auth.md). Run the auth CLI at the
  project's pinned version (not `@latest`), generate into its own schema file, never `drizzle-kit push`
  (migrations are generated, reviewed and committed), and don't run `npx auth mcp`.
- **frontend-design**: our product is an app, not a landing page; ignore the "hero" guidance. The brief is
  [docs/spec/design-system.md](spec/design-system.md) and the tokens in `apps/web/src/design/tokens.css`:
  extend them, don't restyle single pages.
- **accessibility**: target WCAG 2.2 AA; build on the React Aria components in `apps/web/src/ui/`.
- **playwright-cli**: tests live in `apps/web/e2e` and run with `pnpm --filter @dive-hub/web test:e2e` (every test has an area tag, [ADR 0023](decisions/0023-faster-checks.md))
  (installed Edge/Chrome; don't run `npx playwright install`). Keep tests at the User's level: roles,
  labels and visible text, not CSS classes. A new page or state gets a case in `e2e/ui-quality.spec.ts`
  ([page rules](spec/design-system.md#rules-every-page-follows)).
- **emil-design-eng**: skip its fixed opening line; write findings in our review documents' format
  (its Before/After table is fine inside them). Motion respects `prefers-reduced-motion` and the
  duration tokens in `apps/web/src/design/tokens.css`.
- **mobile-native**: skip its fixed opening line. Keep pull-to-refresh (no `overscroll-behavior: none` on `html`/`body`):
  the logbook is a scrolling document. Hover rules stay in `@media (hover: hover)` as `source-rules.test.ts` checks.
  Its "test on real hardware" step needs the owner's phone; say what could only be checked in emulation.
- **review-animations**, **find-animation-opportunities**: reduced motion means our `--duration-*` tokens
  drop to 0 (not "gentler, not zero"), until an ADR says otherwise. Map their Base UI/Framer examples to
  React Aria (`data-placement`, `--trigger-anchor-point`) and plain CSS transitions. Findings go in our
  review documents' format.
- **ux-tables**, **ux-inputs-and-forms**, **ux-empty-states**, **ux-menus**, **ux-loaders-and-progress**,
  **ux-notifications-and-toasts**, **ux-search**, **ux-selection-controls**, **ux-navigation** (uxcel): the design system and React Aria win on conflict. Row actions
  stay visible (never hover-only); no truncate-plus-tooltip on phones; notices and toasts can always be
  dismissed, and errors never time out (WCAG 2.2.1, 4.1.3). Skip their hand-offs to `ux-*-audit` skills
  and orchestration docs we don't have, and their mobile push and marketing parts. ux-search's placement rules
  (a search bar on every page) are for site search, not for pickers and list filters. ux-navigation: targets follow
  WCAG 2.2 AA (24 px, not its 44 px); its footer, mega-menu and language-picker parts don't apply.
- **suggest-lucide-icons**: a name must also exist in the installed `lucide-react` version (check
  `node_modules/lucide-react`), not only in `@latest`. Run its script as `PYTHONUTF8=1 python …` (Windows' default encoding fails). New icons go into the
  map in `apps/web/src/ui/Icon.tsx` ([ADR 0018](decisions/0018-icons-and-motion.md)). Icons are
  `aria-hidden`; the control keeps its visible text or `aria-label`.
- **email-and-password-best-practices**: same rules as better-auth-\* (never `npx auth@latest migrate`; use
  `auth:generate` + drizzle-kit). Keep our argon2id parameters (m = 19 MiB, t = 2, p = 1) and 15-character
  minimum from [ADR 0012](decisions/0012-invitations-and-admin-bootstrap.md), not the skill's example values.
- **mcp-builder** (anthropics/skills): TypeScript only (ignore its Python guide), our Fastify app and SDK v2, tool schemas per
  [ADR 0035](decisions/0035-mcp-connector.md) (TypeBox if the SDK takes JSON Schema, else Zod only in `src/mcp/`). Its
  evaluation scripts (Python, Anthropic API) run only when the owner asks, with their own key, against fake data, never a
  real logbook. Read-only tools; write tools need a new ADR.
- **better-layout**, **better-typography**, **better-colors** (jakubkrehel): our tokens and hex notation stay (no oklch rewrite).
  Their hand-offs to `better-accessibility`, `better-ui` and `better-writing` go to our `accessibility` skill, `emil-design-eng`
  and the writing rules in [docs/spec/design-system.md](spec/design-system.md#writing). Surfaces follow
  [ADR 0019](decisions/0019-tonal-surfaces.md): tones, not shadows, on the page. Findings go in our review documents' format.

## Pending (install when the matching library or phase is chosen)

Details and commands: [skills vetting](research/2026-10-02-agent-skills-vetting.md).

| When | Skill |
|---|---|
| 2FA built | better-auth/skills `two-factor-authentication-best-practices` |
| Code exists, refactoring | mattpocock/skills `improve-codebase-architecture` |
| Gesture-driven UI (drag, swipe, sheets) | emilkowalski/skills `apple-design` |
| `<ViewTransition>` in stable React | vercel-labs/agent-skills `vercel-react-view-transitions` |

## Decisions log

| Date | Skill | Outcome | Reason |
|---|---|---|---|
| 2026-10-02 | domain-modeling (mattpocock/skills) | installed | glossary and ADR discipline; paths overridden in AGENTS.md |
| 2026-10-02 | tdd, codebase-design, vitest, vite, pnpm, postgresql-table-design, api-and-interface-design, security-and-hardening, tanstack-query-best-practices, vercel-react-best-practices | installed | vetted, see [skills vetting](research/2026-10-02-agent-skills-vetting.md) |
| 2026-10-02 | planetscale postgres, affaan-m docker-patterns, getsentry security-review, giuseppe drizzle-orm-patterns | rejected | safety: vendor ads with live remote links, foreign project context, or pre-approved Bash/Write |
| 2026-10-02 | yusukebe/hono-skill, mattpocock design-an-interface, lobehub drizzle, tanstack-skills/tanstack-skills | rejected | dead, moved, or internal/unaffiliated |
| 2026-10-02 | mindrally kysely, bobmatnyc drizzle, supabase-postgres-best-practices, multi-stage-dockerfile, nodejs-backend-patterns, monorepo-management, vercel-composition-patterns, better-auth create-auth | rejected | generic, overlapping, or bypasses our own design |
| 2026-10-02 | fastify-best-practices (mcollina/skills) | installed | Fastify chosen ([ADR 0007](decisions/0007-fastify-http-framework.md)); maintainer-written |
| 2026-10-02 | honojs/skills hono, kadajett nestjs-best-practices | not needed | Fastify chosen instead of Hono/NestJS |
| 2026-10-02 | postgres-drizzle (ccheney/robust-skills) | installed | Drizzle chosen ([ADR 0008](decisions/0008-drizzle-database-access.md)); version-aware, asks before migrating |
| 2026-10-02 | better-auth-best-practices, better-auth-security-best-practices (better-auth/skills) | installed | Better Auth chosen ([ADR 0011](decisions/0011-better-auth.md)); CLI/migration overrides in AGENTS.md |
| 2026-10-03 | email-and-password-best-practices (better-auth/skills) | installed | Official; one SKILL.md, no scripts (commit 20c9e88, 2026-09-01). Thin, but covers reset tokens, session revocation and length limits. Its Quick Start runs `npx auth@latest migrate` and its argon2 example (64 MiB, p = 4) is too heavy for 2 GB NAS boxes; AGENTS.md overrides both |
| 2026-10-03 | better-auth/skills organization-best-practices | not needed | we don't use the organization plugin; ADR 0012 builds invitations |
| 2026-10-03 | `npx skills find` for "better auth", "invitation", "authentication session" | nothing new | only the better-auth/skills set and unrelated vendor skills |
| 2026-10-03 | `npx skills find` for "password reset", "openapi", "user management admin" (slice 3) | nothing new | vendor-specific (Lark, Azure, Clerk, WorkOS, Appwrite) or already installed |
| 2026-10-03 | frontend-design (anthropics/skills) | installed | Official, one SKILL.md, no scripts (commit 8a1541c). Token plan, checks against generic defaults, quality baseline, interface writing. Landing-page parts don't apply; AGENTS.md says so |
| 2026-10-03 | accessibility (addyosmani/web-quality-skills) | installed | MIT, SKILL.md + 2 references, no scripts (commit afa8da9); same author as two installed skills; WCAG 2.2 AA guidance for the component set |
| 2026-10-03 | daymade/claude-code-skills `i18n-expert` | rejected | One author with 72 skills, generic, defaults to zh-CN, its audit script needs Python; i18next docs suffice |
| 2026-10-03 | `npx skills find` for "design tokens", "design system", "react aria", "i18n", "i18next", "accessibility" (slice 4) | see above | other hits target Tailwind/shadcn, HeroUI, Next.js, Vue, mobile or landing pages |
| 2026-10-03 | playwright-cli (microsoft/playwright-cli) | installed | Official (commit b85c7a7); SKILL.md + 9 references, no scripts. Pre-approves only `playwright-cli` and `npx playwright` commands, accepted deliberately for browser tests (ADR 0015) |
| 2026-10-03 | anthropics/skills `webapp-testing` | rejected | Python-based (no Python here) and tells the agent not to read its bundled scripts, against our vetting rule |
| 2026-10-03 | `npx skills find` for "playwright", "e2e testing", "audit log history", "form editing react" (slice 5) | see above | the rest: vendor-specific or unrelated |
| 2026-10-03 | `npx skills find` for "deduplication merge records", "data ownership sharing", "tanstack query mutations" (slice 6) | nothing new | generic or vendor-specific; the installed tanstack-query skill covers mutations |
| 2026-10-03 | emil-design-eng (emilkowalski/skills) | installed | One SKILL.md, no scripts (commit e8a175d), by a well-known design engineer; for interaction polish and motion. AGENTS.md overrides its fixed greeting and table-only output |
| 2026-10-03 | vercel-labs/agent-skills `web-design-guidelines` | rejected; content used | Fetches its rules from a mutable `main` URL on every run. The rules themselves are used, pinned at commit e3d624b ([UI review](research/2026-10-03-ui-review.md)) |
| 2026-10-03 | pbakaus `impeccable` | rejected | Strong method, but downloads and runs a binary, bundles ~2 MB of scripts, writes PRODUCT.md/DESIGN.md at the repository root |
| 2026-10-03 | leonxlnx/taste-skill `redesign-existing-projects`, nextlevelbuilder `ui-ux-pro-max` | rejected | Generic "premium" restyling against our design system; Python-based search over a CSV database |
| 2026-10-03 | `npx skills find` for UI/UX review, navigation, tables, forms, empty states, heuristics (UI review) | see above | specialized ones (empty states, tables) have under 200 installs and weren't vetted further |
| 2026-10-03 | review-animations, find-animation-opportunities (emilkowalski/skills) | installed | Markdown only, same author and commit (e8a175d) as emil-design-eng; a review method with Block/Approve and a capped search for motion worth adding. AGENTS.md: reduced motion goes to 0 |
| 2026-10-03 | uxcel-lab/product-skills `ux-tables`, `ux-inputs-and-forms`, `ux-empty-states`, `ux-menus`, `ux-loaders-and-progress`, `ux-notifications-and-toasts` | installed | MIT, one SKILL.md each, no scripts or fetches (commit 5007cd0); from Uxcel's own lessons; concrete rules for exactly these components. New and little used (≈45 installs); AGENTS.md overrides hover-only row actions, undismissable toasts and missing hand-offs |
| 2026-10-03 | nweii/agent-stuff `suggest-lucide-icons` | installed | Lucide chosen for the icons slice. One SKILL.md and a stdlib Python script (read in full): fetches the public `lucide-static@latest/tags.json` from unpkg, caches it in the temp folder, writes nothing to the repo. Stops agents from inventing icon names; AGENTS.md: check the installed version |
| 2026-10-03 | better-auth/better-icons | rejected | Global CLI install, MCP config written into `~/.claude` or the repo root, preferences in the home folder (against ADR 0001); copies SVGs from 200 sets instead of one library |
| 2026-10-03 | aksuharun/skills `lucide-icons` | rejected | Thin rewrite of the lucide.dev docs; weaker accessibility advice than ours |
| 2026-10-03 | emilkowalski/skills `animate` | not now | ~70% already in emil-design-eng; routes toasts and dropdowns to Base UI/Sonner/Vaul instead of React Aria |
| 2026-10-03 | emilkowalski/skills `animation-vocabulary`, `ask-sonner` | rejected | A glossary with no build value; a Sonner-only guide (we use React Aria) |
| 2026-10-03 | emilkowalski/skills `apple-design` | later | Mostly gesture physics (springs, momentum); glass bars conflict with our bordered panels. See Pending |
| 2026-10-03 | kylezantos/design-motion-principles | rejected | Writes HTML audit reports at the repository root, loads Google Fonts, Framer Motion based, `0.01ms !important` reduced-motion reset |
| 2026-10-03 | vercel-labs/agent-skills `vercel-react-view-transitions` | later | Needs React canary outside Next.js; asks to apply every pattern. See Pending |
| 2026-10-03 | dylantarre/animation-principles (incl. `notifications-toasts`, `accordions-dropdowns`) | rejected | Template skills; bounce and shake on toasts, looping pulses, no reduced motion; contradicts emil-design-eng |
| 2026-10-03 | leonxlnx/taste-skill `minimalist-ui`, `design-taste-frontend`, `high-end-visual-design` | rejected | Fixed marketing aesthetics (cream background, serif headings, uppercase pills, pill buttons, glass, scroll reveals), Tailwind/Next.js; `design-taste-frontend` itself excludes dashboards and data tables |
| 2026-10-03 | uizze.sh `ui-taste` | pending owner discussion | Apache adaptation of Impeccable without its binary; good product-UI playbooks, but a vendor zip pinned only by checksum, paid-service upsell, large overlap with frontend-design |
| 2026-10-03 | wondelai/skills `web-typography`, wshobson/agents `interaction-design`, google-labs-code `design-md` | rejected | Basic book summary with an affiliate link; Tailwind and framer-motion with hand-built controls; needs Stitch and writes DESIGN.md |
| 2026-10-03 | vercel-labs/agent-skills `web-design-guidelines` (re-checked, commit 063bee9) | still rejected | Still fetches its rules from the mutable `main` branch |
| 2026-10-03 | owl-listener/designer-skills `form-design`, `loading-states` | rejected | Agrees with uxcel's forms skill (redundant); loading-states is thin and suggests shimmer and staggering |
| 2026-10-03 | gnurio/refactoring-ui-plugin, aladicf/better-web-ui, param087/saas-ui-skills, heroui-inc `heroui-react` | rejected | "All rights reserved" (can't be copied in); an Impeccable fork writing files at the root; Tailwind/shadcn with a buggy example; HeroUI-specific |
| 2026-10-03 | `npx skills find` for icons, motion, modern/clean design, toasts, tables, dropdowns, hover, empty/loading states, forms (icons and motion slice) | see above | the rest: video (Remotion, HyperFrames), vendor UI kits (Syncfusion), unrelated |
| 2026-10-04 | jakubkrehel/skills `better-layout`, `better-typography`, `better-colors` (also `better-ui`, `better-interface`) | installed (better-layout, better-typography, better-colors; owner approved 2026-10-04) | MIT, Markdown only (SKILL.md + reference .md + a display-name `agents/openai.yaml`, no scripts or fetches; commit 267330e, pushed 2026-10-03, ≈7.4k stars). Exact, evidence-based rules for grouping, type and colour roles that fit the visual refresh. Conflicts to override in AGENTS.md if installed: `better-ui` press scale 0.96 (ours 0.97, ADR 0018) and "shadows for elevation" (ADR 0014: borders/tones, shadows only for overlays); `better-interface` needs all six siblings. `better-ui` and `better-interface` not installed: emil-design-eng and our review format already cover polish and reviews. All 14 reference files read; the installed copies match the commit |
| 2026-10-04 | educlopez/ui-craft `ui-craft-dense-dashboard` | rejected | Monospace for timestamps and IDs, hover-only row actions, sparklines everywhere (against our design system and AGENTS.md uxcel overrides); repo ships an MCP server run via `npx` and many generated "harness mirror" copies |
| 2026-10-04 | shadcn/improve, shadcn-ui/ui `shadcn` | not needed | `improve` is a codebase-audit planner, not design; the `shadcn` skill only matters if shadcn/ui is adopted ([UI component libraries](research/2026-10-04-ui-component-libraries.md)) |
| 2026-10-04 | wshobson/agents `responsive-design` | not needed (owner agreed) | Generic textbook (≈2,200 lines of references), partly Tailwind; content breakpoints, container queries and logical properties are already in `better-layout`, reflow in `accessibility`. Conflicts: 44 px touch targets (we use WCAG 2.2 AA's 24 px) and fluid `clamp()` type (we use a fixed scale) |
| 2026-10-04 | emilkowalski/skills `mobile-native` | installed (owner approved 2026-10-04) | MIT, one SKILL.md, no scripts or fetches (commit e8a175d, same as our Emil Kowalski skills). Platform fixes that make a web app feel native on a phone (input zoom, long-press selection, `theme-color`, safe areas, real-device testing). Overrides needed: its fixed opening line (as for emil-design-eng); keep pull-to-refresh (it says to drop `overscroll-behavior: none` for scrolling documents) |
| 2026-10-04 | designed-by-ai/skills `design-mobile-apps`, athevon/genjutsu `mobile-principles` | rejected | A client for the paid Sleek design service (API key, $69/month); no clear license and an internal part of a larger suite |
| 2026-10-04 | `npx skills find` for "responsive design", "responsive layout", "mobile first", "container queries", "breakpoints", "mobile ux", "mobile usability", "mobile web", "touch", "thumb zone", "mobile navigation", "mobile forms", "pwa" | see above | the rest: native apps (iOS, React Native, Flutter, Expo), already rejected (taste-skill, ui-ux-pro-max, impeccable, uizze) or unrelated |
| 2026-10-04 | `npx skills find` for "shadcn", "react aria", "component library", "ui polish", "dashboard design", "data dense ui", "design tokens", "visual hierarchy" (visual refresh) | see above | the rest already rejected above (impeccable, taste-skill, ui-ux-pro-max, web-design-guidelines, uizze) or unrelated (HyperFrames, Expo, mobile) |
| 2026-10-04 | `npx skills find` for "geospatial", "postgis", "maps", "geolocation", "leaflet", "coordinates" (dive sites, [ADR 0020](decisions/0020-dive-sites.md)) | nothing installed | Only PostGIS skills fit: postgis/postgis `postgis` (official repo, one SKILL.md of gotchas, no scripts) and timescale/pg-aiguide `design-postgis-tables` (vendor, Apache-2.0). Both assume PostGIS, which the owner declined (no arm64 `postgis/postgis` image for PostgreSQL 18). Install `postgis/postgis` if PostGIS is adopted later. Map skills (zenobi-us `leaflet-mapping`, 73 installs, dotfiles repo) wait for a map ADR; the rest were unrelated (SEO, marketing) |
| 2026-10-04 | `npx skills find` for "overpass", "openstreetmap", "osm", "wikidata", "sparql", "odbl", "open data license", "geospatial", "gis", "map data", "data import", "msw", "http mocking", "external api client", "background jobs", "graphile" (site import, [ADR 0021](decisions/0021-site-external-ids-and-import.md)) | nothing installed | No skill for Overpass, OSM, Wikidata/SPARQL or ODbL exists. The hits were unrelated (Lark, marketing, video). "msw" is a game platform's skill set, not Mock Service Worker. |
| 2026-10-04 | mapbox/mapbox-agent-skills `mapbox-geospatial-operations` | rejected | Vendor skill that picks between Mapbox MCP tools (Turf.js vs. Mapbox routing APIs). We use neither, and our distance is already haversine in SQL (ADR 0020). |
| 2026-10-04 | `npx skills find` for "pagination", "deduplication", "merge records", "api contract", "client sdk", "mobile client" (merging sites, list paging, client contract, [ADR 0022](decisions/0022-merging-sites-and-site-list-paging.md)) | nothing installed | Only unrelated hits (marketing, git merge conflicts, vendor SDKs, Expo dev client). Our `api-and-interface-design` and `ux-tables` cover paging and the contract |
| 2026-10-04 | `npx skills find` for "reverse engineering", "api research", "openapi from traffic", "mobile app api", "deep research", "terms of service" (SSI API research) | nothing installed | no skill for API reverse engineering or traffic capture; hits were design, Lark/Azure and vendor skills. mattpocock/skills `research` (SKILL.md only, no scripts) read and not needed: it only says "use a background agent, cite primary sources, write a Markdown note", which our research-note convention already covers |
| 2026-10-04 | `npx skills find` for "encryption secrets", "credential storage", "api client", "third party integration" (SSI slice) | nothing new | only skills we have (`security-and-hardening`, better-auth) or vendor skills (Azure, Lark, Convex) |
| 2026-10-05 | `npx skills find` for "zip", "data import", "geospatial", "database migration", "etl" (SSI site import, water type of a site, [ADR 0024](decisions/0024-ssi-target-via-app-api.md)) | nothing installed | only unrelated or vendor hits (OKX, Salesforce, Azure, Prisma, marketing SEO, a CTF zip skill); `supabase-postgres-best-practices` was rejected on 2026-10-02. Our `postgres-drizzle`, `tdd` and `security-and-hardening` cover the work |
| 2026-10-05 | ux-search, ux-selection-controls (uxcel-lab/product-skills, commit 5007cd0) | installed | Our uxcel skills hand off to them (ux-menus names `ux-selection-controls` for menus vs. radios; ux-empty-states names `ux-search`). Same source as our six, MIT, one SKILL.md each, no scripts or remote fetches; read in full. For replacing the dive's site picker (radios) with a live result list. `ux-modals-and-dialogs` from the same repo not needed |
| 2026-10-05 | `npx skills find` for "adapter pattern", "plugin architecture", "integration", "api integration", "oauth", "oauth pkce", "connector", "capabilities", "hexagonal architecture", "ports and adapters", "sync", "rate limiting", "contract testing", "pact", "third party api client", "webhook" (provider layer) | nothing installed | Read in full: mattpocock/skills `improve-codebase-architecture` (commit f6abdeb) stays Pending: user-invoked, finds refactoring candidates and grills one through a `grilling` skill we don't have; the [SSI integration review](research/2026-10-05-ssi-integration-review.md) already chose the direction. mattpocock `setup-ts-deep-modules` (in-progress folder) installs dependency-cruiser and a `src/packages/` layout that isn't ours. wshobson/agents `architecture-patterns` (46891e7), affaan-m/ecc `hexagonal-architecture` (ef648e0) and wondelai/skills `clean-architecture` (c172996) are generic ports-and-adapters textbooks that `codebase-design` already covers (seam, adapter, "two adapters make a real seam"); wondelai again carries an Amazon affiliate link, affaan-m/ecc was rejected on 2026-10-02. secondsky `api-contract-testing` (451 installs) is Pact between services, not an adapter contract suite. OAuth and rate-limiting hits were vendor skills (Azure, Firebase, Convex, VTEX) or server-side limits on our own API |
| 2026-10-05 | `npx skills find` for "undo soft delete", "destructive action confirmation", "soft delete", "undo toast" (deleting a Dive) | nothing installed | The hits were about agents working safely (operating-safely, safety-guard, safe-refactor, agentmemory `forget`) or unrelated (marketing, Google Sheets). emilkowalski/skills `ask-sonner` is for the Sonner toast library, which we don't use; dembrandt `notifications-and-recovery` (691 installs) repeats our `ux-notifications-and-toasts`. `ux-empty-states` and `ux-notifications-and-toasts` cover the work |
| 2026-10-06 | `npx skills find` for "timezone", "time zone" (time zones from positions while building ADR 0030) | nothing installed | Only browser-fingerprinting (antibrow anti-detect-browser, multi-account-isolation; liarjs browser-fingerprint-audit), animation (hyperframes gsap, animejs) and mattpocock `decision-mapping` hits; none about time zones or geo lookups. The tests (`tdd`) and geo-tz's vetting in ADR 0030 cover the work |
| 2026-10-06 | `npx skills find` for "data import", "deduplication", "fuzzy matching", "record linkage", "data provenance", "sync conflict" (importing dives from SSI, [ADR 0030](decisions/0030-importing-dives-from-providers.md)) | nothing installed | Hits were vendor or agent-workflow skills (rigorpilot, Prisma, Lark), `supabase-postgres-best-practices` (rejected 2026-10-02), and fuzzing as a security technique (trailofbits), not fuzzy matching. `postgres-drizzle`, `tdd` and `codebase-design` cover the work |
| 2026-10-06 | `npx skills find` for "time series analysis", "anomaly detection", "health recommendations", "rule engine" (dive assessment, [research note](research/2026-10-06-dive-assessment.md)) | nothing installed | Hits were Azure Kusto and diagnostics, analytics, observability, healthcare compliance, customer health scores, planning workflows and search; none about profile analysis or rule engines for this domain. `tdd` covers the rules module |
| 2026-10-06 | mcp-builder (anthropics/skills, commit 683bc88) | installed (owner approved 2026-10-06) | Official, Apache-2.0. SKILL.md, four reference guides (best practices, TypeScript, Python, evaluation) and two Python scripts, all read: the scripts run an evaluation through the Anthropic API against an MCP server (need a key and the `anthropic` and `mcp` packages); nothing runs on install, no remote fetch except telling the agent to read the SDK README from `main`. Recommends TypeScript, stateless Streamable HTTP, Zod schemas, annotations, evaluations. AGENTS.md: TypeScript only, schemas per ADR 0035, evaluations only on fake data by the owner. The installed copy matches the commit |
| 2026-10-06 | github/awesome-copilot `typescript-mcp-server-generator`, mcp-use `mcp-apps-builder`, wind-alice `wind-mcp-skill` | not needed / rejected | A generator prompt overlapping mcp-builder; a vendor's framework skill (mcp-use); an unrelated finance vendor's skill |
| 2026-10-06 | `npx skills find` for "mcp", "mcp server", "model context protocol", "oauth provider", "api tokens" (MCP connector, [research note](research/2026-10-06-mcp-connector.md)) | see above | The rest: Azure, Lark, Firebase, Prisma and agent-workflow skills |
| 2026-10-06 | `npx skills find` for "maintenance tracking", "asset management", "inventory", "reminders", "recurring schedule" (equipment and service intervals, [research note](research/2026-10-06-equipment-and-service.md)) | nothing installed | Hits were observability and analytics, Google Workspace and Lark calendars and notes, finance, Azure resource lookup, demand planning and React Native; none about equipment or maintenance schedules. `postgres-drizzle` and `tdd` cover the work |
| 2026-10-06 | `npx skills find` for "gas planning", "consumption", "team planning", "percentile statistics" (gas plans for groups, [research note](research/2026-10-06-gas-consumption-planning.md)) | nothing installed | Hits were agent planning workflows (mattpocock `grilling`, `wayfinder`, `decision-mapping`), marketing and launch plans, Azure, specification writing, data visualisation and statistics for papers. `tdd` covers the engine |
| 2026-10-06 | `npx skills find` for "decompression", "diving", "nitrox", "physiology", "safety critical", "medical calculator" (MOD and bottom time, [research note](research/2026-10-06-gas-and-ndl-tools.md)) | nothing installed | No diving, decompression or gas skill exists. Hits were video rendering, image compression, refactoring safety, threat modelling (wshobson `stride-analysis-patterns`), marketing psychology and research workflows. `tdd` covers the test-first module |
| 2026-10-06 | `npx skills find` for "dive planner", "scuba", "buoyancy", "calculator", "recommendation engine", "estimation model" (weight calculator, [research note](research/2026-10-06-weight-calculator.md)) | nothing installed | No diving or buoyancy skill exists. Hits were planning and ticket workflows (mattpocock `grill-with-docs`, `wayfinder`, `to-tickets`), Lark calendars and sheets, 3D water rendering, fluid dynamics for game engines, marketing "free tools", vector databases. `domain-modeling` (installed) covers the modelling |
| 2026-10-07 | `npx skills find` for "fit file", "suunto", "garmin fit", "file format parser", "dive computer", "binary parsing" (Suunto file import, [research note](research/2026-10-07-suunto-import.md)) | nothing installed | No skill for FIT, Suunto or dive file formats exists. Hits were ticket and review workflows (mattpocock), Lark and Google Drive, spreadsheets, marketing analytics, observability, a song generator ("suno") and tryterra's `terra-planned-workouts` (a vendor's wearables API, 79 installs). `tdd`, `codebase-design` and `security-and-hardening` (untrusted uploads) cover the work |
| 2026-10-07 | `npx skills find` for "data quality", "duplicate detection", "data cleanup", "record merge" (logbook housekeeping, [research note](research/2026-10-07-logbook-housekeeping.md)) | nothing installed | Hits were vendor skills (Azure Kusto, quotas, reliability; Lark), agent workflows (mattpocock `triage`, `to-tickets`; rigorpilot), git merge conflicts, browser fingerprinting and `supabase-postgres-best-practices` (rejected 2026-10-02); none about data quality rules or merging records. `tdd`, `codebase-design` and the uxcel skills cover the work |
| 2026-10-05 | `npx skills find` for "relationships", "contacts", "people picker", "data mapping", "validation rules", "privacy personal data", "gdpr", "entity matching" (buddies, Push requirements, [ADR 0028](decisions/0028-shared-divers-and-participants.md), [ADR 0029](decisions/0029-push-requirements-and-buddies.md)) | nothing installed | wshobson/agents `gdpr-data-handling` (commit be57c0b, one 2.7 KB SKILL.md, no scripts) read and rejected: a generic summary of the law (legal bases, data-subject rights, consent boxes) whose "details" point to an empty `references/` folder; its one practical rule, collect no more than needed, is already in `security-and-hardening`. The rest were vendor skills (Lark contacts, Azure, Firebase, Convex), OSINT people search, or skills rejected before (web-design-guidelines, taste-skill). `ux-selection-controls` and `ux-search` (installed) covered the role choice and the Diver and buddy pickers |
| 2026-10-05 | `npx skills find` for "distributed lock", "lease", "postgres locking", "job concurrency" (provider layer cleanup, leases in PostgreSQL) | nothing installed | Only unrelated or rejected hits: Redis skills (upstash `upstash-redis-js`, affaan-m/ecc `redis-patterns`; we have no Redis), `supabase-postgres-best-practices` (rejected 2026-10-02) and Prisma's Postgres setup (we use Drizzle), and general agent-workflow skills (obra/superpowers debugging and code review, distributed tracing, Turborepo caching). None covers leases or row-level locking in plain PostgreSQL; `postgres-drizzle` and `codebase-design` covered the work |
| 2026-10-06 | mcp-builder, used for slice 17 ([ADR 0035](decisions/0035-mcp-connector.md)) | note | Its best-practices file shaped the tools (namespaced names, paging fields, annotations, errors that say what to do, a size cap). Its TypeScript guide still shows SDK v1 (`@modelcontextprotocol/sdk`, Express, Zod): we use SDK v2 with TypeBox through `fromJsonSchema`. Its Markdown/JSON `response_format` was not taken: results are structured content with an output schema, and `detail` chooses concise or detailed. The evaluation scripts were not run |
| 2026-10-07 | `npx skills find` for "token usage", "context management", "claude code cost", "prompt caching", "context engineering", "agents md" (token usage, [research note](research/2026-10-07-token-usage.md)) | nothing installed | Only the registry pages were read, not the skill files. mattpocock/skills `writing-for-agents` (pointers instead of inline material, every always-loaded word costs each turn) is a candidate for rewriting AGENTS.md, pending the owner. anthropics/claude-plugins-official `claude-md-improver` not needed: it also targets `CLAUDE.local.md` (against ADR 0001), and Claude Code's built-in `/doctor prompt-audit` covers the audit. juliusbrussee/caveman `verify-and-stop` (fewer verification steps) not pursued: it would work against our checks rule. The rest: Lark, marketing, unrelated vendor skills |
| 2026-10-07 | uxcel-lab/product-skills `ux-navigation` (commit 5007cd0, the commit of our eight uxcel skills) | installed (owner approved 2026-10-07) | For the navigation part of the [UI redesign proposal](research/2026-10-07-ui-redesign-proposal.md#5-navigation); `ux-menus` hands off to it. MIT, one SKILL.md (143 lines, read in full), no scripts, no fetches, only links to Uxcel lessons. Pattern choice by structure (top bar, sidebar, tabs, bottom bar, breadcrumbs), "where am I" signals, pagination. Overrides needed: 44 px targets (we use WCAG 2.2 AA's 24 px), truncate-plus-tooltip on breadcrumbs (no tooltips), hand-offs to `ux-*-audit` skipped as for the others; its footer, mega-menu and language-picker parts don't apply. `cards` from the same repository not looked at |

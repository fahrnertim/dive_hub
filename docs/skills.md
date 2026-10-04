---
title: Agent skills
summary: Which agent skills the project uses, which were considered and rejected, and why.
status: living
date: 2026-10-04
---

# Agent skills

Rule (see [AGENTS.md](../AGENTS.md#skills)): before starting anything new, search for
specialized skills, vet them, propose them to the user, and record the outcome here.

## How to search and install

- Search: `npx skills find <topic>`, or browse [skills.sh](https://skills.sh/).
- Vet: author/affiliation, repo activity, the SKILL.md and every bundled file (scripts,
  remote fetches), overlap with skills we already have. Install counts alone are not a signal.
- Install at project level, copied and pinned: `npx skills add <owner/repo> -s <skill> --copy`
  (files land in `.claude/skills/`, the version is pinned in `skills-lock.json`).
- Project-specific adjustments go in [AGENTS.md](../AGENTS.md#skills), never into the skill files.

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
| mobile-native | emilkowalski/skills | platform fixes so the web app feels native on a phone (input zoom, long-press, `theme-color`, safe areas) | 2026-10-04 |

Install with telemetry off: `DISABLE_TELEMETRY=1 npx skills add <owner/repo> -s <skill> -a claude-code --copy -y`.

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

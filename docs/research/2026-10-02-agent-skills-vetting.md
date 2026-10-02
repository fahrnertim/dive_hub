---
title: Agent skills vetting
summary: Vetting of ~35 skills.sh agent skills for the Dive Hub stack (content, author, freshness, safety, fit); which to install now, which once a library is picked, which to reject.
status: done
date: 2026-10-02
---

# Agent skills vetting

Markers: **[V]** checked against the primary source (the skill files on GitHub, GitHub API, npm registry);
**[S]** secondary source (skills.sh listing, search summary); **[?]** not verified or own estimate.

Context: [ADR 0004](../decisions/0004-system-architecture.md), [ADR 0005](../decisions/0005-typescript-stack.md).
Library picks (Fastify / Hono / NestJS, Drizzle / Kysely, pg-boss / Graphile Worker, Better Auth or own)
are still open, so both sides were vetted; skill quality is at most a tie-breaker.

## Question

Which third-party agent skills are worth installing at project level
(`npx skills add <owner/repo> -s <skill> --copy`) for the prototype, which only once a library is
chosen, and which should be avoided? Skills are prompts that run with the agent's permissions, so
safety counts as much as content.

## Method

- Candidate list from `npx skills find`; extra searches for pg-boss, Graphile, Drizzle, Kysely, Hey API,
  openapi-typescript, Zod, uPlot, TanStack Query, Hono [V].
- For every candidate: downloaded the whole skill folder (SKILL.md plus every referenced file) from
  `raw.githubusercontent.com` into a scratch directory, read SKILL.md and sampled reference files,
  grepped all files for scripts, shell pipes, `curl`/`wget`, `npx`, remote URLs, MCP, telemetry and
  prompt-injection phrasing [V]. Nothing was installed.
- Repo stars and last push from the GitHub API; last commit touching the skill folder from
  `commits?path=` [V]. Author identity from GitHub profiles and npm maintainers [V].
- Install counts on skills.sh come from the `skills` CLI's own telemetry and were treated as
  popularity hints only; they are easy to inflate [S].

## Findings

No candidate bundles executable scripts; all files are Markdown plus small JSON/YAML metadata [V].
Risk therefore lies in *instructions*: commands the agent is told to run, remote content it is told
to fetch, and pre-approved tools (`allowed-tools`).

### Backend frameworks

| Skill | Author / affiliation | Stars / last skill commit | Content quality | Safety notes | Fit |
|---|---|---|---|---|---|
| `mcollina/skills@fastify-best-practices` | Matteo Collina, Fastify lead maintainer | 1.9K / 2026-08-17 | Strong: 19 rule files (~190 KB) on plugins, hooks, TypeBox schemas, serialization, `@fastify/swagger`, testing with `inject()`, Pino, deployment [V] | Clean; only `npx tsc`, `npx @platformatic/flame` examples [V] | High if Fastify; covers code-first OpenAPI |
| `honojs/skills@hono` (official) | Yusuke Wada, Hono creator, honojs org | 10 / 2026-09-20 | Good single-file API reference (16 KB); Cloudflare-Workers-leaning; **no `@hono/zod-openapi` coverage** [V] | Tells agent to `curl` docs from hono.dev and install pre-release `@hono/cli@next`, then follow `npx hono agent-context` output (runtime-generated instructions) [V] | Medium if Hono |
| `yusukebe/hono-skill@hono` (listed, 12.8K installs) | same author | 154 / 2026-08-31 | **Repo emptied: "Moved to honojs/skills"**, only README left [V] | Install would get nothing useful | Reject; use `honojs/skills` |
| `kadajett/agent-nestjs-skills@nestjs-best-practices` | Jeremy Stover, individual, unaffiliated | 284 / 2026-07-23 | Decent: 40 rule files (correct/incorrect examples), class-validator, guards, JWT [V] | Clean [V] | Medium if NestJS |
| `wshobson/agents@nodejs-backend-patterns` | Seth Hobson, individual (large skill collection) | 40K / 2026-09-28 | Generic Express/Fastify patterns, checklist-style [V] | Clean | Low; superseded by framework skill |

### Auth

| Skill | Author / affiliation | Stars / last skill commit | Content quality | Safety notes | Fit |
|---|---|---|---|---|---|
| `better-auth/skills@better-auth-best-practices` | Better Auth org (official) | 222 / 2026-09-01 | Good: version-matched docs lookup, adapters, sessions, plugins, CLI [V] | Points agent to Better Auth MCP or `better-auth.com/llms.txt`; runs `npx auth@latest` (npm `auth` is maintained by the Better Auth lead, repo better-auth/better-auth) — unpinned `@latest` [V] | High if Better Auth |
| `better-auth/skills@better-auth-security-best-practices` | same | / 2026-07-10 | Good: secrets, rate limiting, CSRF, trusted origins, cookie/session security [V] | Clean | High if Better Auth |
| `email-and-password-best-practices`, `two-factor-authentication-best-practices` | same | / 2026-09-01 | Focused, accurate-looking feature guides [V] | `npx auth@latest migrate` | Later, when the feature is built |
| `better-auth/skills@create-auth` | same | / 2026-09-01 | Interactive scaffolder: scans project, asks via `AskQuestion` tool, generates auth from scratch; framework list Next.js-first [V] | Writes many files in one go | Low; Dive Hub auth is a deliberate design (invitation-only, bearer for mobile) |

### Database: Drizzle, Kysely, PostgreSQL

| Skill | Author / affiliation | Stars / last skill commit | Content quality | Safety notes | Fit |
|---|---|---|---|---|---|
| `ccheney/robust-skills@postgres-drizzle` | Chris Cheney, individual | 61 / 2026-09-12 | Best Drizzle option: short SKILL.md + 7 references (~100 KB), PG 17/18, distinguishes Drizzle 0.x `relations()` vs v1 `defineRelations()` [V] | Explicitly tells agent to confirm the target before `migrate`/`push` and to treat `EXPLAIN ANALYZE` as execution [V] | High if Drizzle |
| `lobehub/lobehub@drizzle` | LobeHub org | 83K / 2026-09-26 | **Repo-internal style guide** for LobeHub paths (`packages/database/...`, BM25 tests) [V] | Clean | Reject: wrong project |
| `giuseppe-trisciuoglio/developer-kit@drizzle-orm-patterns` | individual | 351 / 2026-03-24 | Generic multi-dialect patterns, `serial` PKs [V] | `allowed-tools: Read, Write, Edit, Bash…` pre-approves Bash [V] | Low |
| `bobmatnyc/claude-mpm-skills@drizzle` | individual (ex-CTO) | 76 / 2026-06-15 | Generic intro + vs-Prisma; `disable-model-invocation: true` (manual only) [V] | Clean | Low |
| `mindrally/skills@kysely` | "Mindrally" org, no identifiable people; 268 top-level skills [V] | 266 / 2026-01-23 | Generic "You are an expert…" single file, `serial` PKs; looks mass-generated [V] | Clean | Low; no good Kysely skill exists |
| `wshobson/agents@postgresql-table-design` | Seth Hobson | 40K / 2026-09-01 | Strong, opinionated, vendor-neutral: identity PKs, `timestamptz`, FK indexes, NULLS NOT DISTINCT, partitioning, types to avoid [V] | Clean | High (schema design phase now) |
| `supabase/agent-skills@supabase-postgres-best-practices` | Supabase org (official) | 2.7K / 2026-07-30 | Good, 34 short rules; 14 of 34 mention Supabase; RLS-heavy; very aggressive trigger ("load BEFORE writing anything in Postgres") [V] | Clean | Medium; overlaps the wshobson skill |
| `planetscale/database-skills@postgres` | PlanetScale org | 693 / 2026-08-26 | Good ops content, but opens with "PlanetScale is the best place to host Postgres"; 9 of 23 refs PlanetScale-specific [V] | **Reference links point to `raw.githubusercontent.com/.../main/...`**, so the agent fetches mutable remote content even from a `--copy` install; promotes PlanetScale MCP/CLI [V] | Reject |

### Web client

| Skill | Author / affiliation | Stars / last skill commit | Content quality | Safety notes | Fit |
|---|---|---|---|---|---|
| `vercel-labs/agent-skills@vercel-react-best-practices` | Vercel org | 32K / 2026-04-14 | 70 rules (re-render, bundle, rendering, JS perf); ~10 `server-*` and some `async-*` rules are Next.js/RSC-only; 108 KB compiled AGENTS.md [V] | Clean | Medium-high; ignore server rules in a Vite SPA |
| `vercel-labs/agent-skills@vercel-composition-patterns` | Vercel org | / 2026-01-28 | Small, sensible (compound components, no boolean props, React 19) [V] | Clean | Low priority |
| `deckardger/tanstack-agent-skills@tanstack-query-best-practices` | Deckard Gerritsen, individual, **not TanStack** | 222 / 2026-09-09 | Good: ~40 rule files (query-key factories, invalidation, optimistic updates, `networkMode`, persistence) [V] | Clean | High |
| `tanstack-skills/tanstack-skills@tanstack-query` | anonymous org created 2026-01-25, **not TanStack** despite name | 34 / 2026-01-25 | One 22 KB doc; stale [V] | Clean, but name invites confusion with the real vendor | Reject |
| `anthropics/skills@frontend-design` | Anthropic (Apache-2.0) | 179K / 2026-09-03 | Design-direction prompt (typography, avoiding templated look) [V] | Clean | Later, for UI polish |

Official TanStack skills ship *inside npm packages* via [TanStack Intent][intent] (Router, Table, DB
have them); `@tanstack/react-query` has none yet [V]. Revisit when it does.

### Tooling, testing, design

| Skill | Author / affiliation | Stars / last skill commit | Content quality | Safety notes | Fit |
|---|---|---|---|---|---|
| `antfu/skills@vite` / `@vitest` / `@pnpm` | Anthony Fu (Vite/Vitest core team) | 5.9K / 2026-09-28 | Generated from upstream docs at a pinned SHA (Vite 8.3, Vitest 5.0, pnpm 12), regenerated regularly; concise index + references [V] | pnpm CI reference shows the official `curl -fsSL https://get.pnpm.io/install.sh \| sh -` [V] | High |
| `mattpocock/skills@tdd` | Matt Pocock | 274K / 2026-09-17 | Strong: seams, anti-patterns, red→green rules; reads `GLOSSARY.md`; calls `codebase-design` skill [V] | Clean | High |
| `mattpocock/skills@codebase-design` | same | / 2026-09-17 | Deep-module vocabulary, "design it twice" with sub-agents. **Replaces `design-an-interface`, which no longer exists** in the repo [V] | Clean | High (dependency of `tdd`) |
| `mattpocock/skills@improve-codebase-architecture` | same | / 2026-09-17 | Manual-only command; needs `grilling` and `domain-modeling` skills; assumes `docs/adr/` and root `GLOSSARY.md` [V] | Writes HTML report to OS temp loading Tailwind and Mermaid from CDN [V] | Later, once there is code |
| `addyosmani/agent-skills@api-and-interface-design` | Addy Osmani | 100K / 2026-08-13 | Solid: contract-first, error shapes, pagination, versioning, Hyrum's law [V] | Clean | High (API-first) |
| `addyosmani/agent-skills@security-and-hardening` | same | / 2026-09-20 | Strong: threat model first, OWASP controls, privacy/retention checklist [V] | Clean | High (uploads, auth, PII) |
| `getsentry/skills@security-review` | Sentry org; OWASP Cheat Sheet derived | 1K / 2026-09-28 | Strong review procedure with confidence levels, "do not flag" list, 20 references [V] | `allowed-tools: Read Grep Glob Bash Task` pre-approves Bash; **name collides with Claude Code's built-in `security-review`** [V] | Medium; collision |
| `github/awesome-copilot@multi-stage-dockerfile` | GitHub org | 40K / 2026-02-24 | 2 KB generic bullet list [V] | Clean | Low |
| `affaan-m/ecc@docker-patterns` | individual "Everything Claude Code" | 271K / 2026-08-06 | Compose basics fine, but a large section is about ECC's own installer harness (`docker/plugin-setup/compose.yaml`) [V] | Leaks foreign repo paths/env vars into our context | Reject |
| `microsoft/playwright-cli@playwright-cli` | Microsoft org | 13.7K / 2026-09-28 | Good, maintained; browser automation + test generation [V] | `allowed-tools` pre-approves `playwright-cli` and `npx playwright`; suggests `npm install -g @playwright/cli@latest`; WebMCP section correctly flags page tools as untrusted [V] | Later, with E2E tests |
| `wshobson/agents@monorepo-management` | Seth Hobson | / 2026-05-22 | Generic, Turborepo/Nx-centric [V] | Suggests `npx create-turbo@latest`, `npx turbo login` [V] | Low; antfu pnpm covers workspaces |

### Official skills for other stack pieces

| Library | Official skill? |
|---|---|
| pg-boss | None; repo has a contributor `AGENTS.md` only. One unknown community skill (`blink-new/claude@pg-boss`, 85 installs, not vetted) [V] |
| Graphile Worker | None; publishes `llms.txt` on its docs site [V] |
| Drizzle | No `drizzle-team` skill repo or skill in `drizzle-orm` [V] |
| Kysely | None; repo `AGENTS.md` is for contributors [V] |
| Hey API / openapi-typescript | None official; only tiny community skills (≤ 221 installs) [V] |
| Zod | None official (repo has internal `.claude/skills` for triage); serves `llms.txt` / `llms-full.txt` [V]. Community `pproenca/dot-skills@zod` not vetted [?] |
| uPlot | None [V] |
| TanStack Query | Not yet; TanStack's official route is Intent skills shipped in npm packages [V] |

### Cross-cutting

- The `skills` CLI (vercel-labs/skills 1.7.0) sends anonymous install telemetry; disable with
  `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` [V].
- Install counts are telemetry-based; e.g. `yusukebe/hono-skill` still shows 12.8K installs for an
  empty repo [V].
- Several skills (tdd, improve-codebase-architecture) assume root `GLOSSARY.md` and `docs/adr/`; our
  paths differ, so add overrides to AGENTS.md as done for `domain-modeling` [V].

## Recommendation

Prefix installs with `DISABLE_TELEMETRY=1` if wanted. Commit the copied folders and `skills-lock.json`.

### Install now (prototype)

| Skill | Reason | Command |
|---|---|---|
| tdd | Best testing-discipline skill; fits Vitest | `npx skills add mattpocock/skills -s tdd --copy` |
| codebase-design | Required by `tdd`; replaces `design-an-interface` | `npx skills add mattpocock/skills -s codebase-design --copy` |
| vitest | Current (v5) generated docs from a core-team member | `npx skills add antfu/skills -s vitest --copy` |
| vite | Current Vite 8 docs for the SPA | `npx skills add antfu/skills -s vite --copy` |
| pnpm | pnpm 12 workspaces/catalogs for the monorepo | `npx skills add antfu/skills -s pnpm --copy` |
| postgresql-table-design | Vendor-neutral schema rules for the data-model work | `npx skills add wshobson/agents -s postgresql-table-design --copy` |
| api-and-interface-design | API-first contract design | `npx skills add addyosmani/agent-skills -s api-and-interface-design --copy` |
| security-and-hardening | Uploads, auth and PII from day one | `npx skills add addyosmani/agent-skills -s security-and-hardening --copy` |
| tanstack-query-best-practices | Only good TanStack Query skill (community, not official) | `npx skills add deckardger/tanstack-agent-skills -s tanstack-query-best-practices --copy` |
| vercel-react-best-practices | Solid React perf rules; ignore `server-*` rules (no RSC) | `npx skills add vercel-labs/agent-skills -s vercel-react-best-practices --copy` |

### Install when the matching library or phase is chosen

| Trigger | Skill | Reason | Command |
|---|---|---|---|
| Fastify | fastify-best-practices | By the lead maintainer; covers TypeBox + `@fastify/swagger` (code-first OpenAPI) | `npx skills add mcollina/skills -s fastify-best-practices --copy` |
| Hono | hono | Official, but thin on Node/OpenAPI; mind `@hono/cli@next` and remote doc fetching | `npx skills add honojs/skills -s hono --copy` |
| NestJS | nestjs-best-practices | Decent community rule set | `npx skills add kadajett/agent-nestjs-skills -s nestjs-best-practices --copy` |
| Better Auth | better-auth-best-practices | Official, version-aware | `npx skills add better-auth/skills -s better-auth-best-practices --copy` |
| Better Auth | better-auth-security-best-practices | Official hardening guide | `npx skills add better-auth/skills -s better-auth-security-best-practices --copy` |
| Better Auth email/password, 2FA features | email-and-password-best-practices, two-factor-authentication-best-practices | Focused official guides | `npx skills add better-auth/skills -s email-and-password-best-practices --copy` / `… -s two-factor-authentication-best-practices --copy` |
| Drizzle | postgres-drizzle | Best Drizzle skill, version-aware, asks before migrating | `npx skills add ccheney/robust-skills -s postgres-drizzle --copy` |
| E2E tests | playwright-cli | Official Microsoft; review its pre-approved tools first | `npx skills add microsoft/playwright-cli -s playwright-cli --copy` |
| UI design pass | frontend-design | Official Anthropic design prompt | `npx skills add anthropics/skills -s frontend-design --copy` |
| Code exists, refactoring | improve-codebase-architecture (+ `grilling`) | Useful, but needs overrides for `docs/decisions/` and `docs/glossary.md` | `npx skills add mattpocock/skills -s improve-codebase-architecture --copy` |

Tie-breaker for open picks: the Fastify skill is clearly stronger than the Hono and NestJS ones, and
Drizzle has a good community skill while Kysely has none. This slightly favours **Fastify + Drizzle**;
it should not outweigh the spike results.

### Reject

| Skill | Reason |
|---|---|
| `yusukebe/hono-skill@hono` | Repo emptied; moved to `honojs/skills` |
| `lobehub/lobehub@drizzle` | LobeHub's internal style guide with their paths |
| `giuseppe-trisciuoglio/developer-kit@drizzle-orm-patterns` | Generic; pre-approves Bash/Write |
| `bobmatnyc/claude-mpm-skills@drizzle` | Generic, manual-only; ccheney's is better |
| `mindrally/skills@kysely` | Mass-generated, generic, stale |
| `planetscale/database-skills@postgres` | Vendor advert; references load from mutable remote `main` URLs |
| `supabase/agent-skills@supabase-postgres-best-practices` | Overlaps postgresql-table-design; Supabase/RLS focus; over-eager trigger |
| `tanstack-skills/tanstack-skills@tanstack-query` | Not TanStack despite the name; single stale doc |
| `vercel-labs/agent-skills@vercel-composition-patterns` | Fine but low value now; revisit with a component library |
| `getsentry/skills@security-review` | Name clashes with Claude Code's built-in `/security-review`; pre-approves Bash |
| `better-auth/skills@create-auth` | Scaffolder that bypasses our deliberate auth design |
| `github/awesome-copilot@multi-stage-dockerfile` | 2 KB of generic bullets |
| `affaan-m/ecc@docker-patterns` | Embeds another project's harness paths |
| `wshobson/agents@nodejs-backend-patterns` | Generic; superseded by a framework skill |
| `wshobson/agents@monorepo-management` | Turborepo/Nx-centric; pnpm skill covers workspaces |
| `mattpocock/skills@design-an-interface` | No longer exists; use `codebase-design` |

## Gaps

- **Job queue** (pg-boss, Graphile Worker): no usable skill; Graphile Worker's `llms.txt` is the best agent aid.
- **OpenAPI toolchain** (Hey API, openapi-typescript, spec-first vs code-first): nothing trustworthy.
- **Zod**, **Kysely**: no official skill; community ones weak or unvetted.
- **uPlot / dive-profile charting**, **MapLibre**: nothing.
- **Docker Compose for self-hosting** (NAS, backups, upgrades): no good skill.
- **FIT / UDDF / dive domain**: none; would be our own project skill.
- **Hono + OpenAPI** (`@hono/zod-openapi`): not covered by the official Hono skill.

## Sources

- Skill repos: [mcollina/skills][fastify], [honojs/skills][hono], [yusukebe/hono-skill][hono-old], [Kadajett/agent-nestjs-skills][nest], [better-auth/skills][ba]
- [ccheney/robust-skills][ccheney], [lobehub/lobehub][lobehub], [giuseppe-trisciuoglio/developer-kit][giuseppe], [bobmatnyc/claude-mpm-skills][bob], [Mindrally/skills][mindrally]
- [supabase/agent-skills][supabase], [wshobson/agents][wshobson], [planetscale/database-skills][planetscale]
- [vercel-labs/agent-skills][vercel], [DeckardGer/tanstack-agent-skills][deckard], [tanstack-skills/tanstack-skills][tss], [TanStack Intent][intent]
- [antfu/skills][antfu], [mattpocock/skills][matt], [addyosmani/agent-skills][addy], [getsentry/skills][sentry]
- [github/awesome-copilot][copilot], [affaan-m/ECC][ecc], [microsoft/playwright-cli][pw], [anthropics/skills][anthropic]
- [vercel-labs/skills CLI (telemetry section)][cli], [npm `auth` package][npm-auth]
- [pg-boss][pgboss], [Graphile Worker][graphile], [Kysely][kysely], [Zod][zod], [Hey API][heyapi], [openapi-typescript][oapi], [uPlot][uplot]

[fastify]: https://github.com/mcollina/skills/tree/main/skills/fastify
[hono]: https://github.com/honojs/skills
[hono-old]: https://github.com/yusukebe/hono-skill
[nest]: https://github.com/Kadajett/agent-nestjs-skills
[ba]: https://github.com/better-auth/skills
[ccheney]: https://github.com/ccheney/robust-skills/tree/main/skills/postgres-drizzle
[lobehub]: https://github.com/lobehub/lobehub/tree/main/.agents/skills/drizzle
[giuseppe]: https://github.com/giuseppe-trisciuoglio/developer-kit
[bob]: https://github.com/bobmatnyc/claude-mpm-skills
[mindrally]: https://github.com/Mindrally/skills/tree/main/kysely
[supabase]: https://github.com/supabase/agent-skills
[wshobson]: https://github.com/wshobson/agents
[planetscale]: https://github.com/planetscale/database-skills
[vercel]: https://github.com/vercel-labs/agent-skills
[deckard]: https://github.com/DeckardGer/tanstack-agent-skills
[tss]: https://github.com/tanstack-skills/tanstack-skills
[intent]: https://github.com/TanStack/intent
[antfu]: https://github.com/antfu/skills
[matt]: https://github.com/mattpocock/skills
[addy]: https://github.com/addyosmani/agent-skills
[sentry]: https://github.com/getsentry/skills/tree/main/skills/security-review
[copilot]: https://github.com/github/awesome-copilot/tree/main/skills/multi-stage-dockerfile
[ecc]: https://github.com/affaan-m/ECC/tree/main/skills/docker-patterns
[pw]: https://github.com/microsoft/playwright-cli
[anthropic]: https://github.com/anthropics/skills/tree/main/skills/frontend-design
[cli]: https://github.com/vercel-labs/skills#telemetry
[npm-auth]: https://www.npmjs.com/package/auth
[pgboss]: https://github.com/timgit/pg-boss
[graphile]: https://worker.graphile.org/
[kysely]: https://github.com/kysely-org/kysely
[zod]: https://github.com/colinhacks/zod
[heyapi]: https://github.com/hey-api/openapi-ts
[oapi]: https://github.com/openapi-ts/openapi-typescript
[uplot]: https://github.com/leeoniya/uPlot

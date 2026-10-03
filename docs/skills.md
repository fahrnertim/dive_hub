---
title: Agent skills
summary: Which agent skills the project uses, which were considered and rejected, and why.
status: living
date: 2026-10-03
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

Install with telemetry off: `DISABLE_TELEMETRY=1 npx skills add <owner/repo> -s <skill> -a claude-code --copy -y`.

## Pending (install when the matching library or phase is chosen)

Details and commands: [skills vetting](research/2026-10-02-agent-skills-vetting.md).

| When | Skill |
|---|---|
| 2FA built | better-auth/skills `two-factor-authentication-best-practices` |
| End-to-end tests | microsoft/playwright-cli `playwright-cli` |
| Code exists, refactoring | mattpocock/skills `improve-codebase-architecture` |

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

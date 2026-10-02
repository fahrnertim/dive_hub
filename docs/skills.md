---
title: Agent skills
summary: Which agent skills the project uses, which were considered and rejected, and why.
status: living
date: 2026-10-02
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

Install with telemetry off: `DISABLE_TELEMETRY=1 npx skills add <owner/repo> -s <skill> -a claude-code --copy -y`.

## Pending (install when the matching library or phase is chosen)

Details and commands: [skills vetting](research/2026-10-02-agent-skills-vetting.md).

| When | Skill |
|---|---|
| Fastify chosen | mcollina/skills `fastify-best-practices` |
| Hono chosen | honojs/skills `hono` |
| NestJS chosen | kadajett/agent-nestjs-skills `nestjs-best-practices` |
| Better Auth chosen | better-auth/skills `better-auth-best-practices`, `better-auth-security-best-practices` (later: email/password, 2FA) |
| Drizzle chosen | ccheney/robust-skills `postgres-drizzle` |
| End-to-end tests | microsoft/playwright-cli `playwright-cli` |
| UI design work | anthropics/skills `frontend-design` |
| Code exists, refactoring | mattpocock/skills `improve-codebase-architecture` |

## Decisions log

| Date | Skill | Outcome | Reason |
|---|---|---|---|
| 2026-10-02 | domain-modeling (mattpocock/skills) | installed | glossary and ADR discipline; paths overridden in AGENTS.md |
| 2026-10-02 | tdd, codebase-design, vitest, vite, pnpm, postgresql-table-design, api-and-interface-design, security-and-hardening, tanstack-query-best-practices, vercel-react-best-practices | installed | vetted, see [skills vetting](research/2026-10-02-agent-skills-vetting.md) |
| 2026-10-02 | planetscale postgres, affaan-m docker-patterns, getsentry security-review, giuseppe drizzle-orm-patterns | rejected | safety: vendor ads with live remote links, foreign project context, or pre-approved Bash/Write |
| 2026-10-02 | yusukebe/hono-skill, mattpocock design-an-interface, lobehub drizzle, tanstack-skills/tanstack-skills | rejected | dead, moved, or internal/unaffiliated |
| 2026-10-02 | mindrally kysely, bobmatnyc drizzle, supabase-postgres-best-practices, multi-stage-dockerfile, nodejs-backend-patterns, monorepo-management, vercel-composition-patterns, better-auth create-auth | rejected | generic, overlapping, or bypasses our own design |

---
title: Agent skills
summary: The agent skills installed in the repository and the project rules that win over them.
status: living
date: 2026-11-04
---

# Agent skills

Rule (see [AGENTS.md](../AGENTS.md#skills)): load the skills your task names. Before using one, read its entry under
[Overrides](#overrides). Role-specific skills (design, auth, icons and the like) live in the Paperclip company library,
not here.

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
| codebase-design | mattpocock/skills | module/interface vocabulary | 2026-10-02 |
| vitest | antfu/skills | unit and integration tests | 2026-10-02 |
| vite | antfu/skills | web client build | 2026-10-02 |
| pnpm | antfu/skills | monorepo, workspaces | 2026-10-02 |
| tanstack-query-best-practices | deckardger/tanstack-agent-skills | server state in the web client | 2026-10-02 |
| vercel-react-best-practices | vercel-labs/agent-skills | React performance (SPA rules only) | 2026-10-02 |
| fastify-best-practices | mcollina/skills | Fastify routes, plugins, schemas, OpenAPI | 2026-10-02 |
| postgres-drizzle | ccheney/robust-skills | Drizzle schema, queries, migrations | 2026-10-02 |
| accessibility | addyosmani/web-quality-skills | WCAG 2.2 rules, keyboard and screen-reader patterns, audits | 2026-10-03 |
| playwright-cli | microsoft/playwright-cli | driving a browser, writing and debugging Playwright tests | 2026-10-03 |
| karpathy-guidelines | forrestchang/andrej-karpathy-skills (2c60614) | writing, reviewing and refactoring code: assumptions said, the simplest change, surgical edits, verifiable goals | 2026-10-28 |

Install with telemetry off: `DISABLE_TELEMETRY=1 npx skills add <owner/repo> -s <skill> -a claude-code --copy -y`.

## Overrides

Where a skill and this project disagree, these rules win.

- **domain-modeling**: the glossary is `docs/glossary.md` (not root `GLOSSARY.md`);
  ADRs go in `docs/decisions/` using our [template](decisions/template.md)
  (not `docs/adr/`). Its "offer ADRs sparingly" criteria apply.
- **codebase-design**: same paths — glossary is `docs/glossary.md`, ADRs are in
  `docs/decisions/`. Test and interface names use the glossary's terms.
- **vercel-react-best-practices**: our web client is a Vite SPA, not Next.js. Ignore the
  `server-*` rules (React Server Components, server actions).
- **tanstack-query-best-practices**: community skill, not from TanStack; official docs win on conflict.
- **accessibility**: target WCAG 2.2 AA; build on the React Aria components in `apps/web/src/ui/`.
- **playwright-cli**: tests live in `apps/web/e2e` and run with `pnpm --filter @dive-hub/web test:e2e` (every test has an area tag, [ADR 0023](decisions/0023-faster-checks.md))
  (installed Edge/Chrome; don't run `npx playwright install`). Keep tests at the User's level: roles,
  labels and visible text, not CSS classes. A new page or state gets a case in `e2e/ui-quality.spec.ts`
  ([page rules](spec/design-system.md#rules-every-page-follows)).
- **karpathy-guidelines** (forrestchang): its "If uncertain, ask" and "If something is unclear, stop … Ask" hold in a
  session with the owner. In a Paperclip task, an unclear point goes into the task as a question to the owner or
  reviewer; the existing stops still ask: an irreversible or security-sensitive step, a plan where every way forward is a
  guess. Its "surgical changes" don't excuse leaving what the edit hook or `pnpm check` reports in a touched file. Its
  test-first examples follow the test rules in [AGENTS.md](../AGENTS.md#tests).

# AGENTS.md

For AI coding agents (any tool).

## Rule #1: where knowledge lives

Work runs through Paperclip ([ADR 0065](docs/decisions/0065-work-runs-through-paperclip.md)).

- **This repository** holds durable product knowledge: spec, glossary, architecture ADRs, references.
- **Paperclip** holds work state: tasks, plans, discussion, review. Process and workflow rules live there too.
- **Agent memory** holds operational notes only, never product knowledge.
- Asked to "remember" something about the product: put it in `docs/` and say where.

## Where things are

Start at [docs/index.md](docs/index.md).

| Folder | Contents |
|---|---|
| `docs/spec/` | Product specification |
| `docs/glossary.md` | Domain language |
| `docs/decisions/` | ADRs (`NNNN-title.md`, copy `template.md`) |
| `docs/references/` | One file per external project/source |
| `docs/research/` | Dated research notes (`YYYY-MM-DD-topic.md`), sources linked |

## Conventions

- Markdown with YAML frontmatter (`title`, `summary`, `status`, `date`); relative links, not `[[wikilinks]]`.
- ADRs only for decisions that are hard to reverse, surprising and a real trade-off; the discussion stays in the
  Paperclip issue and the ADR links to it. Don't re-litigate accepted ones without a new ADR.
- **Research**: new research goes into a Paperclip issue document; a note moves into `docs/research/` only when an ADR
  or spec cites it. Existing notes stay.
- **Checks** ([ADR 0023](docs/decisions/0023-faster-checks.md)): `pnpm check` while working and before a commit (only what changed
  since its last green run); no full check before a push: CI's `pnpm check:full` on the PR is the gate. The review
  capture (`REVIEW_AREAS`) only when UI changed. After a fix, `pnpm check` again (it can count from the failed
  browser run). `pnpm check --failed` reruns failed browser tests (green there renews the record); a change to e2e helpers or fixtures runs no browser tests:
  `pnpm check --tests <filter>` runs given ones and records them ([development.md](docs/development.md)); `pnpm check:log`
  sums the local run log. A PR whose CI fails after a green local check gets an entry in [check escapes](docs/agents/check-escapes.md).
  A docs-only commit needs no check. A new page or module gets its path in `scripts/check-lib.mjs`; a browser test an area tag.
- **Gates** ([research](docs/research/2026-10-22-agent-guardrails.md)): an edit hook lints each file; run `pnpm hooks:install`
  once per clone (pre-commit check). Fix what they report; never grow a baseline
  or raise a threshold. After a fix, `pnpm lint:baseline`.
  Module rules: [ADR 0053](docs/decisions/0053-module-boundaries.md). Before finishing a branch, run the `architecture-review` subagent.
- A new duty for API clients (something to show, ask, format or send) updates the [client contract](docs/spec/clients.md).
- The owner decides migrations (`apps/server/drizzle/**`), `**/db/schema.ts` and `docs/decisions/**`
  ([CODEOWNERS](.github/CODEOWNERS)); a task needing them without approval stops and hands back.
- Keep this file short.

## Tests

- Tests first.
- Tests run against a real PostgreSQL. At most one `vi.fn`, no `vi.mock`.
- Browser tests carry an area tag.
- `pnpm`, never `npm`.
- Iterate with `pnpm check --failed` / `--tests <filter>`; one full `pnpm check` after the last edit.

## Skills

Project skills live in `.claude/skills/` (pinned in `skills-lock.json`). Don't edit them.

- **Load the skills your task names**; read its override in [docs/skills.md](docs/skills.md#overrides) first: our rules win over the skill's.
- Role-specific skills live in the Paperclip company library.
- **Before new work** (area, design, technology), search for skills; install only vetted and user-approved ones.

## Working economically

- Search before reading; read parts, not whole files. `docs/index.md` and the glossary are searched, not read through.
- Keep long output out of the context: filter it or write it to a file.
- **Never saved on**: the checks before a commit or push, tests first, reading an ADR before changing it, reviewing UI
  screenshots, reading the code around an edit.

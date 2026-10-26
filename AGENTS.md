# AGENTS.md

For AI coding agents (any tool).

## Rule #1: all project knowledge lives in this repository

- All project information (spec, decisions, research, conventions, what's worth remembering) goes into a committed file here ([ADR 0001](docs/decisions/0001-all-project-knowledge-in-repo.md)).
- **Never** use local or account memory: no `~/.claude/projects/*/memory/`, no `~/.claude/CLAUDE.md`,
  no `CLAUDE.local.md`, nor other tools' equivalents.
- **Never** keep project information only in external services (Claude Docs, Drive, artifacts, chat).
- Write what's worth keeping into `docs/` (and [docs/index.md](docs/index.md)); asked to "remember", put it there and say where.

## Where things are

Start at [docs/index.md](docs/index.md); it lists every document.

| Folder | Contents |
|---|---|
| `docs/spec/` | Product specification |
| `docs/glossary.md` | Domain language |
| `docs/decisions/` | ADRs (`NNNN-title.md`, copy `template.md`) |
| `docs/references/` | One file per external project/source |
| `docs/research/` | Dated research notes (`YYYY-MM-DD-topic.md`), sources linked |

## Conventions

- Markdown with YAML frontmatter (`title`, `summary`, `status`, `date`); relative links, not `[[wikilinks]]`.
- Record significant decisions as ADRs; don't re-litigate accepted ones without a new ADR.
- **Checks** ([ADR 0023](docs/decisions/0023-faster-checks.md)): `pnpm check` while working and before a commit (only what changed
  since its last green run); no full check before a push: CI's `pnpm check:full` on the PR is the gate. The review
  capture (`REVIEW_AREAS`) only when UI changed. After a fix, `pnpm check` again (it can count from the failed
  browser run). `pnpm check --failed` reruns failed browser tests (green there renews the record); `pnpm check:log`
  sums the local run log. A PR whose CI fails after a green local check gets an entry in [check escapes](docs/agents/check-escapes.md).
  A docs-only commit needs no check. A new page or module gets its path in `scripts/check-lib.mjs`; a browser test an area tag.
- **Gates** ([research](docs/research/2026-10-22-agent-guardrails.md)): an edit hook lints each file; run `pnpm hooks:install`
  once per clone (pre-commit check). Fix what they report; never grow a baseline
  or raise a threshold. After a fix, `pnpm lint:baseline`.
  Module rules: [ADR 0053](docs/decisions/0053-module-boundaries.md). Before finishing a branch, run the `architecture-review` subagent.
- **Feature work** ([ADR 0055](docs/decisions/0055-local-dev-cycle.md)): the Superpowers plugin, with [our overrides](docs/skills.md#overrides).
- **Unattended runs** ([ADR 0054](docs/decisions/0054-unattended-implementation.md)): tasks in `docs/backlog/`; a run follows
  `.claude/agents/unattended-runner.md` and never touches protected paths (`scripts/agent-lib.mjs`).
- A new duty for API clients (something to show, ask, format or send) updates the [client contract](docs/spec/clients.md).
- Keep this file short.

## Skills

Project skills live in `.claude/skills/` (pinned in `skills-lock.json`). Don't edit them.

- **Load the [installed skills](docs/skills.md#installed) that fit the work** before starting, also for familiar tools.
- **Before using a skill, read its override** in [docs/skills.md](docs/skills.md#overrides): our rules win over the skill's.
- **Before new work** (area, design, technology), search for skills; install only vetted and user-approved ones.

## Working economically

Context is most of a session's cost ([ADR 0039](docs/decisions/0039-working-economically.md)):
[rules and the hand-over prompt](docs/agents/working-economically.md).

- **One slice, one session.** After the slice's commit, write a hand-over prompt for a fresh session.
- **Search before reading, parts before whole files.** Read a whole file only before changing it as a whole.
  `docs/index.md` and the glossary are searched, not read through.
- **Keep long output out of the conversation**: filter it or write it to a file.
- **Research and broad searches go to a subagent** on a smaller model; implementation and checks stay in the session.
- **Never saved on**: the checks before a commit or push, tests first, reading an ADR before changing it, reviewing UI
  screenshots, reading the code around an edit.

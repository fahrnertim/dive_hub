# AGENTS.md

Instructions for AI coding agents (any tool) working in this repository.

## Rule #1: all project knowledge lives in this repository

- Every piece of project information — spec, decisions, references to other
  projects, research, conventions, "things worth remembering" — goes into a file
  in this repo and gets committed. See [ADR 0001](docs/decisions/0001-all-project-knowledge-in-repo.md).
- **Never** use local, per-user or account-specific memory for this project:
  no `~/.claude/projects/*/memory/`, no `~/.claude/CLAUDE.md`, no
  `CLAUDE.local.md`, no equivalent memory features of other tools.
- **Never** store project information only in external services (Claude Docs,
  Google Drive, artifacts, chat history). If something is published externally,
  its source must also be committed here.
- If you learn something worth keeping, write it into `docs/` (and update
  [docs/index.md](docs/index.md)) instead of "remembering" it.
- When a user asks you to "remember" something, put it in the repo and say where.

## Where things are

Start at [docs/index.md](docs/index.md) — it lists every document.

| Folder | Contents |
|---|---|
| `docs/spec/` | Product specification |
| `docs/glossary.md` | Domain language (created with the first term) |
| `docs/decisions/` | ADRs (`NNNN-title.md`, copy `template.md`) |
| `docs/references/` | One file per external project/source |
| `docs/research/` | Dated research notes (`YYYY-MM-DD-topic.md`), sources linked |

## Conventions

- Markdown with YAML frontmatter: `title`, `summary`, `status`, `date`.
- Relative Markdown links (not `[[wikilinks]]`).
- Record significant decisions as ADRs; don't re-litigate accepted ones without a new ADR.
- **Checks** ([ADR 0023](docs/decisions/0023-faster-checks.md)): `pnpm check` while working and before proposing a commit (only what
  the change touches; it runs everything by itself when the change is broad), `pnpm check:full` before a push or a release,
  and the review capture with `REVIEW_AREAS` only when UI changed.
  A commit of documentation only (`docs/`, `AGENTS.md`, `CLAUDE.md`, `README.md`) needs no check.
  A new page or module gets its path in `scripts/check.mjs`, and a new browser test gets an area tag.
- A change that gives API clients a new duty (something to show, ask, format or send) updates the
  [client contract](docs/spec/clients.md) in the same change.
- Keep this file short; details belong in `docs/`.

## Skills

Project skills live in `.claude/skills/` (pinned in `skills-lock.json`). Don't edit them.

- **Load the installed skills that fit the work** before starting in their area (tests, schema, API, forms, tables, auth, …),
  also for familiar tools: a skill that isn't loaded shapes nothing. The list: [docs/skills.md](docs/skills.md#installed).
- **Before using a skill, read its override** in [docs/skills.md](docs/skills.md#overrides): our rules win over the skill's.
- **Before new work** (a new area, design, or technology), search for specialized skills, vet them, propose
  them to the user and install only with their approval. How, and the record of outcomes: [docs/skills.md](docs/skills.md).

## Working economically

Most of a session's cost is its context, sent again with every request ([ADR 0039](docs/decisions/0039-working-economically.md)).
The full rules, with the hand-over prompt: [docs/agents/working-economically.md](docs/agents/working-economically.md).

- **One slice, one session.** After the slice's commit, write a hand-over prompt; the next slice starts in a fresh session.
- **Search before reading, parts before whole files.** Read a whole file only before changing it as a whole.
  `docs/index.md` and the glossary are searched, not read through.
- **Keep long output out of the conversation**: filter it, or write it to a file and search that.
- **Research and broad searches go to a subagent** on a smaller model; implementation and checks stay in the session.
- **Never saved on**: a green `pnpm check` before a commit that changes more than documentation, `pnpm check:full` before a push, tests first, reading an ADR in full before changing what
  it decided, reviewing the screenshots when UI changed, reading the code around an edit.

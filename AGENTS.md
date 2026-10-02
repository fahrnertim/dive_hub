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
- Keep this file short; details belong in `docs/`.

## Skills

Project skills live in `.claude/skills/` (installed with `npx skills add … --copy`,
pinned in `skills-lock.json`). Don't edit them; override here instead.

**Rule: check for skills before new work.** Before starting anything new (a new area,
design, or implementation with a new technology), search for specialized skills
(`npx skills find <topic>`, [skills.sh](https://skills.sh/)). Vet them (source reputation,
installs, repo activity, read the SKILL.md), propose the good ones to the user, and
install only with their approval, at project level. Record the outcome — installed or
rejected, and why — in [docs/skills.md](docs/skills.md).

- **domain-modeling**: the glossary is `docs/glossary.md` (not root `GLOSSARY.md`);
  ADRs go in `docs/decisions/` using our [template](docs/decisions/template.md)
  (not `docs/adr/`). Its "offer ADRs sparingly" criteria apply.
- **tdd**, **codebase-design**: same paths — glossary is `docs/glossary.md`, ADRs are in
  `docs/decisions/`. Test and interface names use the glossary's terms.
- **vercel-react-best-practices**: our web client is a Vite SPA, not Next.js. Ignore the
  `server-*` rules (React Server Components, server actions).
- **tanstack-query-best-practices**: community skill, not from TanStack; official docs win on conflict.

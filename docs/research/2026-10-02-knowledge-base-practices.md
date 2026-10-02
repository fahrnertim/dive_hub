---
title: Project knowledge bases readable by humans and LLMs
summary: Survey of formats and conventions for an in-repo knowledge base that both people and coding agents can use.
status: done
date: 2026-10-02
---

# Project knowledge bases readable by humans and LLMs

## Question

How should we structure this repository's knowledge (spec, decisions, references,
research) so that it is pleasant for humans to read *and* efficient for LLM agents
to navigate?

## Findings

### 1. Plain Markdown in git is the common denominator
- Markdown is diffable, reviewable in PRs, renders on GitHub/IDEs, and is far more
  token-efficient for LLMs than HTML ([Fern][fern]).
- At project scale no vector DB / RAG is needed: a well-indexed folder of Markdown
  files that the agent reads on demand is enough ([Karpathy LLM wiki][karpathy],
  [DAIR summary][dair]).

### 2. Agent instruction files: `AGENTS.md` + `CLAUDE.md`
- `AGENTS.md` is the cross-tool open standard ("README for agents"), now stewarded by
  the Agentic AI Foundation (Linux Foundation); read by Codex, Cursor, Gemini CLI,
  and others ([aihero guide][aihero], [eesel][eesel]).
- Claude Code reads `CLAUDE.md`; it can import `AGENTS.md` via `@AGENTS.md`, so one
  canonical file serves all agents ([eesel][eesel], [hivetrail][hivetrail]).
- Keep it short (often recommended < ~200 lines). Separate "how to behave"
  (AGENTS.md) from "where to look" (an index/map file) ([Verdent][verdent]).

### 3. Karpathy's "LLM wiki" pattern
Three layers ([gist][karpathy]):
- **Raw sources** – immutable inputs (articles, papers, notes); read, never rewritten.
- **Wiki** – curated, interlinked Markdown pages maintained (mostly) by the LLM.
- **Schema** – the instruction file (CLAUDE.md/AGENTS.md) defining structure and workflows.

Key files: `index.md` (catalog with one-line summary per page, updated on every
change) and `log.md` (append-only chronology). Operations: **ingest**, **query**
(file valuable answers back as pages), **lint** (find contradictions, stale claims,
orphans).

### 4. Architecture Decision Records (ADRs)
- One Markdown file per significant decision in `docs/adr/` or `docs/decisions/`,
  Nygard format: Status, Context, Decision, Consequences; MADR is a popular
  Markdown template ([adr.github.io][adr-org], [MADR paper][madr], [Catio][catio]).
- Gives both humans and agents the *why* behind the current state, preventing
  re-litigation of settled questions.

### 5. Spec-driven development
- Kiro: per-feature `requirements.md` (user stories + EARS acceptance criteria),
  `design.md`, `tasks.md` ([Kiro docs][kiro]).
- GitHub Spec Kit: constitution → specify → plan → tasks → implement, all as
  committed Markdown ([Fowler/Böckeler][fowler-sdd], [codemyspec][speckit-vs-kiro]).

### 6. Diátaxis for human-facing docs
Four doc types – tutorials, how-to guides, reference, explanation ([diataxis.fr][diataxis]).
Useful once the project has user-facing docs; overkill on day one.

### 7. Metadata and links
- YAML frontmatter (`title`, `summary`, `status`, dates) is machine-parsable,
  renders cleanly on GitHub, and is understood by Obsidian Properties
  ([obsidian-skills][obsidian-fm]).
- Obsidian `[[wikilinks]]` don't resolve on GitHub; standard relative Markdown links
  work everywhere (GitHub, IDEs, Obsidian, agents following paths).

### 8. `llms.txt`
A curated Markdown index for *websites* ([answer.ai proposal][llmstxt]). Not needed for
an in-repo knowledge base; `docs/index.md` fills the same role. Revisit if we publish docs.

## Recommendation (adopted in [ADR 0002](../decisions/0002-knowledge-base-structure.md))

- `AGENTS.md` as canonical agent instructions; `CLAUDE.md` imports it plus
  Claude-specific rules.
- `docs/index.md` as the single map (one line per document).
- `docs/spec/` for the product spec (Kiro-style requirements/design/tasks per feature when useful).
- `docs/decisions/` for ADRs (Nygard/MADR-lite).
- `docs/references/` – one file per external source/project, with URL and what we take from it.
- `docs/research/` – dated research notes like this one.
- YAML frontmatter + relative Markdown links everywhere; Obsidian-compatible but not required.
- Git history serves as the log; no separate `log.md` for now.

[fern]: https://buildwithfern.com/post/how-to-write-llm-friendly-documentation
[karpathy]: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
[dair]: https://academy.dair.ai/blog/llm-knowledge-bases-karpathy
[aihero]: https://www.aihero.dev/a-complete-guide-to-agents-md
[eesel]: https://www.eesel.ai/blog/claude-code-agents-md
[hivetrail]: https://hivetrail.com/blog/agents-md-vs-claude-md-cross-tool-standard
[verdent]: https://www.verdent.ai/guides/llm-knowledge-base-coding-agents
[adr-org]: https://github.com/adr
[madr]: https://ceur-ws.org/Vol-2072/paper9.pdf
[catio]: https://www.catio.tech/blog/architecture-decision-record
[kiro]: https://kiro.dev/docs/specs/
[fowler-sdd]: https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
[speckit-vs-kiro]: https://codemyspec.com/blog/spec-kit-vs-kiro
[diataxis]: https://diataxis.fr/
[obsidian-fm]: https://deepwiki.com/kepano/obsidian-skills/2.6-properties-and-frontmatter
[llmstxt]: https://www.answer.ai/posts/2024-09-03-llmstxt.html

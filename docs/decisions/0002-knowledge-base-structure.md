---
title: "ADR 0002: Knowledge base structure"
summary: AGENTS.md + docs/ with index, spec, decisions (ADRs), references and research; Markdown with YAML frontmatter.
status: accepted
date: 2026-10-02
---

# ADR 0002: Knowledge base structure

## Status
Accepted – 2026-10-02

## Context
The knowledge base must be readable by humans and efficiently navigable by LLM
agents. See research: [Project knowledge bases readable by humans and LLMs](../research/2026-10-02-knowledge-base-practices.md).

## Decision
- **`AGENTS.md`** – canonical, tool-agnostic agent instructions (open standard).
- **`CLAUDE.md`** – imports `AGENTS.md`; holds only Claude-specific additions.
- **`docs/index.md`** – the map: one line per document. Updated with every added/removed doc.
- **`docs/spec/`** – product specification. Larger features may use
  `requirements.md` / `design.md` / `tasks.md` (spec-driven style).
- **`docs/decisions/`** – ADRs, `NNNN-kebab-title.md`, sections Status / Context / Decision / Consequences.
  Superseded ADRs are kept and marked `superseded by NNNN`.
- **`docs/references/`** – one file per external project/source: URL, what it is, what we take from it.
- **`docs/research/`** – dated notes `YYYY-MM-DD-topic.md` with sources linked.
- Every doc starts with YAML frontmatter: `title`, `summary`, `status`, `date`.
- Links are standard relative Markdown links (work on GitHub, IDEs, Obsidian, agents).
- Git history is the change log; no separate `log.md`.

## Consequences
- An agent can orient itself by reading `AGENTS.md` → `docs/index.md` → specific files.
- Decisions are recorded once and not re-litigated.
- Small upkeep cost: keep `docs/index.md` and frontmatter current.

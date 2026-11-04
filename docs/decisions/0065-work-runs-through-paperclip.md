---
title: "ADR 0065: Work runs through Paperclip"
summary: Work state lives in Paperclip, durable product knowledge in this repository, operational notes in agent memory; ADRs only for hard-to-reverse, surprising decisions; process rules live in Paperclip.
status: accepted
date: 2026-11-04
---

# ADR 0065: Work runs through Paperclip

## Status
Accepted – 2026-11-04 (owner, approved on the Paperclip issue FAH-11). Supersedes
[0001](0001-all-project-knowledge-in-repo.md), [0039](0039-working-economically.md),
[0054](0054-unattended-implementation.md) and [0055](0055-local-dev-cycle.md).

## Context
Agents now work as Paperclip agents on Paperclip tasks, and the owner reviews the pull requests they open. The
repository carried its own parallel process: a rule that forbade any memory outside it, an unattended runner with a
backlog folder and protected-path hooks, the Superpowers plugin with its own design and plan folders, and
session-economy rules. Task state, plans and discussion existed in two places, and process rules sat in ADRs that
are costly to change.

## Decision
1. **Knowledge split.** This repository holds durable product knowledge: spec, glossary, architecture ADRs,
   references. Paperclip holds work state: tasks, plans, discussion, review. Agent memory holds operational notes
   only, never product knowledge.
2. **The ADR bar.** An ADR records a decision that is hard to reverse, surprising and a real trade-off. The
   discussion stays in the Paperclip issue, and the ADR links to it.
3. **Process and workflow rules live in Paperclip** (agent instructions, skills of the company library, routines),
   not in ADRs. `AGENTS.md` keeps only the rules a change to this code base needs.
4. **Research** goes into a Paperclip issue document; a note moves into `docs/research/` only when an ADR or the
   spec cites it. Existing notes stay.
5. The owner's decision on migrations, the schema and ADRs is kept with `.github/CODEOWNERS` instead of hooks.

## Consequences
- The unattended pipeline (`docs/backlog/`, its workflow, runner and scripts), the memory and protected-path hooks,
  the Superpowers plugin and its `docs/superpowers/` folders are removed; their lasting test rules are in
  `AGENTS.md`.
- Superseded ADRs stay as history. Their links to removed folders (`docs/superpowers/`, `docs/backlog/`,
  `docs/agents/working-economically.md`) are not repaired.
- Paperclip is now a dependency of the process; the code and the product knowledge do not depend on it.

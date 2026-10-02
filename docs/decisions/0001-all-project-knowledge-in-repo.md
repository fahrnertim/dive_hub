---
title: "ADR 0001: All project knowledge lives in this repository"
summary: No local, account-specific or external-service memory; everything is committed here.
status: accepted
date: 2026-10-02
---

# ADR 0001: All project knowledge lives in this repository

## Status
Accepted – 2026-10-02

## Context
AI coding agents (e.g. Claude Code) offer per-user, per-machine memory
(`~/.claude/projects/*/memory/`, `~/.claude/CLAUDE.md`, `CLAUDE.local.md`) and
can write to account-bound services (Claude Docs, Google Drive, artifacts).
Knowledge stored there is invisible to other contributors, other machines and
other tools, and is lost when the account or machine changes.

## Decision
Every piece of project information – spec, decisions, references to other
projects, research, conventions – is stored as files in this repository and
committed.

Enforced by:
1. The rule in [AGENTS.md](../../AGENTS.md) (imported by [CLAUDE.md](../../CLAUDE.md)).
2. Claude Code auto-memory disabled in the committed `.claude/settings.json`.
3. A `PreToolUse` hook (`.claude/hooks/guard-memory.mjs`) that blocks writes
   to agent memory locations.

## Consequences
- Anyone cloning the repo (human or agent, any tool) has the full context.
- Agents must write knowledge into `docs/` and commit it instead of "remembering".
- External services may be used for presentation only if the source content is also committed here.
- The hook cannot police copy-paste into external services; that relies on the rule and on human review of tool calls.

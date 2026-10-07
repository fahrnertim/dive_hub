---
title: "ADR 0039: Working economically with LLM agents"
summary: One slice per session with a hand-over prompt, narrow reading, smaller models for research and search, compaction at 300,000 tokens, the skill overrides moved out of AGENTS.md.
status: accepted
date: 2026-10-07
---

# ADR 0039: Working economically with LLM agents

## Status
Accepted – 2026-10-07 (owner)

## Context
The [measurement of 20 sessions](../research/2026-10-07-token-usage.md) showed where the tokens went: 54 % of the
cost was re-reading the context on every request and 24 % writing it to the cache, 10 points of that after pauses
of more than an hour. No session was ever cleared; the median request carried 367,000 tokens. Most of the
conversation was file content read through the shell. Everything ran on the largest model. The always-loaded
instructions, the checks and the screenshots were small.

## Decision
1. **One slice per session.** A session ends with the slice's commit and a hand-over prompt; the next starts
   fresh (a new session or a cleared one). Also after a pause of more than an hour in a large session.
2. **Automatic compaction at 300,000 tokens** (`autoCompactWindow` in `.claude/settings.json`) as a backstop,
   to be raised if it compacts too often.
3. **Narrow reading and quiet output** as rules for every agent: search before reading, parts before whole
   files, long output filtered or written to a file.
4. **Models by kind of work.** Research and broad code search run in subagents on smaller models
   (`.claude/agents/researcher.md` on Sonnet, `code-search.md` on Haiku). Planning, design and review stay on the
   default model. A slice whose architecture is fully designed and whose work is straightforward implementation
   may run on Sonnet: the hand-over prompt says so and the owner starts the session on that model.
5. **AGENTS.md stays under 70 lines and 4,000 characters**, CLAUDE.md under 20 lines. The per-skill overrides
   move to [docs/skills.md](../skills.md#overrides); AGENTS.md says to read them before using a skill.
6. **The skill listing stays as it is.** Fourteen installed skills were never loaded in 20 sessions; instead of
   hiding them, AGENTS.md now says to load the installed skills that fit the work before starting in their area,
   and the hand-over prompt names them for the slice. Loading a skill costs its text for the rest of the session;
   that is accepted, since a skill that is never loaded shapes nothing.
7. **`scripts/token-report.mjs`** measures again from the local transcripts and prints aggregates only.
8. **Not saved on**: `pnpm check:full` before a commit, tests first, reading an ADR in full before changing what
   it decided, the review of screenshots when UI changed, reading the code around an edit, vetting skills.

The rules are in [docs/agents/working-economically.md](../agents/working-economically.md), tool-neutral, with a
short section in AGENTS.md. Not decided: shortening `docs/index.md` (expected saving under 0.5 %).

## Consequences
- A session no longer knows what the one before it knew. What matters must be in the repository or in the
  hand-over prompt; that is Rule #1 applied to sessions.
- A missed skill override is now possible, since the overrides are no longer in every context. Each override
  names something visible (a fixed opening line, oklch colours, `drizzle-kit push`), so a review catches it.
- Signals that quality dropped: a new session asks what a document answers or reopens a decision; edits that
  fail to apply or type errors right after an edit; more rounds until `pnpm check:full` is green; more review
  findings on slices built on Sonnet; sources in a research note that don't say what the note claims. If one of
  them shows, the rule behind it is loosened here, by amendment.
- To be checked after a week with the report: the median context per request (was 367,000 tokens), the number of
  cache rebuilds after pauses (was 18), the share of shell reads in the context (was 39 %), and whether
  compaction triggered.
- `autoCompactWindow` and the subagent definitions were taken from Claude Code's documentation (2.1.287) and
  not tried before this ADR; the first sessions show whether they act as described.

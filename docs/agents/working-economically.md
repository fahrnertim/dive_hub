---
title: Working economically
summary: Rules for LLM agents that keep a session's context small without lowering quality - sessions, hand-over prompt, reading, output, subagents, models.
status: living
date: 2026-10-07
---

# Working economically

For any coding agent on this project. Decided in [ADR 0039](../decisions/0039-working-economically.md), from the
[measurement](../research/2026-10-07-token-usage.md): an agent sends its whole conversation again with every
request, so what a session costs is mostly how long its context has grown, not what it writes.

## Sessions

- **One slice, one session.** A session ends with the slice's commit. Research and design get a session of their
  own; so does a review that is not part of the slice.
- **Start fresh** (a new session, or clearing the conversation: the same thing) when
  - the slice is committed,
  - the owner returns after more than an hour to a session that has already grown large,
  - the context has passed about 200,000 tokens and the work is at a natural break.
- Before a fresh start, **write a hand-over prompt** and give it to the owner. If the work is mid-slice, say so
  and commit nothing unfinished without asking.
- Don't switch the model in the middle of a session: the next request pays for the whole context again.

## The hand-over prompt

Short enough to read in a minute; it points to documents instead of repeating them.

1. **Goal**: the slice and what "done" means.
2. **Read first**: paths with sections (the ADR, the part of the spec, the research note's implementation prompt).
3. **Decided**: what is settled, each with its ADR, so it isn't reopened.
4. **State**: branch, last commit, uncommitted changes, which checks ran and their result.
5. **Open**: what is left, known failures, questions for the owner.
6. **Skills to load**: the [installed skills](../skills.md#installed) that fit the slice (they are only used when
   loaded, and loading the ones that fit is a rule in AGENTS.md, not a cost to avoid), each with a reminder to
   read its [override](../skills.md#overrides).
7. **Model**: "Sonnet" only when the architecture is fully designed and the slice is straightforward
   implementation; otherwise leave it out and the session runs on the default.
8. **Don't**: what is out of scope.

Anything in the prompt that is worth keeping longer than the next session belongs in `docs/` instead (Rule #1).

## Reading

- Search first (`grep`, the editor's search tool), then read the lines around the hit.
- Read a whole file only before changing it as a whole, or when it is short (under about 150 lines).
- `docs/index.md` and `docs/glossary.md`: search for the document or the term. Don't read them through.
- Before changing what an ADR decided, read that ADR in full. To learn what an ADR says about one point, search it.
- Before editing code, read the function or component being changed and its callers' use of it. Economy never
  means editing blind.
- Don't read the same file twice in a session without a reason (it changed, or the first read was partial).
- Stored tool output (a file the tool wrote because the result was too long) is searched, not read through.

## Tool output

- A command whose output can be long gets a filter or a limit (`| tail -n 40`, `| grep -E 'FAIL|error'`), or
  writes to a file in the scratchpad that is then searched.
- Test and check output: failures and the summary are enough. Our scripts are already quiet; keep them so.
- Web pages: ask for the facts needed, not the page.
- Screenshots: look at the ones the change touches (`REVIEW_AREAS`), each once.

## Checks

Unchanged, [ADR 0023](../decisions/0023-faster-checks.md): `pnpm check` while working, `pnpm check:full` before
proposing a commit, the review capture when UI changed. They were not a relevant cost.

## Subagents and models

| Work | Where | Model |
|---|---|---|
| Web research for a research note | subagent `researcher` | Sonnet |
| "Where is X, what uses Y": a search over many files whose answer is a list of places | subagent `code-search` | Haiku |
| Planning, design, ADRs, the data model | the session | default (Opus) |
| Implementation | the session | default; Sonnet when the hand-over prompt says so |
| Review of a diff or of screenshots | the session | default (Opus) |
| Running checks | the session | — |

- A subagent's task says what to return and how long (a summary with sources or paths, at most about 300 lines).
- No subagent for work that shares context with the implementation, for small lookups (one search does it), or
  for running checks.
- A research subagent's sources are checked like any others: the session opens the two or three that carry the
  conclusion before writing them into a note.
- In Claude Code the two subagents are defined in `.claude/agents/`. Other tools: use the tool's own cheaper
  model for the same kinds of work.

## Never saved on

- `pnpm check:full` before proposing a commit.
- Tests first.
- Reading an ADR in full before changing what it decided.
- The review of the screenshots when UI changed.
- Reading the code around an edit.
- Vetting a skill before proposing it (every bundled file).

## Measuring

`node scripts/token-report.mjs` prints where the tokens of this project's Claude Code sessions on this machine
went (aggregates only). Results worth keeping go into a dated research note, never the transcripts themselves.

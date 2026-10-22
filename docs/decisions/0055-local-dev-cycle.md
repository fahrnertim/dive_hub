---
title: "ADR 0055: A local, supervised development cycle"
summary: A feature goes through two sessions. /design on the default model asks question rounds and writes an agreed brief in docs/backlog/. /build, pinned to Sonnet, implements, checks and runs two fresh-context reviewers (architecture on Opus, brief on Sonnet), with at most 3 fix rounds, the stops of ADR 0054, an owner prompt for protected paths and a review log in the brief. Models are routed by session and subagent, never by a switch mid-session. The unattended path of ADR 0054 stays built and off.
status: proposed
date: 2026-10-23
---

# ADR 0055: A local, supervised development cycle

## Status
Proposed – 2026-10-23. Drafted by an agent; the owner accepts it (or doesn't).

## Context
The owner wants a feature cycle that runs locally in Claude Code on the subscription:
- the owner describes a feature in a sentence or two;
- the agent researches and asks clarifying questions;
- the design is agreed before code;
- a loop runs: implement, check, independent review, fix, until clean or a stop;
- a model is picked per phase without the owner choosing each time.

The [research note](../research/2026-10-23-dev-cycle-research.md) found three things:

1. **The building blocks are stable** in Claude Code: skills and subagents that pin a `model`, hooks that can allow, deny
   or ask, and subagents that can be resumed.
2. **Model routing is decided by the prompt cache.** Each model has its own cache, so a switch inside a session re-reads the whole context
   uncached, and `opusplan` does this on every plan toggle. A subagent on another model leaves the main cache alone.
3. **The evidence for process steps is thin.** Repair loops gain most in the first 3 to 4 rounds, and a reviewer asked to
   find gaps finds some even in sound work.

What exists already:
- the backlog's hand-over format ([ADR 0054](0054-unattended-implementation.md));
- `pnpm check` ([ADR 0023](0023-faster-checks.md));
- the edit hook and the module rules ([ADR 0053](0053-module-boundaries.md));
- the `architecture-review` subagent;
- the `STOP:` hand-back and the protected list (`PROTECTED` in `scripts/agent-lib.mjs`);
- the cost rules of [ADR 0039](0039-working-economically.md).

## Decision

### Two sessions per feature
| Phase | Where | Model | Ends with |
|---|---|---|---|
| 1. Request | the owner types `/design <a sentence or two>` in a fresh session | default (Opus 5.5) | — |
| 2. Research and questions | same session; `code-search` (Haiku) and `researcher` (Sonnet) for breadth | default; subagents as defined | question rounds answered |
| 3. Design agreement | same session | default | the brief and any drafts committed (docs only); the owner's explicit yes |
| 4. Build loop | the owner types `/build docs/backlog/NNNN-x.md` as the **first** message of a fresh session | Sonnet (the skill pins it) | a clean branch and a hand-over, or `STOP: <reason>` |
| 5. Merge | the owner | — | merged, or sent back |

The model follows the kind of work automatically:
- `/design` runs on the session default.
- `/build` pins `model: sonnet`. Its loop runs inside one turn, so only the small first request is a model switch.
- When a stop hands back and the owner answers, the session default (Opus) takes that judgement call. Running `/build` again goes back to Sonnet.
- Nothing switches models in the middle of a long context.

### Phase 2: question rounds
The agent:
- finds facts itself (code, ADRs, outside sources) and asks the owner only for decisions;
- asks the whole frontier of open decisions in one round, numbered, each with its recommended answer, worded so that "yes" accepts it (the method of mattpocock's `grilling`, proposed for installing);
- repeats until no branch of the design is left assumed.

Planning is skipped for a change whose diff fits in one sentence, as Anthropic's guidance says. Such a change is an ordinary supervised slice.

### Phase 3: what is recorded where
- **The brief** is a backlog task, `docs/backlog/NNNN-short-name.md`, in the hand-over format with one more section, `## Design`. It holds:
  - the modules touched and their interfaces and seams (codebase-design vocabulary);
  - data and API changes, and client duties;
  - the tests;
  - an end-to-end check of "done";
  - what is out of scope.
- **Other changes:**
  - behaviour goes into `docs/spec/`;
  - new terms go into `docs/glossary.md`;
  - a new API duty goes into `docs/spec/clients.md`;
  - a decision that is hard to reverse, surprising and a real trade-off becomes an **ADR draft** with `status: proposed`.
    The owner accepts it; the cycle never accepts an ADR.
- **Agreement:** on the owner's explicit yes the agent sets the brief to `status: ready` and commits the documents. A
  brief agreed this way can later run unattended under ADR 0054 without rewriting.

### Phase 4: the build loop
1. Read the brief and AGENTS.md. Create the branch `feature/NNNN-short-name` from `main`.
2. Implement with tests first. Run `pnpm check` until it is green.
3. **Review**: two read-only subagents run in parallel, each in a fresh context. Each gets the brief's path, the base commit and its checklist, and nothing of the session's reasoning.
   - `architecture-review` (`model: opus`): standards, meaning ADR 0053, the baselines, the ADRs the diff touches, AGENTS.md.
   - `brief-review` (new, `model: sonnet`): requirements that are missing, work nobody asked for, requirements implemented wrongly. It quotes the brief line for each.
   - Both report their axis separately and use the severities *blocker*, *should fix* and *consider*.
   - A finding without `path:line` and the rule, ADR or brief line it breaks doesn't count.
   - Reviewers flag only what affects correctness, an accepted decision or the brief. "No findings" is a valid answer.
4. **Fix rounds**:
   - Only *blocker* and *should fix* enter a round; *consider* goes to the log.
   - A round is the fix, `pnpm check`, then a **scoped re-review** of the fix diff only. The same reviewer is resumed with `SendMessage`. It answers ADDRESSED or NOT ADDRESSED per finding, plus any new breakage in the fix diff. Points outside the fix go to the log and don't extend the loop.
   - The implementer may **dispute** a finding with evidence. A disputed finding is not fixed and not dropped: it goes to the owner with both sides.
5. **Commit** on the branch when the loop is clean. Append the **review log** to the brief, then write the hand-over. The log holds, per round, the findings, what was done, the disputes and the tokens (`node scripts/token-report.mjs`).

### Stops (the build turn ends with `STOP: <reason>` as its last line)
1. **Three fix rounds** are done and findings are still open.
2. **A round closed no finding** (no progress).
3. **`pnpm check` failed three times** on the same problem (ADR 0054's cap).
4. **An ADR would have to change**, the brief is unclear or contradicts the code, or a choice is the owner's.

Before stopping, the agent commits what is sound and writes the review log, as ADR 0054's runner does.

### Protected paths: the owner is asked
The list is ADR 0054's `PROTECTED`. That covers migrations and `db/schema.ts`, auth, providers, `docs/decisions/**`, and
the harness and what decides "green".

**In `/build`:**
- A `PreToolUse` hook declared by the skill answers **ask** for an edit of a protected path, so the owner approves or refuses each one. It works the same way in auto mode.
- An edit the owner refuses becomes a stop.
- `docs/decisions/**` is never edited in `/build`. A needed ADR change is stop 4.

**In `/design`:** ADR drafts and spec changes are written with the owner present. The ADR stays `proposed` until the owner accepts it.

The unattended hook (`AGENT_UNATTENDED=1`, deny) is unchanged.

### Relation to ADR 0054
This ADR doesn't move the ladder and doesn't enable the unattended workflow (built, off).
- It is step 1, supervised slices, with the review loop of step 3 run under the owner's eyes.
- Its review logs are the evidence that step 2 and step 3 need before anyone moves up. Their criteria are "PRs that need few review rounds" and "review findings the owner mostly agrees with".
- Pinning `architecture-review` to Opus also changes the reviewer of an unattended run, which ADR 0054 left on `inherit`.
  That sentence of ADR 0054 is amended when this ADR is accepted.

### The first slice
Build:
- the two skills `/design` and `/build`;
- the `brief-review` subagent;
- the model pin on `architecture-review`;
- the `ask` hook in `/build`;
- `docs/agents/dev-cycle.md`;
- the `## Design` and `## Review log` sections in the backlog README;
- one line in AGENTS.md;
- `grilling`, installed if the owner approves.

**Done** when one small real feature has gone from `/design` to a merged branch with all of these true:
- at most 3 rounds;
- a filled review log;
- `token-report` shows the build turn on Sonnet and the reviewers on their models;
- the protected-path prompt fired in a test edit;
- the owner agrees with most findings.

The tokens per phase go into a dated research note.

**What waits:**
- an Opus orchestrator with Sonnet implementer subagents (when build sessions pass about 200,000 tokens);
- a token budget enforced by a hook;
- a Stop hook or `/goal` loop;
- rounds per brief in the drift report;
- dynamic workflows and agent teams (preview, experimental).

## Consequences
**Cost.**
- Each phase starts with a small context.
- Each subagent pays a cold start, a prefix of about 47,500 tokens. Subagents were 4.4 % of the measured cost.
- One build switches models once, at its first small request.
- Implementation, most of the requests, runs on Sonnet: half of Opus at list prices. The ratio on a plan is not published.

**The owner's work.** It moves to the question rounds, the brief and the merge. A vague brief now ends in a stop instead of a guess.

**Risks.**
- A design misread by Sonnet. The brief and the Opus architecture review answer it, and ADR 0039's quality signals watch for it. Among them: more findings on Sonnet slices.
- Reviewers inventing work. The scope rule, the evidence rule, the cap and the owner's reading of the log answer it.

**Untried at the time of writing.** Two documented behaviours are checked in the first slice:
- whether a skill's `model` holds for a whole agentic turn;
- how a skill's `hooks` are scoped.

If the model pin doesn't hold, `/design` ends by printing `claude --model sonnet "/build <brief>"` for the owner to paste.

**Considered:**
- `opusplan`: an uncached switch per toggle, and the design context is carried into the build.
- A single session in which the owner switches models: what we have today.
- Installing Superpowers, Spec Kit, OpenSpec or BMAD: a second documentation and process system beside ours.
- Agent teams and dynamic workflows: experimental or preview, several times the tokens.

## Owner's questions
1. **Install `grilling`** (mattpocock/skills, MIT, one 2 KB `SKILL.md`, no scripts, vetted 2026-10-23)? Or write its question-round rules into `/design` and install nothing?
2. **Pin `architecture-review` to Opus.** This also changes the unattended runner's reviewer, which amends one sentence of ADR 0054. Or keep `inherit` and pass `model: opus` per call from `/build`?
3. **Protected paths in `/build`.** *Ask* the owner per edit (proposed: a schema change needs a yes, not a new session)? Or stop and hand back as the unattended path does? Should the harness group (`.claude/`, `scripts/check*`, `package.json`, …) be asked too, or only the owner's four groups?
4. **`status: ready`.** May the agent set it on your explicit yes in `/design`, or do you set it by hand?
5. **Effort.** Keep the default (medium) everywhere, or raise `/design` and `architecture-review` to high? On the 5.5 models a change of effort keeps the cache.
6. **Branch and commit.** Should `/build` create `feature/NNNN-…` and commit there for you to merge (proposed)? Or leave the changes uncommitted for your review?

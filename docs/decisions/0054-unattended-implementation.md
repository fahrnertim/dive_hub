---
title: "ADR 0054: Unattended implementation (step 2 of the automation ladder)"
summary: An agent picks one ready task from docs/backlog/, builds it on a branch and opens a pull request that the owner reviews and merges; a GitHub Actions workflow runs it (not a cloud routine), protected paths and four stops are enforced in code, a drift report says when to step back down.
status: proposed
date: 2026-10-23
---

# ADR 0054: Unattended implementation (step 2 of the automation ladder)

## Status
Proposed – 2026-10-23. Drafted by an agent; the owner accepts it (or doesn't). Numbered 0054 because 0047 was
already taken by [push runs](0047-push-runs.md).

## Context
The [guardrails research](../research/2026-10-22-agent-guardrails.md) ends in a ladder: automate in stages, keep
design decisions and structural merges with the owner, move up only when the numbers allow it. Step 1 (supervised
slices) had one condition to move up, "guardrails slice merged, CI green", and it holds: CI runs `pnpm check:full`
([ADR 0023](0023-faster-checks.md)), module boundaries and complexity are enforced against baselines
([ADR 0053](0053-module-boundaries.md)), an edit hook lints each file, and the `architecture-review` subagent reviews
a diff in a fresh context.

The risks the research names for unattended work: speed gains fade while complexity debt stays, human review becomes
the bottleneck, cognitive debt (the owner stops understanding the system), and unattended loops multiply token
spend unless capped. This ADR answers each with a mechanism, not a promise.

## Decision

### The ladder
| Step | Runs automatically | Owner | Move up when |
|---|---|---|---|
| 1. Supervised slices | nothing unattended | watches each session | done |
| **2. Unattended implementation (this ADR)** | an agent builds a ready task on a branch and opens a PR | reviews and merges **every** PR | a few weeks of PRs that need few review rounds; drift metrics flat |
| 3. Agent review loop | implementer and reviewers iterate, at most 3 rounds, token budget per task | reviews what remains | review findings the owner mostly agrees with |
| 4. Auto-merge for low-risk classes | dependency bumps, docs-only, behaviour-neutral refactors | spot checks | revert rate stays low |

This ADR decides step 2 only. Steps 3 and 4 each need an ADR of their own; nothing here enables auto-merge or a
review loop.

### Step 2 in one line
**One task = one branch (`agent/<id>`) = one pull request**, opened by a workflow, reviewed and merged by the owner.

### The backlog
Tasks are files in [docs/backlog/](../backlog/README.md): the hand-over prompt of
[working-economically](../agents/working-economically.md#the-hand-over-prompt) plus frontmatter `status: draft |
ready | in-progress | done`, `risk: low | medium | high`, `budget_tokens`. Only `ready` tasks are picked, the first by
file name whose branch does not exist yet. The owner sets `ready`; the workflow sets `in-progress` when it starts
(first commit of the branch) and `done` in the last commit, so the merged PR leaves the task `done`.

### The trigger: a GitHub Actions workflow
Compared on 2026-10-23 (sources: Claude Code documentation on [headless mode](https://code.claude.com/docs/en/headless.md),
[GitHub Actions](https://code.claude.com/docs/en/github-actions.md) and [routines](https://code.claude.com/docs/en/routines.md)):

| | Workflow on dispatch or schedule (chosen) | Scheduled cloud task (routine) |
|---|---|---|
| The gate | the same `pnpm check:full` step as `check.yml`, with the same PostgreSQL service and Chromium | the agent issues shell commands in a VM; PostgreSQL is installed but not started, Playwright browsers are not in the image (whether their download host is allowed was not confirmed) |
| Token budget | enforced from the event stream by `scripts/agent-run.mjs`, in the unit of ADR 0039's report | only a cost cap exists, no per-task token count |
| Concurrency | `concurrency` group, one run, never cancelled half way | no such control; runs count against hourly limits |
| Secrets | repository secrets, reaching only the agent step | the creator's account and its connectors |
| Version | CLI pinned (`2.1.308`), no auto-update | managed by the service |
| Billing | an API key (`ANTHROPIC_API_KEY`) with its own spend limit | the subscription's usage |
| Starts on | dispatch (Actions tab) and a weekday cron, **off** until `AGENT_SCHEDULE_ENABLED=true` | schedule, API, or a PR label |

Reasons: the gate must be the identical command in the identical environment that CI runs, and a per-task token
budget needs the stream. The routine is the better fit for tasks that need no database or browser; if the backlog
turns into that kind of task, revisit. The label trigger asked about in the brief is not used: a label is set by
the same people who can press "Run workflow", and a dispatch needs no label bookkeeping.

The CLI is run directly (`claude -p`, `--agent unattended-runner`, `--permission-mode dontAsk` with an allow-list) and
not through `anthropics/claude-code-action`, because the wrapper has to see every event.

### Protected paths
An unattended run never changes:

1. **Owner's list:** `apps/server/drizzle/**` and `apps/server/src/db/schema.ts` (migrations, schema),
   `apps/server/src/auth/**`, `apps/server/src/providers/**` (SSI and every other provider),
   `docs/decisions/**` (an ADR is never written or changed unattended).
2. **The harness (proposed addition, for the owner to confirm):** `.github/**`, `.claude/**`, `.githooks/**`,
   `AGENTS.md`, `CLAUDE.md`, `eslint.config.mjs`, the two baselines, `.dependency-cruiser.cjs`, and
   `scripts/agent*`, `scripts/check*`, `scripts/drift*`. Also what decides what "green" means: every
   `package.json` (the `check` scripts), `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, every `tsconfig*.json`
   and the Vitest and Playwright configs; a task that needs a new dependency stops, too. Without these the agent
   could loosen the gate it must pass, which would make every other rule advisory.

A task that needs a protected path **stops and hands back**. One list, `PROTECTED` in `scripts/agent-lib.mjs`, feeds
four layers: the `PreToolUse` hook `.claude/hooks/guard-protected.mjs` (refuses the edit; only when
`AGENT_UNATTENDED=1`), the runner (ends the run when it sees such an edit in the stream), a diff check after the run
(`agent-task.mjs guard`, catches changes made through the shell; a rename counts as a delete and an add, so a moved
file still shows its protected old path) and the CI job `protected-paths.yml`, which fails a pull request labelled
`agent` or from a branch `agent/*` that changes one. Both checks run a copy of the guard that cannot be the agent's:
the workflow copies it before the agent starts, the CI job takes it from the **base** branch. What the agent left
uncommitted is committed before the guard looks, so it sees everything that will be pushed.

### Stops
The run ends, and the owner is asked, when:

1. **The token budget is spent.** `budget_tokens` from the task, default **3,000,000**. The unit is *weighted input
   tokens* with the weights of `scripts/token-report.mjs` (uncached input 1, cache write 1.25, cache read 0.05,
   output 5). A median request of 367,000 cached tokens (ADR 0039) costs about 18,000, so the default is on the
   order of 100 requests; a docs task sets 1,000,000. It is checked per request and can overrun by one. Hard
   ceilings behind it: 200 turns and a 120-minute job. The default is a first guess; adjust it with the first runs'
   `summary.json`.
2. **`pnpm check` failed three times.** Counted from the stream (any `pnpm … check` command that returned an error).
3. **A protected path was touched.** See above.
4. **An ADR would have to change**, the task is unclear or contradicts the code, or the agent is not progressing:
   the agent ends its last message with `STOP: <reason>`.

After the run, three more things count as a stop, because they decide that the owner must look before anything
else: the diff check finds a protected path, `pnpm check:full` on the final state is red, or the run ended
abnormally (the runner failed, the job timed out). The hand-back line must be the **last line** of the agent's last
message.

On a stop the workflow commits what is there, pushes the branch and opens a **draft PR labelled `agent` and
`needs-owner`** whose text starts with the reason and carries the agent's own notes. The job does not fail (except
when the runner itself broke); the branch makes the task ineligible until the owner closes the PR and deletes the
branch. Only a finished run with a clean guard and a green full check becomes a ready PR.

### The run and its pull request
`.claude/agents/unattended-runner.md` is the agent's instruction: read the task, follow AGENTS.md, implement,
`pnpm check`, run `architecture-review` on the diff (code changes), commit locally, write `.agent/pr-body.md` (task
link, what changed, checks run, review findings, open questions). It does not push, call `gh` or use the network.
The workflow then pushes, runs `pnpm check:full` on the final state, marks the task `done`, and opens the PR with
the agent's text plus what it measured itself (stop, weighted tokens, failed checks, `check:full`, protected paths).
A PR opened with the workflow token starts no workflow, so the run dispatches `check.yml` on the branch.

### Secrets and the agent's reach
One secret, `ANTHROPIC_API_KEY`, a repository secret that exists only in the environment of the agent step (and of
the scan below). **Inside that step the key is reachable** by the commands the agent runs (`pnpm`, the tests): the
CLI needs it, and its subprocesses inherit the environment (a way to scrub it was not verified). So the run is
treated as able to leak it: a **secret scan** of the branch's commits and the run's output follows the agent; if the
key is found, nothing is pushed or uploaded and the run fails. Use a key of its own in a workspace with a spend
limit: that limit, not the token budget, is what bounds a bug in the wrapper or a leak. The checkout keeps no
credentials; the push uses the job's `GITHUB_TOKEN` after the agent has ended, and only scripts copied before the
agent started run with it (GitHub also refuses a push that changes workflow files with that token). The agent's tools are an allow-list (`Read`, `Grep`,
`Glob`, `Edit`, `Write`, `Agent`, `Skill`, and `Bash` only for `pnpm`, `node scripts/`, and read or commit `git`
commands); everything else is denied without asking. The workflow input is passed through the environment, not
into the shell text, and task file names are limited to `[a-z0-9-]`. The agent runs repository code via `pnpm`, as
every CI run does, which is why the diff is still reviewed, and why the key has a limit.
Repository settings the owner must set once: *Actions → General → Allow GitHub Actions to create and approve pull
requests*, and a branch protection rule on `main` requiring `check` and `guard` (without it nothing forces the
checks to pass).

### Drift report and stepping back down
`node scripts/drift-report.mjs` counts import edges in cycles, lint suppressions (all rules), known dependency
violations, functions above the complexity limit with the top five, and reverts in the last 30 days; it compares
with the previous note and writes `docs/research/YYYY-MM-DD-drift-report.md`. Run it weekly while step 2 is on.

**Step back down** (to step 1: no schedule, tasks `draft`, `unattended.yml` untouched but not run) when any of these
shows: a drift number worse than at the start for two reports in a row; a revert of an agent PR; more than half of
the runs of a month stopped; PRs that need more than two review rounds; a protected-path change that reached a PR
(also a bug to fix before the next run); or the owner notices they no longer know a module they approved.
Switching off is: set `AGENT_SCHEDULE_ENABLED` to anything but `true`, or disable the workflow in the Actions tab.
**Move up** only by a new ADR.

## Consequences
- Every unattended change reaches `main` through the owner's review; the cost of a bad run is a closed PR and
  some tokens, bounded by the budget and the key's spend limit.
- The owner's review is the bottleneck on purpose. Tasks must be small, and writing one costs about what a
  hand-over prompt does; a vague task ends in a stop.
- The harness is protected, so changes to the gates, hooks, baselines, `AGENTS.md` and these scripts stay supervised
  work (step 1) for as long as this ADR stands.
- The token unit is an estimate from the event stream (output tokens in it can be placeholders, subagent tokens are
  counted when their events appear); the final summary corrects the total but cannot undo a stop that came early or
  late by a request.
- A run costs about as much as a supervised session plus a full check (about 10 minutes of CI time) and one
  cold start of the context (about 18,000 tokens before the task is read, measured 2026-10-23).
- Not decided: auto-merge (step 4), the agent review loop (step 3), cost per merged PR as a report column (needs the
  PR list; add when there are PRs), and an owner cadence for reading code (a habit, not a mechanism).
- Not tried at the time of writing: a full run on GitHub (it needs the secret and the merged workflow); the pieces
  are covered by tests (`scripts/agent-lib.test.mjs`) and one local probe of the CLI's event stream.

## Owner's questions
1. Are the two extra groups of protected paths wanted (the harness, and what decides "green": `package.json`,
   lockfile, `tsconfig`, test configs), or only the four of the brief? Every group beyond the four stops more tasks.
2. Is the default budget of 3,000,000 weighted tokens right to start with (about the size of a small supervised slice)?
3. Do you want the weekday schedule at all, or dispatch only until a few runs have shown how the PRs look?

---
title: Backlog for unattended runs
summary: One file per task an agent can pick up unattended - the hand-over prompt format plus a status, a risk and a token budget; only ready tasks are run; how to write one, what happens to it, how to park or retry it.
status: living
date: 2026-10-23
---

# Backlog for unattended runs

Tasks for the unattended implementation of [ADR 0054](../decisions/0054-unattended-implementation.md). A task is a
[hand-over prompt](../agents/working-economically.md#the-hand-over-prompt) in a file, so what a person would give a
fresh session is what the agent reads. Only tasks with `status: ready` are picked up.

## File

`NNNN-short-name.md` (four digits, lower-case words and hyphens; the file name is the task's id and its branch is
`agent/<id>`). Frontmatter, then the eight parts of the hand-over prompt:

```yaml
---
title: Short imperative title
summary: One line.
status: draft        # draft | ready | in-progress | done
risk: low            # low | medium | high - the owner's estimate of what a wrong result could break
budget_tokens: 2000000   # optional; weighted tokens, default 3,000,000 (ADR 0054)
date: YYYY-MM-DD
---
```

| Part | In a task |
|---|---|
| Goal | the change and what "done" means; checkable |
| Read first | paths with sections; the agent starts with nothing else |
| Decided | settled points, each with its ADR, so the agent does not reopen them |
| State | the base (always `main`), anything the agent should know about the code as it is |
| Open | what is left to the agent's judgement; anything else is a question for the owner |
| Skills to load | the [installed skills](../skills.md#installed) that fit, each with the reminder to read its override |
| Model | leave out; the runner uses the default |
| Don't | what is out of scope |

Make the task small enough for **one pull request the owner can review in a sitting**, and leave out anything that
needs a [protected path](../decisions/0054-unattended-implementation.md#protected-paths): such a task stops and
comes back as a draft.

## Status

| Status | Meaning | Set by |
|---|---|---|
| `draft` | being written, or parked | the owner |
| `ready` | may be picked up | the owner, deliberately |
| `in-progress` | a run has started; set on the run's branch | the workflow |
| `done` | the run finished, checks green, PR open; set on the run's branch, so it is `done` on `main` when the PR is merged | the workflow |

The task file on `main` keeps `ready` until its PR is merged. A run skips every task whose branch `agent/<id>` exists,
so a waiting or stopped run is never started twice.

## Running, parking, retrying

- Run: Actions → *unattended* → *Run workflow* (a task id is optional; empty takes the first `ready` task by file
  name). The weekday schedule is off until the repository variable `AGENT_SCHEDULE_ENABLED` is `true`.
- **Park** a task: set it to `draft` on `main`.
- **Retry** after a stop or a rejected PR: close the PR, delete the branch `agent/<id>`, fix the task text (usually
  what the PR said was missing), keep it `ready`.
- The runs' results are pull requests labelled `agent`; a stopped run is a draft labelled `needs-owner`.

`node scripts/agent-task.mjs validate` checks every header; it also runs in `pnpm check`'s script tests.

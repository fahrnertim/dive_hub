---
title: "ADR 0055: Feature work with Superpowers"
summary: Local feature work follows obra/superpowers, installed as the marketplace plugin and enabled in the project settings. The flow is brainstorming, a design doc, writing-plans, then subagent-driven development in a fresh session, with its TDD, per-task review, fix loop, final review and branch finish. Designs and plans live in docs/superpowers/, as the plugin ships it. Our gates, ADRs, spec, architecture-review and the owner's merge stay. Overrides cover frontmatter, ADR drafts, test rules, review checklists, finishing a branch and protected paths. Superpowers' TDD replaces mattpocock tdd. The unattended path of ADR 0054 stays built and off.
status: proposed
date: 2026-10-23
---

# ADR 0055: Feature work with Superpowers

## Status
Proposed – 2026-10-23. Drafted by an agent after the owner's choices of 2026-10-23 (below); the owner accepts it
(or doesn't). Nothing is installed yet: the install is the next slice.

## Context
The owner wants a local feature cycle in Claude Code on the subscription:
- a feature described in a sentence or two;
- research and clarifying questions;
- an agreed design before code;
- a loop of implement, check, independent review and fix;
- the model picked per task automatically.

The [research note](../research/2026-10-23-dev-cycle-research.md) compared six setups. It first recommended project-made
`/design` and `/build` skills (option C). Superpowers (option E) does the same with a more worked-out loop and is
maintained upstream. After seeing what it would change, the owner chose it on 2026-10-23:

- **Install form:** the marketplace plugin, not copied skills.
- **Docs:** Superpowers' own folders (`docs/superpowers/specs/`, `docs/superpowers/plans/`).
- **Tests first:** Superpowers' `test-driven-development` replaces our `tdd` (mattpocock).

Superpowers' source was read at commit `2ce8aa1` (2026-10-21) for this ADR. Not every bundled file is read yet; that
is the install slice's first step.

## Decision

### Install
- Superpowers (`obra/superpowers`, MIT) as the **plugin** `superpowers@claude-plugins-official`.
- It is enabled for this project in `.claude/settings.json`, so a fresh clone gets the same setup. The setting
  (`enabledPlugins`) is to be confirmed against the docs in the install slice.
- The installed version and commit are recorded in [docs/skills.md](../skills.md).
- This is an **exception** to the rule in docs/skills.md that skills are copied and pinned. An update is accepted only
  after its changed files are read, as any skill is vetted. If the plugin cannot be kept from updating itself, the
  owner reads the release notes on each update instead. Which of the two applies is found out in the install slice.

### The flow
| Step | Superpowers skill | Session | Output |
|---|---|---|---|
| 1. Feature in a sentence or two | `brainstorming` (starts itself) | design session, default model (Opus 5.5) | questions to the owner, one at a time |
| 2. Design agreed | `brainstorming` | same | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, committed; plus the documents below where they apply |
| 3. Plan | `writing-plans` | same | `docs/superpowers/plans/…`: 2–5 minute tasks with files, signatures, tests and checks |
| 4. Build loop | `subagent-driven-development` (or `executing-plans`), `test-driven-development`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion` | a **fresh** session, given the plan's path | a branch with one commit per task, each reviewed |
| 5. Finish | `finishing-a-development-branch` | same | the branch kept or pushed as a PR; the owner merges |

Steps 1 to 3 end the design session, which follows the one-slice-per-session rule of
[ADR 0039](0039-working-economically.md). The hand-over prompt for the build session is the plan's path and
"execute it with subagent-driven-development".

**Models.** Superpowers picks the model for each subagent it dispatches, and its rule is followed as shipped:
- the cheapest tier for transcription-like tasks;
- a standard tier for integration work;
- the most capable model for design and the final review;
- a mid tier at least for reviewers;
- a model one tier up for fix rounds 4 and 5.

Our `researcher` (Sonnet) and `code-search` (Haiku) stay. The main session runs on the default model. No model is
switched in the middle of a session, because a switch re-reads the whole context uncached (research note, section 1).

### What stays ours
- **Gates.** The edit hook, `pnpm check` (also as the pre-commit hook, so it runs on every task commit), `pnpm check:full`
  before a push, CI ([ADR 0023](0023-faster-checks.md), [ADR 0053](0053-module-boundaries.md)).
- **Architecture review.** The `architecture-review` subagent runs once before a branch is finished. It does not run
  before every task commit. This changes AGENTS.md's "before a code commit" to "before finishing a branch".
- **Records.**
  - Behaviour of the product goes into `docs/spec/`.
  - New terms go into `docs/glossary.md`.
  - A new API duty goes into `docs/spec/clients.md`.
  - A decision that is hard to reverse, surprising and a real trade-off becomes an **ADR draft** with `status: proposed`,
    linked from the design doc. The owner accepts every ADR.
- **The rest.** Rule #1, and the working-economically rules.
- **The owner's merge.** Nothing merges itself.

### Overrides (recorded in docs/skills.md; our rules win)
1. **Frontmatter.** Design docs and plans under `docs/superpowers/` get our frontmatter (`title`, `summary`, `status`,
   `date`) above Superpowers' own header. `docs/index.md` lists the two folders, not each file.
2. **Working files.** `.superpowers/` (briefs, reports and review diffs of a run) is gitignored. What is worth keeping
   from a run goes into the plan or the design doc.
3. **Tests first.** Superpowers' `test-driven-development` replaces mattpocock `tdd`. `codebase-design` stays, without
   its "used by tdd" note. Our test rules in [docs/development.md](../development.md) win over the skill's examples:
   tests against a real PostgreSQL, one `vi.fn`, no `vi.mock`, browser tests with an area tag.
4. **Review checklists.**
   - Task reviewers get, as the plan's "Global Constraints", the rules of ADR 0053 and the ADRs the plan touches.
   - The final whole-branch review is followed by `architecture-review`.
   - A finding counts only with `path:line` and the rule, ADR or plan line it breaks.
5. **Finishing a branch.** Only "keep the branch" or "push and open a PR" are offered. A local merge is never chosen.
6. **ADRs and stops.**
   - A finding parked "with a ruling" at the fix-loop cap goes into the finish summary, so the owner sees every ruling.
   - A task that would change an accepted ADR stops and hands back. This uses the `STOP: <reason>` convention of
     [ADR 0054](0054-unattended-implementation.md).
7. **Protected paths.**
   - The owner's four groups are migrations and `db/schema.ts`, auth, providers, and `docs/decisions/**`.
   - In an interactive session, an edit of one of them asks the owner. It is never silent, even in auto mode or by a
     subagent. This is a `PreToolUse` hook answering *ask*, next to the unattended hook that denies.

### Relation to ADR 0054 and the backlog
- The unattended path stays built and off.
- `docs/backlog/` keeps its format for unattended tasks. A Superpowers plan is not a backlog task. Joining the two needs
  an ADR of its own.
- The review rounds per task that Superpowers logs are the evidence the ladder's step 3 asks for ("review findings the
  owner mostly agrees with").

### The install slice (next session)
1. Read every file the plugin bundles at the version to be installed: `hooks/` (`session-start`, `run-hook.cmd`),
   `scripts/`, `index.js`, `package.json`, and every skill's scripts and prompts, among them brainstorming's Node server.
   Record the result in the decisions log of docs/skills.md.
2. Install the plugin and enable it in `.claude/settings.json`.
3. Write the overrides into docs/skills.md, gitignore `.superpowers/`, and remove `.claude/skills/tdd` with its
   `skills-lock.json` entry.
4. Add the interactive *ask* hook for protected paths, with tests in `scripts/agent-lib.test.mjs`.
5. Change AGENTS.md: point feature work to this ADR, and say "before finishing a branch" for the architecture review.
   AGENTS.md is at 3,993 of 4,000 characters, so something must be shortened first.
6. Update the model table in docs/agents/working-economically.md.

**Done** when the plugin is active in a fresh session, `/usage` shows its startup text, and the *ask* hook fires on a
test edit of `db/schema.ts`. Then one small real feature goes through all five steps to a branch you review. Its tokens
(`node scripts/token-report.mjs`), review rounds and the share of findings you agreed with go into a dated research note.

## Consequences
**What it gives.** A maintained loop with the most worked-out review handling of the options compared:
- a fresh implementer per task;
- two verdicts per task, on the spec and on code quality;
- fix rounds that resume the implementer;
- a stronger model from round 4;
- rulings at the cap.

Models are picked per dispatch without the owner.

**What it costs.**
- A second design record (`docs/superpowers/`) beside ADRs and research notes, kept consistent through override 1 and
  the ADR drafts.
- A startup text in every session from the plugin's hook.
- Many more fresh contexts: each subagent pays a prefix of about 47,500 tokens before it reads anything, and
  subagents were 4.4 % of the measured cost so far. The trial feature is compared with the median of earlier slices.
- `pnpm check` runs on every task commit.
- A plugin that updates itself would bring hook code nobody has read. The update rule above is the answer, and how it is
  enforced is found out in the install slice.

**Superpowers' choices that differ from the research note, accepted with the plugin:**
- **Round cap.** The cap is 5 fix rounds, not 3. The research found most of the gain in the first 3 to 4 rounds.
- **Planning for small changes.** `brainstorming` starts on most requests, including small ones; it has a branch for
  "quick, clear tasks".
- **Worktrees.** It prefers a git worktree per feature (see question 2).

**Considered:**
- Project-made skills (`/design`, `/build`; the research note's option C).
- Copied Superpowers skills without the plugin.
- Keeping the docs in our own formats.
- Keeping mattpocock `tdd`.

The owner chose otherwise on 2026-10-23.

## Owner's questions
1. **Round cap.** Keep Superpowers' 5 rounds, or override it to 3 as the ladder said?
2. **Worktrees.** A second checkout needs its own `pnpm install`, and the browser tests need their own ports and test
   database; neither is tried on Windows. Until a trial shows it works, should the branch stay in the main checkout?
3. **Protected-path prompt.** Only the four groups above, or also the harness (`.claude/`, `scripts/check*`,
   `package.json`, …) as in ADR 0054?
4. **`architecture-review`.** Keep `inherit`, or pin it to Opus so a session started on Sonnet still gets an Opus
   review? Pinning changes the reviewer of unattended runs too, which amends one sentence of ADR 0054.
5. **Plugin updates.** Read the changed files before each update (stricter, needs the update kept off), or read only the
   release notes?

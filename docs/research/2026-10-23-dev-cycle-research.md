---
title: A local, interactive development cycle
summary: What Claude Code offers (Oct 2026) for a supervised feature cycle on a subscription (clarify, agree a design, then implement, check, review and fix in a loop) and how to route models per phase without breaking the prompt cache. Compares six setups and the process frameworks (Superpowers, Spec Kit, OpenSpec, BMAD). Recommended project-made /design and /build skills (option C); the owner chose Superpowers as a plugin instead (option E), with its doc folders and its TDD, drafted as ADR 0055.
status: decided
date: 2026-10-23
---

# A local, interactive development cycle

**The question.** The owner wants a local cycle in Claude Code, on the subscription (no API spend):

1. The owner describes a feature in a sentence or two.
2. The agent researches and asks clarifying questions.
3. The spec and architecture are agreed before any code.
4. A loop runs: implement, check, independent review, fix. It ends when the work is clean or a stop hands it back.
5. The model is picked per phase automatically.

This note covers steps 1 to 3 of the [ladder](2026-10-22-agent-guardrails.md#automation-roadmap), run locally and
supervised. The unattended path of [ADR 0054](../decisions/0054-unattended-implementation.md) stays built and off.

**In short:**
- Everything the cycle needs is stable in Claude Code today: skills and subagents that each pin a model, hooks, plan mode, and resumable subagents.
- What decides the design is the prompt cache. Each model has its own cache, so switching models inside a session makes the next request uncached. A subagent on another model leaves the main cache alone.
- The cheap way to route models is therefore by **session and subagent**, never by switching mid-session.
  - A design session runs on the default model (Opus 5.5).
  - A build session's skill pins Sonnet.
  - Reviewers are subagents with their own model.
- The evidence for process steps is thin. Most of the gain from repair loops comes in the first 3 to 4 rounds.
- Anthropic's own guidance warns that a reviewer asked to find gaps will find some, even when the work is sound. The loop therefore needs a scope rule for findings, evidence on each finding, and a cap.
- The smallest working version reuses what we have: the backlog format, `pnpm check`, the edit hook, `architecture-review`, the `STOP:` convention and the protected list. It adds two skills, one reviewer and a guide.

**Owner's choice (2026-10-23, after this note):** Superpowers, option E below, rather than the recommended C. It is
installed as the marketplace plugin, with its own `docs/superpowers/` folders and its `test-driven-development` in place
of mattpocock `tdd`. The reasons: a maintained, more worked-out loop and updates from upstream. The overrides and the
install slice are in [ADR 0055](../decisions/0055-local-dev-cycle.md). The analysis below is unchanged.

Web research was done by the `researcher` subagent (Sonnet) on 2026-10-23 against the Claude Code docs, which cite
versions up to v2.1.305. The three claims the recommendation rests on were re-read in the source by the session:
[prompt caching](https://code.claude.com/docs/en/prompt-caching), [subagents](https://code.claude.com/docs/en/sub-agents)
and [best practices](https://code.claude.com/docs/en/best-practices). Marks: **seen** (in the source), **inferred**,
**not verified**.

## 1. What Claude Code offers (October 2026)

| Feature | What it gives the cycle | State |
|---|---|---|
| **Skills** (`.claude/skills/x/SKILL.md`; custom commands are merged into skills) | A phase as a `/command`. Frontmatter: `model`, `effort`, `allowed-tools`, `disable-model-invocation`, `context: fork` + `agent`, `hooks` | stable, seen ([skills](https://code.claude.com/docs/en/skills)) |
| **Subagents** (`.claude/agents/*.md`) | A fresh context per job. Frontmatter: `model` (`opus`, `sonnet`, `haiku`, `fable`, an id, `inherit`), `tools`, `permissionMode`, `effort`, `maxTurns`, `skills`, `hooks`, `isolation: worktree`, `omitClaudeMd` | stable, seen ([subagents](https://code.claude.com/docs/en/sub-agents)) |
| Model order for a subagent | per-call `model` → frontmatter → `CLAUDE_CODE_SUBAGENT_MODEL` → the main model | seen |
| Nesting | a subagent may spawn subagents, 3 layers by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` turns it off) | seen |
| Resuming | `SendMessage` to a finished subagent resumes it with its history; its first request can read the cache it warmed | seen |
| **Hooks** | 33 events, among them `PreToolUse` (allow, deny or ask), `PostToolUse`, `Stop`/`SubagentStop` (can block stopping: the "Ralph loop", capped at 8 consecutive blocks), `PreModelSwitch` | stable, seen ([hooks](https://code.claude.com/docs/en/hooks)) |
| `/goal` | a Stop hook judged by a small model each turn ("done, not done, impossible") | stable, seen ([goal](https://code.claude.com/docs/en/goal)) |
| **Plan mode** | read-only exploring and planning; cache-safe | stable, seen |
| `opusplan` | Opus in plan mode, Sonnet otherwise; **each toggle is a model switch** (uncached) | stable, seen |
| Effort | low to max per session, skill or subagent; on the 5.5 models changing it **keeps** the cache | stable, seen |
| `/code-review`, `/simplify`, `/security-review` | bundled review skills (correctness bugs; clean-ups; security) | stable, seen |
| `/code-review ultra` | cloud fleet of reviewers, each finding independently reproduced | research preview, billed after 3 free runs |
| Dynamic workflows (`.claude/workflows/`, JS: `agent()`, `parallel()`, `pipeline()`) | script-held loops and fan-out; the main context holds only the result | research preview; "can use meaningfully more tokens" |
| Agent teams | a lead and teammates with shared tasks | experimental, off by default; "about 7x more tokens" with teammates in plan mode ([costs](https://code.claude.com/docs/en/costs)) |
| Advisor tool | the main model consults a stronger model at decision points | experimental, API only |

**Cache and model routing, from the source (seen):**
- "Each model has its own cache. Switching models recomputes the entire request even when the content is identical."
  This includes `opusplan`'s toggles and automatic fallback.
- A skill whose frontmatter names another `model`: "that turn is also a model switch … The session model resumes on your next prompt."
- Subagents: "The parent's cache is unaffected." A subagent's first request doesn't read the parent's cache. It falls in
  the "everything else" bucket with a **5-minute TTL even on a subscription**; the main conversation gets one hour.
  `subagentPromptCacheTtl` or the agent's `experimental.cacheTtl` can raise it.
- Plan mode, skill loading, permission-mode changes and effort changes on the 5.5 models keep the cache.

**Subscription (seen, partly not verified):**
- Pro and Max have a 5-hour and a weekly limit, shared across models and across claude.ai and Claude Code, with some per-model caps.
- "The subagent's own requests still draw on your usage."
- `/usage` attributes usage to skills and subagents.
- No current official ratio of Opus to Sonnet usage was found. The API list prices of the 5.5 models are 2:1 (Opus $4/$20,
  Sonnet $2/$10 per million tokens). Whether plan usage follows price is not stated (not verified).
- `default` resolves to Opus 5.5 on Pro and Max.

**Our own numbers** (`node scripts/token-report.mjs`, 94 sessions to 2026-10-23):
- A session's first request carries about 47,500 tokens of fixed prefix. That is what a fresh session or subagent costs before it reads anything.
- Subagents were **4.4 %** of the weighted cost.
- The main conversation's cache reads were 48 % and its cache writes 29 %.
- 51 cache breaks rewrote 30 % of all cache writes, most of them after a pause of more than an hour.
- `architecture-review` ran 14 times.
- Fresh contexts are cheap here. Long, growing main contexts and model switches are what cost.

## 2. How other setups structure the loop, and the evidence

| Setup | Flow | Notes |
|---|---|---|
| **Anthropic best practices** (seen) | explore → plan → implement → commit. For larger features: "interview me … write a complete spec to SPEC.md", then **"start a fresh session to execute it"**. Writer/reviewer: "A fresh context improves code review since Claude won't be biased toward code it just wrote." | Skip planning "if you could describe the diff in one sentence" |
| **Superpowers** ([obra/superpowers](https://github.com/obra/superpowers), MIT, vetted below) | brainstorming → worktree → writing-plans (2–5 minute tasks with paths, code, checks) → subagent-driven development (fresh implementer per task, one reviewer giving a spec verdict and a quality verdict, a fix loop) → final whole-branch review | Fix loop: rounds 1–3 resume the implementer, rounds 4–5 use a stronger model, then each open finding is "parked with a ruling"; a scoped re-review of the fix diff only; a ledger line per round. Model rule: the cheapest tier for transcription-like tasks, a mid tier as the floor for reviewers, the strongest for design and the final review; "always specify the model explicitly" |
| **GitHub Spec Kit** | constitution → specify → plan → tasks → implement → converge | Python CLI; Thoughtworks rates spec-driven development *Assess* (guardrails note) |
| **OpenSpec** | propose (proposal, specs, design, tasks under `openspec/changes/`) → apply → archive into the main specs | Node CLI |
| **BMAD** | clarify → plan → build and verify → learn | v6 stable, v7 alpha |
| **Kiro** | requirements, design, tasks per spec | a separate product |
| **Anthropic harness post** ([long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)) | a feature list with a `passes` field, a progress file, git history | failure modes: one-shotting, declaring victory early, marking done without an end-to-end test |

All of them do the same four things:
- write intent down before code,
- split the work into checkable tasks,
- review in a fresh context,
- keep a written trail.

They differ in how much process text they load and where the trail lives. We already have the trail: ADRs, the spec,
research notes and the backlog's hand-over format (Rule #1).

**Evidence by part** (secondary or arXiv abstracts unless marked; there is no controlled study on frontier models for most):

| Part | Evidence | Reading |
|---|---|---|
| Spec or plan first | none measured; SpecBench says planning workflows are not covered by benchmarks (not verified) | Anthropic's rule of thumb holds: plan when the diff isn't one sentence |
| Tests first | TDAD (2 small open models): TDD *prompting alone* raised regressions; a test-impact tool cut them from 6.1 % to 1.8 % (not verified) | keep tests first as a rule ([ADR 0039](../decisions/0039-working-economically.md)); evidence on frontier models is missing |
| Fresh-context review | Anthropic recommends it (seen); no controlled result; one paper finds reviewer setups within noise of a baseline on LiveCodeBench (not verified) | worth one review per slice, not more |
| Multi-round repair | "Is Three the Magic Number?": the first 3–4 rounds carry most of the gain; Self-Refine on code can regress (not verified) | a cap of 3 rounds fits |
| Reviewer behaviour | "A reviewer prompted to find gaps will usually report some, even when the work is sound … Chasing every finding leads to over-engineering … flag only gaps that affect correctness or the stated requirements" (seen, best practices) | scope the reviewer; give it a way to say "no findings" |
| Multi-agent cost | about 4x chat tokens for agents, 15x for multi-agent (Anthropic research post, seen via search only); agent teams about 7x (costs page, seen) | few subagents with short returns; no teams |

## 3. Model routing

**Anthropic's guidance (seen):**
- "Sonnet handles most coding tasks well and costs less than Opus. Reserve Opus for complex architectural decisions or multi-step reasoning."
- `model: haiku` for simple subagents.
- Their example reviewer subagent uses `model: opus`.
- On the Sonnet 5.5 launch page, Opus 5.5 "remains clearly stronger at complex, open-ended work requiring sustained judgment".
- Vendor benchmarks show a small gap in agentic coding: Terminal-Bench 4.0 Sonnet 5.5 70.6 %, Opus 5.5 66.4 %; CursorBench 4.0 55.5 % and 57.8 %.
- No SWE-bench numbers were published for the 5.5 models.

**A rule for this project.** It extends ADR 0039 point 4: judgement on the strong model, transcription on the cheaper one.

| Work | Model | Why |
|---|---|---|
| Clarifying questions, design, ADR drafts | default (Opus 5.5) | open-ended judgement; the owner's time is the expensive part |
| Web research | Sonnet (`researcher`) | unchanged |
| Repository search | Haiku (`code-search`) | unchanged |
| Implementation, tests, fixes against an agreed brief | Sonnet | the design is fixed; Superpowers and Anthropic both put this on the mid tier |
| Architecture review of a slice | Opus | judgement against ADRs; one call per round |
| Brief compliance review, re-review of a fix diff | Sonnet | a checklist against a written brief; Superpowers' "mid tier floor for reviewers" |
| A hand-back decision with the owner | default (Opus) | judgement |

**Can it be automatic? Yes, without switching mid-session.**

| Mechanism | Automatic | Cache cost | Verdict |
|---|---|---|---|
| Subagent `model:` | yes | none to the main session; the subagent pays one cold start (prefix about 47,500 tokens) and has a 5-minute TTL | **use** for reviewers, research, search |
| Skill `model:` used as the **first** message of a fresh session | yes | one switch on a small context; the whole turn (the loop) runs on that model | **use** for `/build`, to be tried in the first slice |
| Skill `model:` in the middle of a long session | yes | the whole context is re-read uncached, twice (there and back) | avoid |
| `opusplan` | yes | an uncached switch on every plan toggle, and the design discussion rides along into implementation | avoid |
| Owner types `/model` or `--model` | no | as above | the fallback |
| Orchestrator on Opus with a Sonnet implementer subagent (Superpowers style) | yes | small main context, but each implementer is a cold start with a 5-minute TTL; the owner sees less | later, if `/build` sessions grow large |

**What it saves, and what it risks:**
- **Saves:** implementation is most of a slice's requests. At list prices Sonnet costs half of Opus. The usage ratio on a plan isn't published (not verified).
- **Risks:**
  - Sonnet misreads a design. The written brief and the Opus architecture review are the answer to that.
  - The skill `model` may not hold for a whole agentic turn as the docs describe. The first slice measures this with `token-report`, which lists models per request.
  - ADR 0039 lists the signals of a quality drop. More review findings on Sonnet slices is one of them.

## 4. The review loop

What makes a reviewer useful:
- the sources agree on fresh context;
- scope and evidence come from Anthropic's guidance and Superpowers;
- the cap comes from the repair studies.

1. **Fresh context, the diff, the criteria, nothing else.** The reviewer gets the brief's path, the base commit and its
   checklist, not the session's reasoning.
2. **Two axes, reported separately** (mattpocock `code-review`, Superpowers' two verdicts). *Standards* means
   `architecture-review`'s checklist: ADR 0053, the baselines, the ADRs the diff touches, AGENTS.md. *Brief* asks three
   things: is a requirement missing, is something there that wasn't asked for, is something implemented wrong.
   Separate axes keep one from masking the other. Two subagents also let each run on its own model.
3. **Scope and evidence.** A finding names `path:line` and the rule, ADR or brief line it breaks, or it doesn't count.
   Only *blocker* and *should fix* enter the loop. *Consider* goes to the log. "No findings" is a valid answer.
4. **The implementer may dispute a finding** with evidence. A disputed finding goes to the owner at the end, with
   both sides in the log. It is never silently dropped.
5. **A round** is: fix, `pnpm check`, then a **scoped re-review** of the fix diff only. That re-review gives each finding
   ADDRESSED or NOT ADDRESSED, plus new breakage in the fix diff. Points outside the fix go to the log and don't extend
   the loop. The re-review resumes the same reviewer with `SendMessage` while its cache is warm (5 minutes).
6. **Caps.**
   - At most **3 rounds**, then hand back.
   - Hand back early when a round closes no finding: no progress.
   - The `pnpm check` cap of ADR 0054 applies: 3 failures.
   - The round cap is the token cap that works interactively. Measured spend per brief goes into the log.
7. **Against rubber-stamping:**
   - the reviewer never sees the implementer's reasoning;
   - the owner reads the log at merge;
   - the drift report can count rounds per brief, the evidence the ladder's step 3 asks for ("review findings the owner mostly agrees with").

**Against ping-pong:** the cap, the no-progress rule and the scope rule.

## 5. The human in the loop, and what is recorded where

**Gates:**
1. **The question rounds.** The agent asks the whole frontier of open decisions at once, each question with its
   recommended answer, and finds facts itself (grilling's method, vetted below).
2. **Design agreement.** The owner reads the brief, and any ADR draft, and says yes. No code before that.
3. **Hand-backs.** Any stop ends the build turn with `STOP: <reason>` as its last line, the convention of ADR 0054.
4. **Merge.** The owner reviews the branch and merges it. Nothing merges itself.

The owner can interrupt at any time (Esc), as in any session.

**Where things are recorded** (Rule #1):

| What | Where |
|---|---|
| The feature's brief: goal, design (modules, interfaces and seams, data, API and client duties, tests, how "done" is verified), what is out of scope | `docs/backlog/NNNN-*.md`, the hand-over format plus a `## Design` section. The same file can later be run unattended (ADR 0054) |
| Review rounds, findings, rulings, disputed points, tokens | a `## Review log` section at the end of the brief |
| Behaviour of the product | `docs/spec/` |
| New domain terms | `docs/glossary.md` |
| Hard to reverse, surprising, a real trade-off | an ADR draft, `status: proposed`; the owner accepts it |
| New API duty | `docs/spec/clients.md` |

## 6. Options compared

| | A. Today: supervised slice, owner picks the model | B. `opusplan` in one session | **C. Design session, then build session with `/build` pinned to Sonnet; reviewers pinned (recommended)** | D. Opus orchestrator, Sonnet implementer subagents (Superpowers-like) | E. Install a framework (Superpowers plugin, Spec Kit, OpenSpec, BMAD) | F. Workflows or agent teams |
|---|---|---|---|---|---|---|
| Model per phase automatic | no | yes | yes | yes | depends | yes |
| Cache | good | an uncached switch per toggle; the design context is carried into the build | one small switch at the start of the build | small main context; cold start per implementer | depends | preview or experimental; 7x for teams |
| Design agreed before code | by habit | plan approval | gate: brief written and agreed | gate | gate | depends |
| Independent review | `architecture-review` once | none built in | two reviewers, loop of at most 3 | per task and final | per task | adversarial, costly |
| Owner sees the work | fully | fully | fully (one session runs the loop) | through summaries | depends | little |
| New moving parts | none | none | 2 skills, 1 subagent, a guide | as C plus an implementer protocol | a foreign process, its hooks, its file layout (`openspec/`, `specs/`) beside ours | scripts or a flag |
| Fit with our docs | full | full | full (backlog brief, ADRs, spec) | full | overlaps ADRs, backlog and spec | n/a |

**Recommendation of this note: C** (the owner chose E, see the top).
- It meets all five wishes.
- It keeps every context small and switches the model only where the context is small.
- It reuses the backlog format, so a brief agreed locally can later run unattended.
- It needs no foreign process.

D is the next step if build sessions grow past about 200,000 tokens. E is rejected: the frameworks' value (intent before code, a fresh reviewer, a trail) is what C gives, and each brings a second documentation system. F waits until workflows and teams leave preview.

## 7. Skills searched and vetted

`npx skills find` on 2026-10-23 for "code review loop", "spec driven development", "brainstorming design",
"subagent driven development" and "model routing". The candidates were cloned and read; the files are listed for each.

| Skill | Source, licence, commit | Files | Verdict |
|---|---|---|---|
| **grilling** | mattpocock/skills, MIT, `5beb35b` (2026-10-19) | `SKILL.md` (2 KB), `agents/openai.yaml` (UI name); no scripts, no network | **propose installing.** Question rounds over a design tree, every question with a recommended answer, facts found by a subagent, done when nothing is left assumed. It fits phase 2 and our `code-search` |
| grill-with-docs | mattpocock/skills | `SKILL.md`: calls `grilling` and `domain-modeling` | not needed; the `/design` skill does the same |
| code-review (mattpocock) | mattpocock/skills, MIT | `SKILL.md` (7 KB) | don't install (it expects his issue-tracker setup); borrow the two axes and the "spec" checklist |
| brainstorming, writing-plans, subagent-driven-development, requesting-code-review, receiving-code-review | obra/superpowers, MIT, `2ce8aa1` (2026-10-21) | brainstorming bundles a Node "visual companion" server (`scripts/server.cjs`, 26 KB, plus shell scripts); SDD bundles bash scripts (`sdd-workspace`, `review-package`, `task-brief`) and 9–20 KB prompts; as a plugin it adds a `SessionStart` hook that injects `using-superpowers` | don't install; borrow the fix-loop rules (scoped re-review, ledger, rulings at the cap, explicit models). Too much process text per dispatch, and a second planning format |
| spec-driven-development, interview-me | addyosmani/agent-skills, MIT, `aeac41d` | one `SKILL.md` each, 13–15 KB | don't install; its spec template (objective, commands, structure, boundaries, success criteria) overlaps our brief and ADRs |

## 7a. Considered and rejected for now

- Agent teams (experimental, 7x).
- Dynamic workflows (preview).
- `/code-review ultra` (billed after 3 runs).
- Advisor (API only).
- A Stop hook or `/goal` that forces the loop to continue. The skill and the round cap are enough while the owner watches.
- A per-brief token budget enforced by a hook. Measure first.

## 8. The smallest version that works

Built from what exists: the backlog format, `pnpm check`, the edit hook, `architecture-review`, `STOP:`, and `PROTECTED`
in `scripts/agent-lib.mjs`.

1. **`/design`** (skill, user-invoked, no model pin: it runs on the session default):
   - read what the feature touches, with `code-search` and `researcher` for breadth;
   - ask question rounds (grilling);
   - write the brief with its `## Design` section, plus spec, glossary and ADR drafts where they apply;
   - ask for agreement and commit the docs.
   - The last line names the command for the build session.
2. **`/build <brief>`** (skill, user-invoked, `model: sonnet`), as the first message of a fresh session. It runs
   implement → `pnpm check` → the two reviewers in parallel → fix rounds (at most 3) → commit on a branch → review log →
   hand-over. A `PreToolUse` hook in the skill **asks** the owner before any edit of a protected path. The owner is
   present, so a schema change needs a yes, not a hand-back.
3. **`brief-review`** (subagent, read-only, `model: sonnet`): the brief axis.
4. **`architecture-review`** pinned to `model: opus`, so a Sonnet build still gets an Opus review. This changes what ADR 0054 says about the unattended runner's reviewer; the owner decides.
5. **`docs/agents/dev-cycle.md`**: the cycle for people and agents. The backlog README gains the two sections. AGENTS.md gets one line pointing to it.

**What waits:**
- an implementer subagent (option D);
- a token budget hook;
- a Stop-hook loop;
- rounds per brief in the drift report (after a few cycles);
- workflows and teams.

## What could not be found out

- An official ratio of Opus to Sonnet usage on Pro or Max.
- SWE-bench numbers for the 5.5 models.
- Controlled studies of plan-first, fresh-context review, reviewer false-positive rates, and ping-pong on frontier models.
- Whether a skill's `model` really holds for every request of a long agentic turn, and how a skill's `hooks` are scoped.
  Both are documented but untried here; the first slice checks them.

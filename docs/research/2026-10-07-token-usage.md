---
title: Token usage of our Claude Code sessions
summary: Where the tokens of 20 sessions went (measured from the local transcripts), what Claude Code's documentation says about cost and context, and a ranked proposal of rules. Decided in ADR 0039.
status: decided
date: 2026-10-07
---

# Token usage of our Claude Code sessions

Question: how do we cut the tokens our Claude Code sessions use on this project without lowering code or
engineering quality? This note measures first, then records what the documentation says, then proposes.
Decided in [ADR 0039](../decisions/0039-working-economically.md); the owner's answers are under [Decisions](#open-decisions).

Every claim is marked **[measured]** (from our transcripts), **[doc]** (seen in documentation on 2026-10-07),
**[calculated]** (arithmetic on measured numbers and list prices), **[estimate]** or **[unverified]**.

## How it was measured

- Source: the session transcripts Claude Code keeps locally for this project (one JSONL file per session,
  subagents in their own files). Every API response in them carries its token usage, model and effort.
- Covered: all 20 sessions from 2026-10-02 to 2026-10-07 (3,894 requests of the main conversation, 946 of
  subagents). The session that wrote this note is left out.
- Versions: transcripts written by Claude Code 2.1.287 (VS Code extension); the installed CLI reports 2.1.285.
- Token totals are exact (the API's own counts). What the context was *made of* is not reported by the API, so it
  is measured in characters of each item, weighted by the number of later requests that carried the item. A
  least-squares fit over 3,874 requests gives about 0.42 tokens per character and about 1,500 tokens per screenshot.
- Cost shares weight tokens by Opus 5.5's list prices ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)):
  input 1, cache write (1 hour) 2, cache write (5 minutes) 1.25, cache read 0.05, output 5. **[doc]**
- Only aggregates are recorded here: no prompts, no file contents, no account data.
- The script is `scripts/token-report.mjs`.

## Where the tokens went

### By kind of token [measured]

| | Tokens | Share of cost |
|---|---:|---:|
| Cache reads, main conversation (the context re-read on every request) | 1,515.7 M | 53.9 % |
| Cache writes, main conversation (new content, and rebuilding after a pause) | 17.0 M | 24.2 % |
| Output without thinking (text, tool calls, file edits) | 3.34 M | 11.9 % |
| Thinking | 1.16 M | 4.1 % |
| Subagents, everything | 82.3 M | 5.9 % |
| Uncached input | 0.01 M | 0.0 % |

At list price this is about 560 USD for the five days **[calculated]**. Cache writes used the 1-hour lifetime, which
Claude Code only requests by default on a subscription within plan usage **[doc]**, so the real effect is on plan limits.
How the plan counts each kind of token is **not documented and not measured**.

### Why cache reads dominate [measured]

- No session was ever compacted or cleared. The context only grew.
- Context per request: median 367,000 tokens, 90th percentile 687,000, maximum 940,000 (the 1 M window).
- 67 % of all input tokens were sent in requests with more than 400,000 tokens of context; 93 % in requests above 200,000.
- Sessions held 1 to 11 commits (67 in all); 55 requests per commit on average. Seven sessions ran over 11 hours of wall time.
- After a pause of more than an hour the cache has expired and the whole context is written again at the write
  price. This happened 18 times and rewrote 7.3 M tokens: 43 % of all cache writes, **10.3 % of the total cost**.

### What the context was made of [measured]

The fixed start of every request (system prompt, tool definitions, instructions, skill listing) was 42,000 to 53,000
tokens. Sent with all 3,894 requests it is 12.3 % of the input tokens and 6.7 % of the cost. Of it we control:

| Part | Size | Note |
|---|---:|---|
| AGENTS.md + CLAUDE.md | about 8,600 characters, about 3,600 tokens | about 0.5 % of the cost |
| Skill listing (36 project skills plus built-in and user-level ones) | up to 26,400 characters | about 1 to 1.5 % of the cost |
| Agent types, MCP server instructions, deferred tool names | about 7,700 characters | from user-level plugins and connectors, outside this repository |

The rest of the prefix (system prompt and tool definitions) is not in the transcripts; `/context` shows it in a session.

The conversation part, by what it consisted of (characters × requests that carried them):

| Item | Share |
|---|---:|
| Tool output | 54.9 % |
| — of which shell commands that read or search files (`sed -n`, `cat`, `grep`, `head`) | 39.4 % |
| — of which the Read tool | 9.7 % |
| — of which tests, type checks, browser tests, checks, review capture, git | about 4 % |
| File edits written by the model (they stay in the context) | 17.5 % |
| Other tool calls written by the model (mostly shell commands) | 11.7 % |
| Reminders added by Claude Code (skill listing 3.4 %, token counters 1.8 %, …) | 10.3 % |
| The model's text | 2.9 % |
| The owner's prompts | 2.3 % |

Details behind the largest item:

- 3,028 shell calls against 354 Read and 20 Grep calls: files are mostly read through the shell.
- `cat` of whole files: 141 calls, 13,000 characters on average. `sed -n` ranges: 541 calls, 4,200 on average.
  `grep`: 728 calls, 1,500 on average.
- 86 tool results were longer than 20,000 characters; 18 were so long that Claude Code stored them in a file, and
  those files were then read back, often in full.
- Screenshots: 201 images read, about 1,500 tokens each, about 3 % of the context's growth.

### The suspicions, checked

| Suspicion | Finding |
|---|---|
| The largest model for everything | **Confirmed.** Every main request ran on Opus 5.5 at effort medium (its default). 935 of 946 subagent requests too; 26 of 27 subagents were general-purpose ones inheriting the model. |
| Every session reads a lot first | **Partly.** `docs/index.md` was read in full 6 times and searched 42 times, the glossary in full 6 times, whole ADRs 15 times. Together under 2 % of the carried context. Whole source files weigh more (see above). |
| AGENTS.md and the skill listing are loaded every turn | **Confirmed, but small:** about 2 % of the cost together. They are cached, and cache reads are cheap per token. |
| Long tool outputs go into the context | **Confirmed for file reads, not for tests.** Test, type-check and check runs average 550 to 800 characters: already quiet. Reading files through the shell is the large item. |
| `pnpm check:full` and the review capture run several times per slice | **Not confirmed as a cost.** 52 `check:full` runs and 73 review captures for 67 commits; their output is about 0.3 % of the carried context. |
| Sessions run long | **Confirmed, and it is the main cause.** |

One observation outside the question: counted by the literal command, 47 of 67 commits had no `pnpm check:full`
between them and the commit before. Some predate [ADR 0023](../decisions/0023-faster-checks.md) and some are
documentation only; this was not looked at further.

### Skills, by use [measured]

Over all 20 sessions the Skill tool was called 10 times: domain-modeling 2, tdd 2, find-skills 2, pnpm, codebase-design,
frontend-design, ux-selection-controls 1 each. Skill files were also opened through the shell or Read (this includes
reading them for vetting): mcp-builder, postgres-drizzle, suggest-lucide-icons 4 to 6 times; mobile-native and the
better-auth skills 3; fastify-best-practices, emil-design-eng, better-layout 2; accessibility, playwright-cli,
email-and-password-best-practices, review-animations, ux-search, better-colors, better-typography 1.

Never loaded in any form: vitest, vite, postgresql-table-design, api-and-interface-design, security-and-hardening,
tanstack-query-best-practices, vercel-react-best-practices, find-animation-opportunities, ux-tables,
ux-inputs-and-forms, ux-empty-states, ux-menus, ux-loaders-and-progress, ux-notifications-and-toasts.
A skill that was never loaded has not shaped any code; only its one-line description was in the context.

### What could not be measured

- The split of the fixed prefix into system prompt and tool definitions (not in the transcripts).
- How the subscription counts cache reads, writes and output against its limits.
- What any of the proposed changes does to quality. That needs a trial with the signals named below.
- Whether earlier thinking is re-sent with later requests (thinking text is not kept in the transcripts).
- Shares by content are character-based, not token-based.

## What the documentation says

All pages read on 2026-10-07; the settings were not tried out.

**Cost and context** ([costs](https://code.claude.com/docs/en/costs), [prompt caching](https://code.claude.com/docs/en/prompt-caching)) **[doc]**
- "Claude Code sends your full conversation with every request"; a one-line question in an old session draws usage
  for the whole conversation. Clearing between unrelated tasks and matching the model to the job are named as the
  two habits with the highest effect.
- `/clear` costs nothing. `/compact` is itself a large request, cheap while the cache is warm, most expensive after a pause.
- The cache matches the start of the request exactly. It is invalidated by: switching the model (also `opusplan`
  on every plan-mode toggle, and a skill whose frontmatter names another model), changed tool definitions,
  compaction, many accumulated images, an upgrade. Changing effort keeps the cache on Opus 5.5. Editing
  CLAUDE.md mid-session keeps the cache and does not apply until the next session.
- Cache lifetime: one hour for the main conversation on a subscription within plan usage, five minutes for
  subagents and on usage credits or an API key. `promptCacheTtl` and `subagentPromptCacheTtl` choose it.
- `/usage` shows the session's cache hit rate and misses, and on a subscription the shares of skills, subagents
  and "long context".

**Models, effort, context window** ([model configuration](https://code.claude.com/docs/en/model-config)) **[doc]**
- Opus 5.5 is the default model and runs with a 1 M window; automatic compaction starts at about 967,000 tokens.
  `autoCompactWindow` (100,000 to 1,000,000, also per model under `modelSettings`) lowers that;
  `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` makes it a 200,000 window.
- Opus 5.5 and Sonnet 5.5 default to effort medium; thinking cannot be turned off on them.
- `model` and `effortLevel` can be set in a settings file; `CLAUDE_CODE_SUBAGENT_MODEL` sets the model of
  subagents that have none.
- Prices per million tokens: Opus 5.5 4 USD input, 8 USD 1-hour cache write, 0.20 USD cache read, 20 USD output;
  Sonnet 5.5 2, 4, 0.20, 10; Haiku 4.5 1, 2, 0.10, 5. No surcharge above 200,000 tokens.

**Instruction files** ([memory](https://code.claude.com/docs/en/memory)) **[doc]**
- CLAUDE.md is loaded in full at session start, as a user message. "Target under 200 lines per CLAUDE.md file.
  Longer files consume more context and reduce adherence."
- `@` imports "don't reduce its context cost, because imported files also load at launch." Our `@AGENTS.md` is such an import.
- Rules in `.claude/rules/` with a `paths:` frontmatter load only when Claude works with matching files (Claude Code only).
- Since 2.1.277 Claude Code reads AGENTS.md by itself when there is no CLAUDE.md; ours has one, and the import is fine.
- `/doctor prompt-audit` audits CLAUDE.md, AGENTS.md, rules, skills and subagents.

**Skills** ([skills](https://code.claude.com/docs/en/skills), [settings](https://code.claude.com/docs/en/settings-reference)) **[doc]**
- Only name and description are in the context until a skill is invoked; then its SKILL.md stays for the rest of the session.
- `skillOverrides` in a settings file sets a skill to `off`, `name-only` or `user-invocable-only` without editing
  it; `skillListingMaxDescChars` caps descriptions. Seen in the settings reference's summary; the exact behaviour
  is **[unverified]** until tried.

**Subagents** ([subagents](https://code.claude.com/docs/en/sub-agents)) **[doc]**
- A subagent has its own context; only its final message returns. It loads CLAUDE.md and AGENTS.md (the built-in
  Explore and Plan agents skip them).
- `.claude/agents/*.md` set `model` (`haiku`, `sonnet`, `opus`, `inherit`), `effort`, `tools`, `skills`, `maxTurns`.
  Order: the call's own model, the definition, `CLAUDE_CODE_SUBAGENT_MODEL`, the main model.
- Use the main conversation when phases share context or the change is small; a subagent when the work is
  self-contained and its output is verbose.

**Tool output** ([environment variables](https://code.claude.com/docs/en/env-vars)) **[doc]**
- `BASH_MAX_OUTPUT_LENGTH`: 30,000 characters by default. A `PreToolUse` hook can rewrite a command to filter its output.

**Anthropic on context** ([Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) **[doc]**
- Aim for "the smallest set of high-signal tokens"; accuracy drops as the context grows ("context rot").
- Load little up front and fetch the rest when needed (search, then read); keep notes outside the context;
  let subagents return a summary of 1,000 to 2,000 tokens.
- Instructions: specific enough to guide, not a list of brittle special cases; structured under headings.

**Other tools** ([agents.md](https://agents.md/)) **[doc]**
- AGENTS.md is plain Markdown at the repository root, read by Codex, Cursor, Copilot, Gemini CLI, Jules, Zed,
  Aider and others; the nearest file wins. The convention defines no imports and no size limit, so a tool-neutral
  rule must be written out in AGENTS.md or linked from it as a normal Markdown link.

**Experience reports with numbers**: only Anthropic's own, from the costs page: about 13 USD per developer and
active day on average, under 30 USD for 90 % of users **[doc, vendor's figure]**. Ours was about 110 USD per day **[calculated]**.

## Skills search

`npx skills find` on 2026-10-07 for "token usage", "context management", "claude code cost", "prompt caching",
"context engineering", "agents md". Only the registry pages were read, not the skill files. Outcome in
[skills.md](../skills.md): nothing installed; mattpocock/skills `writing-for-agents` is a candidate for the
rewrite of AGENTS.md if the owner wants it.

## Proposal

Ranked by saving against risk. Savings are shares of the total cost above.

| # | Change | Saves | Risk for quality | How we would notice |
|---|---|---|---|---|
| 1 | **One slice per session.** A session ends with the slice's commit; the next starts fresh from a hand-over prompt. Research and design get their own session. | about 25 to 30 % **[estimate]**: capping every request at 200,000 tokens would have removed 811 M cache-read tokens | The new session lacks what the old one knew. Small here, because Rule #1 already puts decisions in the repository | The new session asks what a document answers, or redoes a decision; `check:full` fails on the first run more often |
| 2 | **No long session after a pause.** After more than an hour away from a session above about 150,000 tokens, start fresh instead of continuing. A lower `autoCompactWindow` as a backstop. | up to 10.3 % **[measured]** (18 rebuilds) | Compaction can drop a detail mid-slice; a fresh start cannot (it reads the repository) | A slice that contradicts something agreed earlier in the same session |
| 3 | **Read narrowly.** Search first, then read the lines needed; whole files only when they are about to be changed as a whole; no `cat` of documents; long output goes to a file and is searched. A lower `BASH_MAX_OUTPUT_LENGTH` as a backstop. | about 5 to 10 % **[estimate]** (whole-file `cat` alone is 9 % of everything added to the context) | An edit made without having seen the surrounding code | Edits that fail to apply, type errors after an edit, a review finding "duplicates existing helper" |
| 4 | **Sonnet 5.5 for subagents that search, read and research the web**; Haiku for pure file search. Through `.claude/agents/` or `CLAUDE_CODE_SUBAGENT_MODEL`. | 1.6 % as used today **[calculated]**; more as research moves out of the main context | A weaker research summary | Sources missing or wrong in a research note; the owner's spot check of two sources per note |
| 5 | **Skill listing by use**: the never-loaded skills become `name-only`; the Skills section of AGENTS.md moves to `docs/skills.md` with one line left behind. | about 1 to 1.5 % **[estimate]**, and a shorter AGENTS.md is followed better **[doc]** | An override is missed when the skill is used | A skill's fixed opening line, oklch colours, `drizzle-kit push` in a diff: each override names its own symptom |
| 6 | **Sonnet 5.5 for implementing a slice that has a written prompt**, Opus for research, design, review and anything without a prompt. | up to 20 % **[calculated]** if all main work moved (writes and output halve, cache reads cost the same) | The largest of all: weaker design judgement inside the slice | More review findings per slice, more rounds until `check:full` is green. Try on two slices and compare |
| 7 | **A shorter `docs/index.md`**: one line of at most about 150 characters per document; status and history stay in the documents. | under 0.5 % | None | — |

Not proposed, because the measurement does not support it: lowering effort (thinking is 4.1 %, and medium is
already the default), fewer checks, fewer screenshots, filtering test output with a hook.

### Model and effort per kind of work

| Work | Model | Effort | Set by |
|---|---|---|---|
| Research (web), reading and searching code for a question | Sonnet 5.5 subagent | medium | `.claude/agents/researcher.md`, `explorer.md` (Haiku) |
| Planning and design, ADRs, data model | Opus 5.5 | medium; high when the owner asks | session default |
| Implementation of a slice | Opus 5.5, or Sonnet 5.5 after decision 3 | medium | session default or `/model` at the start, never mid-session |
| Review of a diff, review of screenshots | Opus 5.5 | medium | session default |
| Running checks | the session's model | — | no subagent: the output is already short |

### Always loaded, and on demand

- AGENTS.md keeps: Rule #1, the table of folders, conventions, the checks rule, and a new short section "Working
  economically" (about ten lines). Budget: AGENTS.md at most 60 lines and 4,000 characters (today 100 and 8,000);
  CLAUDE.md at most 15 lines.
- Moves to `docs/skills.md`: the per-skill overrides, under one heading per skill. AGENTS.md keeps: "Before using
  a skill, read its override in docs/skills.md".
- New `docs/agents/working-economically.md` holds the full rules (reading, output, sessions, hand-over,
  subagents), linked from AGENTS.md, so other tools get them too.
- Claude-specific: `.claude/settings.json` (subagent model, compaction window, skill overrides, output limit),
  `.claude/agents/`.

### Rules, in short

- **Reading**: search before reading; read ranges; read a whole file only before changing it as a whole.
  `docs/index.md` and the glossary are searched, not read. An ADR is read in full before changing what it decided.
- **Output**: commands that can be long get a filter or a tail; long output goes to a file in the scratchpad.
- **Checks**: unchanged ([ADR 0023](../decisions/0023-faster-checks.md)).
- **Sessions**: one slice, one session. Start fresh after the commit, after a pause of more than an hour, and
  when the context passes about 200,000 tokens at a natural break.
- **Hand-over prompt**: the goal and the slice; the documents to read (paths, with sections); what is decided
  and by which ADR; the state of the work tree and of the checks; what is open; what not to do.
- **Subagents**: for web research and for broad searches whose result is a list of places; not for work that
  shares context with the implementation, and not for running checks.

### What must not be saved on

`pnpm check:full` before proposing a commit; tests first; reading an ADR in full before changing what it decided;
the review of screenshots when UI changed; reading the code around an edit; the vetting of skills. None of these
showed up as a relevant cost.

## Open decisions

Answered by the owner on 2026-10-07: 1 yes (a new session or a cleared one); 2 300,000 to start with; 3 yes, for
slices whose architecture is fully designed and whose work is straightforward implementation; 4 yes; 5 leave the
listing, and add the rule to load the installed skills that fit the work (also named in the hand-over prompt); 6 yes; 7 open (expected saving under 0.5 %); 8 yes;
9 noted. The backstop `BASH_MAX_OUTPUT_LENGTH` from change 3 was not set: it was not among the questions.

1. Sessions: one slice per session with a hand-over prompt, as rule 1 and 2?
2. Backstop for compaction: `autoCompactWindow` at 300,000, at 400,000, or none?
3. Sonnet 5.5 for implementing slices that have a written prompt: yes, a trial on two slices, or no?
4. Subagents: Sonnet for research and Haiku for file search through `.claude/agents/`?
5. Skills: set the never-loaded ones to `name-only`, remove some, or leave the listing?
6. Move the Skills section of AGENTS.md to `docs/skills.md`?
7. Shorten `docs/index.md` to one short line per document?
8. Commit the measuring script as `scripts/token-report.mjs` (aggregates only) to measure again after a week?
9. User-level plugins (`context-management`, `unit-testing`) add agent types to every session and were never
   used here: they live outside this repository, so only the owner can turn them off.

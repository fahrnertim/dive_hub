---
title: Guardrails for autonomous agent development
summary: What 2026 research says about the quality and cost of agent-written code, the framework camps (spec-driven, process skills, harness engineering), how architecture stays clean under autonomy (fitness functions in the loop and in CI, a fresh-context reviewer), and what that means for Dive Hub - strong on context and cost, missing enforcement; six ranked steps. Acted on in the guardrails slice (CI, dependency-cruiser, ESLint, hooks, review agent, proposed ADR 0053).
status: decided
date: 2026-10-22
---

# Guardrails for autonomous agent development

The substance of the analysis "Autonomous Agentic Development: State of the Art (Oct 2026)", written on
2026-10-22 as a Claude doc ([link](https://claude.ai/artifact/VEocfQLds4rFVjF4WQcQ6r)). Committed here per
[ADR 0001](../decisions/0001-all-project-knowledge-in-repo.md): the doc outside the repository does not count.
The Dive Hub part analysed commit `26ab8e8` (2026-10-08).

**In short:** agents ship real volume, but without deterministic guardrails they measurably add complexity and
smells. Frameworks and skills improve the process; only automated checks that the agent cannot pass by enforce
architecture. Agents can enforce architecture automatically; they cannot yet be trusted to design it.

## What research says about code quality

The 2026 studies agree: agent-written code works, but it adds complexity and smells that stay unless something
removes them.

| Study | Scope | Finding |
|---|---|---|
| [Agarwal, He, Vasilescu: AI IDEs or Autonomous Agents?](https://papers.cool/arxiv/2601.13597) | causal diff-in-diff on open-source repositories | static-analysis warnings +18 %, cognitive complexity +35 %, staying after the speed gains fade; speed gains only where the agent was the first AI tool |
| [Do AI Agents Write Less Maintainable Code? (ICML 2026)](https://icml.cc/virtual/2026/82761) | controlled two-step PR chains | follow-up tasks on agent code resolved 1–13 points less often; more structural complexity and verbosity |
| [Debt Behind the AI Boom](https://huggingface.co/papers/2603.28592) | 302k AI commits, 6,299 repositories | smells are 89 % of introduced issues; about net-neutral on smells, but 1.5× more correctness issues introduced than fixed, about a quarter persist |
| [TU Delft master thesis](https://repository.tudelft.nl/record/uuid:63f972c1-858d-4387-9468-114d77702ffc) | 4.4M agent PRs, 10 agents | agents refactor less often and less diversely; more smells after merge; regions revisited more often |
| [Not All Agents Are Equal](https://arxiv.org/pdf/2609.17598) | 37.6k PRs, 5 agents | large differences between vendors; Codex PRs reverted about half as often as human PRs |

Thoughtworks calls the risk *cognitive debt* (code shipped faster than anyone understands it), the main theme
of Technology Radar Vol. 34 (April 2026). An [MSR 2026 paper](https://2026.msrconf.org/details/msr-2026-technical-papers/21/Investigating-Autonomous-Agent-Contributions-in-the-Wild-Activity-Patterns-and-Code-)
flags over-mocked tests: test-first alone doesn't guarantee meaningful coverage.

## Cost

Context, not generation, drives cost; the habits that make an agent accurate make it cheap.
[Gartner](https://gartner.com/en/newsroom/press-releases/2026-06-24-gartner-predicts-ai-coding-costs-will-surpass-average-developer-salary-by-2028-as-token-consumption-surges)
predicts AI coding costs above an average developer salary by 2028.

- Every tool call resends the context: agentic loops use 10–100× the tokens of chat ([Atlas Cloud](https://www.atlascloud.ai/blog/guides/reduce-ai-coding-token-cost)).
- Over-fetched context costs twice: tokens and worse fixes ([Breeze in Flow](https://breezeinflow.com/news/the-next-bottleneck-in-ai-coding-isnt-code-its-context)).
- Multi-agent setups cost about 2–5× a single agent, up to 10–15× in heavy orchestration ([vibecoding.app](https://vibecoding.app/blog/multi-agent-vs-single-agent-coding)).
- Context files: in the ETH Zurich study ([ICLR 2026](https://arxiv.org/abs/2602.11988v1)) AGENTS.md files tended to
  lower task success and raised inference cost by over 20 %; agents follow them faithfully, which triggers extra
  exploration. Keep them to operational shortcuts (commands, slow tests, paths to skip)
  ([analysis](https://codex.danielvaughan.com/2026/08/06/do-context-files-help-coding-agents-agents-md-ablation-study-codex-cli-correctness-vs-efficiency/)).
- Levers that work: prompt caching (60–90 % hit rate, input cost −70–80 %), model routing (Sonnet about 5× cheaper
  than Opus for 1–2 points on most workflows) ([blckalpaca](https://blckalpaca.at/en/knowledge-base/ai-agents/building-ai-agent-infrastructure/kosten-und-token-economics)),
  curated context (vendor test: −42 % tokens, [Unblocked](https://getunblocked.com/blog/top-ai-token-optimization-tools-compared/), indicative only),
  short scoped rules, one agent by default with subagents for isolated tasks that return little.

## Framework camps

None has independent evidence of better long-term maintainability; reports come from vendors and users.

| Camp | Examples | Does well | Watch out for |
|---|---|---|---|
| Spec-driven development | [GitHub Spec Kit](https://ssojet.com/blog/best-spec-driven-development-tools), Kiro, OpenSpec, BMAD, Tessl | explicit requirements and a plan before code | Thoughtworks rates it Assess ([summary](https://horadecodar.com.br/spec-driven-development-avaliar-adocao/)); agents often ignore specs ([spec-compare](https://github.com/cameronsjo/spec-compare)); heavy process costs tokens |
| Process skills | [Superpowers](https://www.datacamp.com/tutorial/claude-code-superpowers) | enforced red-green-refactor, fresh subagent per task, two-stage review | process discipline, not architecture enforcement |
| Harness engineering | [OpenAI Codex team](https://www.openai.com/index/harness-engineering), Cursor, Stripe Minions | engineers design environment, constraints and feedback loops ([agentboard](https://agentboard.cc/blog/what-is-harness-engineering)) | needs investment in tooling and checks |

OpenAI's lesson: give the agent a map, not a 1,000-page manual.

## Keeping architecture clean under autonomy

Prompts and Markdown rules don't hold architecture; deterministic checks the agent experiences as its success
criterion do ("architecture as code", [Neal Ford](https://nealford.com/training/agentsandarch.html)). The loop:
the agent edits, a hook checks the file, a fresh reviewer checks the slice, a pre-commit hook and CI check
everything; red sends work back.

1. **Fitness functions as gates**: layer and import rules (dependency-cruiser, ArchUnit, import-linter), no cycles,
   size and complexity budgets, banned patterns. [Steward](https://github.com/somasays/steward) runs such a suite
   in a pre-commit hook and again in CI.
2. **Checks inside the agent loop**: a PostToolUse hook runs linters after every write, so the agent fixes smells
   before they settle ([Codex CLI analysis](https://codex.danielvaughan.com/2026/06/23/silent-technical-debt-ai-generated-code-empirical-evidence-codex-cli-quality-defence-patterns/)).
3. **Fresh-context architecture review**: a separate reviewer checks each branch against invariants.
4. **Scoped rules**: inject only the guardrails relevant to the files in play and point to the ADR ([ArchSteer](https://pypi.org/project/archsteer/0.9.1/)).
5. **Tests that test something**: mutation or integration tests against over-mocking.
6. **Observable runtime**: logs and metrics so the agent can run the app and loop until it works.

Humans keep the invariants and the ADRs; what is automated is their enforcement.

## Dive Hub (at `26ab8e8`, about 17,200 lines of server code, 11,300 of web, 16,400 of tests)

Strong on context and cost; missing enforcement. The rules live in prose and nothing fails when they're broken.

**Already in line:** a map, not a manual (ADRs, spec, glossary, index; ADR 0001); short context files (ADR 0039);
measured token economics (ADR 0039); tests against a real PostgreSQL, one `vi.fn` and no `vi.mock`; strict
TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); 0.28 % duplicated lines (jscpd,
70-token minimum).

**Gaps:**

| # | Gap | Evidence |
|---|---|---|
| 1 | No CI, no git hooks | no `.github/`; `pnpm check` before a commit is a rule, not a gate |
| 2 | No checks in the agent loop | the only hook is the memory guard |
| 3 | No linter or complexity budget | 28 functions above cognitive complexity 15; worst `sites/import/import-plan.ts:215` (121), `assessment/rules.ts:261` (95), `providers/dive-import.ts` (839 lines; 42, 36, 25) |
| 4 | Module boundaries not written down or checked | 8 server cycles, mostly through type imports, one at runtime (`divers/diver-service` ↔ `divers/merge` via `DiverError`); `db/schema.ts` imports types from `sites/import`; 7 route files query the database directly; web: `api.ts` ↔ `lib/logbook.ts` |
| 5 | No fresh-context reviewer | subagents only search and research |
| 6 | No drift tracking | tokens are measured; complexity and cycles over time are not |

**Recommended steps, in order:**
1. CI as the hard gate: GitHub Actions running `pnpm check:full` with PostgreSQL; a git hook.
2. The module map as an ADR (layers routes → services → db, allowed imports between domain modules): the owner's decision.
3. Boundaries as code (dependency-cruiser): no cycles, `db/` imports no domain module, route files don't import
   `drizzle-orm`; today's violations as a baseline; the runtime cycle fixed by moving `DiverError` to its own file.
4. ESLint with a ratchet: typescript-eslint and `sonarjs/cognitive-complexity` at 15; existing hotspots suppressed,
   suppressions may only shrink; refactor `import-plan.ts` and `assessment/rules.ts` first (well tested).
5. Hooks: PostToolUse on Edit and Write printing errors only (ADR 0039); a pre-commit hook running `pnpm check`.
6. An architecture-review subagent: read-only, default model, on the slice's diff before the commit.
7. A drift report like `token-report.mjs`: cycles, suppressions and hotspots per week.

Steps 1, 3, 4, 5 and 6 were done in the guardrails slice of 2026-10-22, without refactoring; step 2 is drafted as
[ADR 0053](../decisions/0053-module-boundaries.md) (proposed) for the owner. The refactors in steps 3 and 4 and the
drift report (step 7) are left for later slices.

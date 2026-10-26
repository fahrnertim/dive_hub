---
title: Choose browser and server tests by what they cover; find tests that test the same thing
summary: pnpm check picks the tests whose recorded coverage touches the changed lines (a smallest covering set locally, everything in CI), and a report lists tests whose coverage lies inside another's as candidates to merge or drop; needs its own design, ADR and plan.
status: draft
risk: medium
date: 2026-10-24
---

# Choose tests by what they cover; find tests that test the same thing

From the owner, 2026-10-24, during piece 4 (branch `ssi-private-sites`): "It feels like 80+ percent of our development
time is wasted in testing." The browser suite grew from ~73 tests (215 s on 2 workers, 2026-10-04) to ~205 tests in 280
runs (1136 s); more workers don't help on this machine ([ADR 0023](../decisions/0023-faster-checks.md), measured
2026-10-04 and again 2026-10-24). The same day the owner decided: no `pnpm check:full` before a push (CI is the gate),
browser tests in one variant locally, and a log of what CI catches after a green local check (ADR 0023's amendment of
2026-10-24). This task is the next step, scheduled right after piece 4. Not ready: it needs a design session first.

## First: research testing strategies (owner, 2026-10-24)
Before the design, a research note (`docs/research/<date>-testing-strategies.md`, through the `researcher` subagent)
on how others keep checks fast with enough certainty: test impact analysis and predictive test selection (e.g. Google's
TAP, Meta's predictive test selection, Launchable-style tools), coverage-based selection and test-suite minimisation,
the test pyramid vs. trophy (what belongs in browser tests at all), risk-based selection, flaky-test handling
(quarantine, retries), and what Playwright and vitest offer for it (sharding, `--only-changed`, coverage per test). The
design then picks from it. Done: [testing strategies](../research/2026-10-26-testing-strategies.md).

## Goal
- **Selection by coverage:** record, per test, which source files and lines it runs (browser tests: the web client's
  V8 coverage and the e2e server's; server tests: vitest's coverage). `pnpm check` runs the tests that touch the changed
  lines instead of whole area tags, and among tests that cover the same changed lines a smallest covering set (the
  rest run in CI). New and changed tests always run.
- **Tests that test the same thing:** a report of tests whose coverage lies inside another test's, as candidates to merge
  or drop. The owner decides each one: the same lines can be checked for different things, so coverage alone never
  deletes a test.
- **Certainty measured, not assumed:** the escape log from ADR 0023's amendment says how often CI catches what the local
  selection missed; the selection is tightened or loosened on that evidence.

## Open
- Where the coverage map lives and when it is refreshed (CI artefact vs. a local file; stale map → run more, never less).
- Cost of recording coverage per test (it slows the run that records it) and whether CI records it on main only.
- Files no test covers (configuration, migrations, texts): which fallback runs for them.
- How it fits the area tags and the green records (`refs/check/green-<step>`).

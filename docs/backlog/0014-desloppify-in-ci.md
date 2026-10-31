---
title: desloppify's objective score in CI and a changed-files pass before a PR
summary: A report-only CI job that writes desloppify's objective score and the findings in the PR's changed files to the job summary (no gate at first), and an optional pre-PR step that scans and filters to the branch's changed files; the subjective review stays with cleanup cycles. Needs an ADR on the checks first (it amends ADR 0023).
status: draft
risk: low
date: 2026-10-31
---

# desloppify's objective score in CI and a changed-files pass before a PR

## Goal
Code-health decay shows up on the PR that causes it, not at the next cleanup cycle.

Done:
- An ADR (new, amending [ADR 0023](../decisions/0023-faster-checks.md)) says what runs where: the CI job, whether it
  gates, the pinned desloppify version, and how a finding is accepted.
- A CI job on every PR: installs the pinned desloppify, runs the mechanical scan, writes the **objective** score and
  the findings in the PR's changed files (`git diff --name-only <base>...HEAD`) to the job summary. It doesn't fail
  the build.
- An optional step in finishing a branch (a script, e.g. `pnpm health`): the same scan locally, filtered to the
  branch's changed files, so new findings are fixed or noted before the PR. [docs/skills.md](../skills.md)'s desloppify
  override and [development.md](../development.md) say when to run it.
- Measured and written in the ADR: the scan's time in CI and locally.

## Read first
- [Code quality baseline](../research/2026-10-29-code-quality-baseline.md): the score's parts (25 % mechanical,
  75 % subjective; the subjective part was 20 Sonnet review batches).
- [The desloppify cleanup note](../research/2026-10-30-desloppify-cleanup.md): scores after the cleanup (strict 74.9,
  objective 82.2).
- [docs/skills.md](../skills.md), the desloppify row and its override (`python -m desloppify`, `.desloppify/` stays local).
- The CI workflow in `.github/workflows/` and `scripts/check-lib.mjs`.

## Decided
- Owner, 2026-10-31: add this as a backlog item; built after the Garmin plan, not during it.
- Only the objective (mechanical) score goes into CI: the subjective review costs tokens and varies between runs; it
  stays with cleanup cycles.
- Report-only first; turning it into a ratchet is decided after a few PRs, in the ADR or a later amendment.

## State
desloppify v1.0 is installed locally with `pip install "desloppify[full]"`; CI has no Python step for it. Its state
(`.desloppify/`, plan, wontfix decisions) is local and ignored, so a CI scan starts fresh every time.

## Open
- Whether desloppify can scan or report only given files, or the findings are filtered afterwards (check its output
  format, e.g. a JSON export).
- A gate later needs accepted findings in a committed list: is that a baseline that AGENTS.md says never to grow, or
  a list of reasoned exclusions as the override already asks for?
- How long a whole-repository scan takes on the CI runner.

## Skills to load
desloppify, pnpm, karpathy-guidelines (read each override in [docs/skills.md](../skills.md#overrides) first).

## Don't
- Gate the build on the score before the ADR says so.
- Run the subjective review in CI.
- Commit `.desloppify/` or `scorecard.png`.

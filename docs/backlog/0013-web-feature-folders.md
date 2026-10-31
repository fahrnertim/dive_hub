---
title: Group the web app's files by feature
summary: Replace the flat apps/web/src root (pages and their components side by side) with feature folders, under a new or amended ADR that says where pages live, whether data hooks leave lib/, the import rules between features, and how check-lib AREAS map; parked by the owner as later work.
status: draft
risk: medium
date: 2026-10-30
---

# Group the web app's files by feature

## Goal
`apps/web/src` is grouped by feature (dives, sites, account, providers, planning, …), so a feature's page,
components and hooks sit together, and the rules that keep features apart are enforced.

Done:
- An ADR (new, or an amendment to ADR 0053) states: where a page lives (today ADR 0053 defines a page as a
  top-level `apps/web/src` file), whether data hooks stay in `lib/` (the owner decided on 2026-10-29 that they
  do), the import rules between features, and how `scripts/check-lib.mjs` AREAS map to the folders.
- The files are moved with `git mv`, imports updated, the dependency-cruiser web rules follow the ADR.
- Behaviour and screens are unchanged; `pnpm check` is green with a review capture of every area.

## Read first
- [ADR 0053 module boundaries](../decisions/0053-module-boundaries.md), the web part and the 2026-10-29 amendment.
- `scripts/check-lib.mjs` AREAS and its tests.
- desloppify item `web_src_root_flat`.

## Decided
- A page never imports another page (cleanup branch).
- The lint baseline check follows staged renames (a5b58c2): move with `git mv`.

## State
Base `main` once `desloppify-cleanup` is merged. The root of `apps/web/src` holds every page and most components.

## Open
- The feature list and which shared parts stay in `ui/` and `lib/`.

## Skills to load
codebase-design, vite, karpathy-guidelines (read each override in [docs/skills.md](../skills.md#overrides)).

## Don't
- Change component behaviour, styles or texts.
- Move the server.

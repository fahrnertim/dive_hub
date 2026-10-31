---
title: Layer the server's domain modules so no two import each other
summary: Remove the two-way imports between server domain modules (dives <-> divers, centres, sites; divers <-> providers, certifications; certifications <-> providers; imports <-> dives) by giving each pair one direction, with an ADR 0053 amendment that states the layers; parked by the owner as later work.
status: draft
risk: medium
date: 2026-10-30
---

# Layer the server's domain modules

## Goal
Every pair of server domain modules depends in one direction only, and `.dependency-cruiser.cjs` enforces it.

Done:
- ADR 0053 has an amendment that names the layers (which modules sit below which) and why.
- `MODULE_IMPORTS` in `.dependency-cruiser.cjs` has no two-way pair; known violations stay `[]`.
- Behaviour is unchanged; `pnpm check` is green.

## Read first
- [ADR 0053 module boundaries](../decisions/0053-module-boundaries.md) and its amendments.
- [The desloppify cleanup note](../research/2026-10-30-desloppify-cleanup.md), section "Server: modules and
  composition": how `dives/` stopped importing `providers/` (85e528e), the pattern to repeat.
- desloppify item `mutual_domain_module_dependencies` (`python -m desloppify show mutual_domain_module_dependencies`).

## Decided
- A rule or answer a lower module needs from a higher one is passed in from the composition root
  (`src/compose.ts`), never imported (85e528e, 4d2545e).
- Only tightening of the dependency rules; never widen one to make a move pass.

## State
Base `main` once `desloppify-cleanup` is merged. Two-way pairs at 2026-10-30: dives ↔ divers, dives ↔ centres,
dives ↔ sites, divers ↔ providers, divers ↔ certifications, certifications ↔ providers, imports ↔ dives.
`dives/` → `providers/` is already types only.

## Open
- Which module sits lower in each pair; propose it in the ADR amendment before moving code.
- Whether some shared types belong in a small shared module instead.

## Skills to load
codebase-design, karpathy-guidelines (read each override in [docs/skills.md](../skills.md#overrides)).

## Don't
- Move files between modules beyond what a direction needs.
- Change routes, responses or the database.

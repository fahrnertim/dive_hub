---
title: "ADR 0053: Module boundaries"
summary: Proposed. The server in three layers (routes → services → db) and the imports between its domain modules as found on 2026-10-22; the web client's shared components import no page; no import cycles. Checked by dependency-cruiser against a baseline of today's 23 violations. First fix - the runtime cycle diver-service ↔ merge through DiverError.
status: proposed
date: 2026-10-22
---

# ADR 0053: Module boundaries

## Status
Proposed – 2026-10-22, drafted by an agent in the guardrails slice for the owner to accept, change or reject.
Until then the rules below are checked (`.dependency-cruiser.cjs`), but the allowed imports between domain
modules are a record of today, not yet a decision.

## Context
The module structure was never written down. The [guardrails research](../research/2026-10-22-agent-guardrails.md)
found what grew without it, and agent-written code is known to add coupling unless a check stops it. Measured on
2026-10-22 with dependency-cruiser (type-only imports count):

- **Cycles:** 13 import edges in cycles, 12 in the server, 1 in the web client (`api.ts` ↔ `lib/logbook.ts`).
  - All server cycles but one run through type imports: `db/schema.ts` takes types from `sites/import`, whose
    files import `db/client.ts`, and `providers/connection-service` ↔ `providers/buddy-service` ↔
    `divers/diver-service`, and `planning/bottom-time` ↔ `planning/gas-plan`.
  - **One cycle exists at run time:** `divers/merge.ts` imports the class `DiverError` from
    `divers/diver-service.ts`, which imports `mergeExternalDiver` from `merge.ts`. It works only because neither
    uses the other while loading.
- **The database layer reaches up:** `db/schema.ts` imports from `sites/import/import-plan.ts`,
  `sites/import/site-source.ts`, `sites/sources.ts` (types) and `vocabulary.ts` (the `WATER_TYPES` values).
- **Route files query the database** in 6 files: `routes.ts`, `dives/routes.ts`, `planning/routes.ts`,
  `users/routes.ts`, `users/account-routes.ts`, `users/admin-routes.ts`. The other route files call services.
- The web client's shared components (`ui/`) import no page today.

## Decision (proposed)

### Server layers
**routes → services → db.** A module's route file (`*routes*.ts`) parses the request, checks access, calls the
module's service and shapes the answer. A service (`*-service.ts` and the module's other files) holds the domain
logic and the queries. `db/` (schema, client, migrations) is the bottom layer.

- Route files don't import `drizzle-orm`: a query in a route moves to the module's service.
- `db/` imports no domain module. The types `db/schema.ts` needs from `sites` move to `db/` or to a types file
  under `db/`; for `vocabulary.ts` the owner chooses (see open questions).
- `http/` (problem answers, shared route helpers), `auth/`, `storage/`, `secrets/` and `vocabulary.ts` are shared
  infrastructure that any module may import.
- `app.ts`, `main.ts`, `worker.ts` and `scripts/` assemble the modules and may import any of them.

### Imports between domain modules
As found on 2026-10-22 (directory level; "type" means type imports only; the shared infrastructure above and `db/`
left out). An import not in this table needs a change of this ADR.

| Module | Imports |
|---|---|
| assessment | imports |
| centres | divers (type), dives, providers, sites |
| certifications | dives, providers |
| divers | centres, certifications, dives, providers |
| dives | assessment (type), centres, divers, imports, providers, sites |
| fit | imports, suunto |
| imports | dives, fit, sites, suunto |
| lead | dives |
| mcp | assessment, dives, planning, sites |
| planning | dives |
| providers | certifications, divers, dives, imports, sites, routes (the root `routes.ts`) |
| sites | dives, providers |
| suunto | imports |
| users | dives |

Several pairs import each other at directory level (dives ↔ divers, dives ↔ providers, dives ↔ sites,
divers ↔ providers, imports ↔ dives, fit ↔ imports). They are not file cycles, but each is a candidate for a seam:
one side should depend on an interface the other owns. Which ones to untangle first is left to the slices that
touch them.

### Web client
- `ui/` (shared components) imports no page (a component file at the top of `apps/web/src`).
- Pages import `ui/`, `lib/`, `design/`, `i18n/` and `api.ts`; `lib/` imports no page.
- `api.ts` ↔ `lib/logbook.ts` is the one cycle; `api.ts` should not need `lib/`.

### No cycles
No import cycle, not even through a type import, in either app.

### How it is checked
- dependency-cruiser (`.dependency-cruiser.cjs`): no cycles; `db/` imports no domain module; route files don't
  import `drizzle-orm`; `ui/` imports no page. It runs in `pnpm check` (changed files), `pnpm check:full`, CI and
  after every edit by an agent ([ADR 0023](0023-faster-checks.md), amendment of 2026-10-22).
- The 23 violations of 2026-10-22 are in `.dependency-cruiser-known-violations.json`. Only new ones fail; the
  file may only shrink. After fixing one, `pnpm lint:baseline` takes it out.
- The table of imports between domain modules is not yet a rule. Once accepted, it can become one (an allow-list
  in `.dependency-cruiser.cjs`), so that a new import between modules fails until this ADR lists it.
- The `architecture-review` subagent (`.claude/agents/architecture-review.md`) reviews each slice against this ADR.

### Order of fixing (each its own small slice, tests first)
1. **The runtime cycle:** move `DiverError` to `divers/diver-error.ts`; `diver-service.ts` and `merge.ts` both
   import it from there.
2. `db/schema.ts` without imports from `sites/` (move `SiteImportCounts`, `ImportArea`, `ImportedValues`,
   `ImportSource` down).
3. The type cycles in `providers/` ↔ `divers/` and `planning/bottom-time` ↔ `planning/gas-plan`.
4. Queries out of the 6 route files, the largest first (`routes.ts`, `dives/routes.ts`).
5. `api.ts` ↔ `lib/logbook.ts` in the web client.

## Open questions for the owner
- Is **routes → services → db** the right shape, or should small read-only routes keep their queries?
- May `db/` import `vocabulary.ts` (value lists used in the schema's enums and checks), making it a layer below
  `db/`? The check counts it as a violation for now.
- Should the table of imports between domain modules become an enforced allow-list now, or after the pairs above
  are untangled?

## Consequences
- An agent gets a failing check, not a sentence to remember, when it crosses a boundary.
- Fixing a violation means shrinking the baseline in the same change; `pnpm check` fails until it does.
- The table must be kept when modules change: a new module or a new import between modules changes this ADR.
- Considered: eslint-plugin-boundaries (its element types fit the web client better than the server's folders, and
  ESLint would then carry two jobs); writing the rules only in this ADR (prose that nothing enforces is what the
  research found missing).

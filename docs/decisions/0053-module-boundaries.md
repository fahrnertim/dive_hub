---
title: "ADR 0053: Module boundaries"
summary: The server in three layers (routes → services → db, every query in a service, vocabulary.ts below db); the imports between its domain modules as an enforced allow-list in .dependency-cruiser.cjs, changed there without a new ADR; the web client's shared components import no page; no import cycles. Checked by dependency-cruiser against a baseline of the 19 violations left. First fix done - the runtime cycle diver-service ↔ merge through DiverError.
status: accepted
date: 2026-10-22
---

# ADR 0053: Module boundaries

## Status
Accepted – 2026-10-22 by the owner, with the answers under "Owner's answers". Drafted by an agent in the
guardrails slice.

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

## Decision

### Server layers
**routes → services → db.** A module's route file (`*routes*.ts`) parses the request, checks access, calls the
module's service and shapes the answer. A service (`*-service.ts` and the module's other files) holds the domain
logic and the queries. `db/` (schema, client, migrations) is the bottom layer.

- Route files don't import `drizzle-orm`: every query lives in a service, with no exception for small or
  read-only routes. A query in a route moves to the module's service.
- `db/` imports no domain module. The types `db/schema.ts` needs from `sites` move to `db/` or to a types file
  under `db/`.
- `vocabulary.ts` (the value lists, such as `WATER_TYPES`, used by the schema's enums and checks and by the API)
  is a layer below `db/`: `db/` may import it, and it imports nothing of the server.
- `http/` (problem answers, shared route helpers), `auth/`, `storage/`, `secrets/` and `vocabulary.ts` are shared
  infrastructure that any module may import.
- `app.ts`, `main.ts`, `worker.ts` and `scripts/` assemble the modules and may import any of them.

### Imports between domain modules
An enforced allow-list: `MODULE_IMPORTS` in `.dependency-cruiser.cjs` names, for each domain module (a folder of
`apps/server/src` that isn't shared infrastructure or `db/`), the other domain modules it may import, at directory
level; `name:type` allows type imports only. It started as the imports found on 2026-10-22. An import between
modules that isn't listed fails the check.

The list is kept in that file, not in this ADR. A new import between modules, or a new module, adds its entry
there in the same commit, with the reason in the commit message: an ordinary, reviewed change that needs **no new
ADR**. Changing the rules themselves (the layers, the shared infrastructure, no cycles) still does. Removing an
entry once an import is gone is always welcome.

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
- dependency-cruiser (`.dependency-cruiser.cjs`): no cycles; `db/` imports no domain module (only
  `vocabulary.ts`); route files don't import `drizzle-orm`; domain modules import only what `MODULE_IMPORTS`
  allows; `ui/` imports no page. It runs in `pnpm check` (changed files), `pnpm check:full`, CI and
  after every edit by an agent ([ADR 0023](0023-faster-checks.md), amendment of 2026-10-22).
- The violations of 2026-10-22 are in `.dependency-cruiser-known-violations.json`: 23 found, 22 left once
  `vocabulary.ts` was allowed below `db/`. 19 left after the DiverError fix. Only new ones fail; the file may only shrink. After fixing one,
  `pnpm lint:baseline` takes it out.
- The `architecture-review` subagent (`.claude/agents/architecture-review.md`) reviews each slice against this ADR.

### Order of fixing (each its own small slice, tests first)
1. **The runtime cycle (done 2026-10-22, 22 → 19):** move `DiverError` to `divers/diver-error.ts`; `diver-service.ts` and `merge.ts` both
   import it from there.
2. `db/schema.ts` without imports from `sites/` (move `SiteImportCounts`, `ImportArea`, `ImportedValues`,
   `ImportSource` down).
3. The type cycles in `providers/` ↔ `divers/` and `planning/bottom-time` ↔ `planning/gas-plan`.
4. Queries out of the 6 route files, the largest first (`routes.ts`, `dives/routes.ts`).
5. `api.ts` ↔ `lib/logbook.ts` in the web client.

## Owner's answers (2026-10-22)
- **routes → services → db, strictly**: small read-only routes don't keep their queries.
- **`db/` may import `vocabulary.ts`**, a layer below `db/`; its known violation left the baseline.
- **The imports between domain modules are an enforced allow-list now**, kept in `.dependency-cruiser.cjs` and
  changed there without a new ADR.

## Consequences
- An agent gets a failing check, not a sentence to remember, when it crosses a boundary.
- Fixing a violation means shrinking the baseline in the same change; `pnpm check` fails until it does.
- A new module or a new import between modules fails the check until `MODULE_IMPORTS` lists it, so each one is a
  visible line in a diff, not a drift nobody saw.
- Considered: eslint-plugin-boundaries (its element types fit the web client better than the server's folders, and
  ESLint would then carry two jobs); writing the rules only in this ADR (prose that nothing enforces is what the
  research found missing).

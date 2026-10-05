---
title: Provider layer follow-ups
summary: The provider layer of slice 13 rated (8/10) with its weak points; agreed direction - a small cleanup slice (leases in PostgreSQL, checking every Provider before deleting, typed text overrides, a second test-only adapter), then buddies starting with Push requirements (local checks only, blocking or advisory, two types). Both implementation prompts included. The cleanup slice is done (slice 13a); buddies are open.
status: open
date: 2026-10-05
---

# Provider layer follow-ups

Asked by the owner on 2026-10-05 after slice 13 ([ADR 0027](../decisions/0027-providers-as-adapters.md)): how good is
the provider layer, and what would improve its weak points?

## Rating: 8/10

Better: everything SSI-specific sits in `providers/ssi/`; the seam is small (`signIn`, `fingerprint`, `open`, `find`)
and a test-only adapter with another sign-in and delivery shows it varies; clients render from `GET /api/providers`;
pacing, the shared logbook read, `remote_gone` and one sealed credentials value came with it.

Weak points:
1. Only dives have a full set of operations; buddies need a new interface.
2. SSI shape left in the web client: "needs a site ID from `ssi`" maps to the site field `ssiSiteId`; the picker knows
   SSI's QR format.
3. Pacing, the Dive lock and the logbook snapshot live in one process.
4. Deleting a Dive at several Providers isn't atomic.
5. Text overrides (`providers.<id>.*`) are untyped.
6. The test-only adapter only creates; update, delete and find are proven by SSI alone.

## Agreed direction (owner, 2026-10-05)

### Push requirements, as the first part of the buddy slice
A Provider declares what an export needs; the generic layer checks it against Dive Hub's data and tells clients
what is missing and how to fix it.
- **Checked against local data only** (the site has an External ID at the source, the buddy has a mapping). Whether
  the remote record still exists is the adapter's check at send time; a stale one fails then with a reason. The
  status is read on every dive page and must not call the Provider.
- **Severity:** `blocking` (sending refuses, `provider_requirements_unmet` with the list) or `advisory` (sent
  without it, with a notice; e.g. an unmapped buddy is left out).
- **Two types to start with:** `site_external_id` (source, ID pattern, accepted forms such as SSI's "site:3314"; a
  Dive without a site is its first step) and `diver_mapping` (per buddy). No catch-all type; new types come with a
  real Provider. A client meeting an unknown type shows the Provider's text and that it can't be fixed there.
- **Fixed through Dive Hub's own records, by generic routes:** `PUT /api/dive-sites/{id}/external-ids/{source}`
  (only for sources Users may type, SSI today) instead of the site API's `ssiSiteId`, and
  `PUT /api/connections/{id}/divers/{diverId}` for Connection Diver mappings.
- Built together with buddies, not before: the two real cases arrive together, so the vocabulary isn't designed
  from one.

### A small cleanup slice first
**Done (2026-10-05, slice 13a):** [ADR 0027's amendment](../decisions/0027-providers-as-adapters.md#amendment-2026-10-05-leases-in-postgresql-and-deleting-at-several-providers)
and [architecture](../spec/architecture.md) say what was built and what was simplified. Weak points 3–6 are resolved
(the logbook snapshot stays per process, as agreed); 1 and 2 come with buddies.
- **Leases in PostgreSQL** instead of in-memory locks: `UPDATE … SET locked_until = now() + interval WHERE
  locked_until < now() RETURNING` per Dive, and `connection.next_action_at` for pacing. Not advisory locks: a
  transaction lock holds a pool connection for the seconds a Provider call takes, a session lock can leak through
  the pool. The logbook snapshot may stay per process (losing it costs one read).
- **Check every Provider before deleting** at several: Connection present and signed in, remote dive there; then
  delete; if one still fails, the Dive stays here and the answer says per Provider which copies are gone.
- **Typed text overrides:** a test that every `providers.<id>.*` key exists under `provider.*`, and a type for them.
- **A second test-only adapter** with confirmed delivery but no find or link; the contract suite runs every
  operation a variant declares.

## Prompt: cleanup slice

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: a small cleanup slice for the provider layer (ADR 0027), from docs/research/2026-10-05-provider-layer-follow-ups.md
("A small cleanup slice first"). Users see no change in behaviour or texts.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md
- docs/research/2026-10-05-provider-layer-follow-ups.md, ADR 0027, 0026 (deleting), 0010 (worker), 0023 (checks)
- docs/spec/architecture.md (slice 13 and its simplifications), docs/spec/clients.md (deleting a Dive)
- Code: apps/server/src/providers/ (pacing.ts, push-service.ts, connection-service.ts, registry.ts, routes.ts),
  apps/server/src/dives/routes.ts (DELETE /dives/{id}), apps/server/src/db/schema.ts (connection, push),
  apps/web/src/lib/providers.ts, apps/web/src/i18n/locales/, apps/web/test/translations.test.ts,
  apps/server/test/ (provider-contract.ts, provider-contract.test.ts, fake-handover-provider.ts,
  provider-layer.test.ts, pacing.test.ts, dive-deletion.test.ts)

Build:
1. Leases in PostgreSQL instead of in-memory state:
   - one action per Dive and Provider: a lease (`locked_until`), taken with a single conditional UPDATE … RETURNING;
     a second request still gets provider_busy; an expired lease (crash) frees itself;
   - pacing per Connection: `connection.next_action_at`; a request waits its turn (bounded, then provider_busy);
   - no advisory locks, no transaction held open during a Provider call;
   - the SSI logbook snapshot may stay in memory.
   Migration generated and reviewed (never drizzle-kit push; applied migrations are never edited).
   Prove it with two app instances on one database in a server test.
2. Deleting at several Providers: check all of them first (Connection, signed in, remote dive there; the adapter
   says how), then delete; if one still fails, keep the Dive, answer per Provider what is gone, and record it.
   Add a test with two Providers (SSI and a test-only one that can delete).
3. Typed text overrides: a type for `providers.<id>.*` keys, and a web test that each exists under `provider.*`.
4. A second test-only adapter: confirmed delivery (ID back), update and delete, no find or link, token sign-in.
   The contract suite runs every operation each adapter declares. Never registered in production.

Confirm with me before building only if something in the code makes this harder than it looks.

Rules:
- Skills first (AGENTS.md): search ("distributed lock", "lease", "postgres locking", "job concurrency"), vet,
  propose, install only with my approval; record the outcome in docs/skills.md.
- Use postgres-drizzle and codebase-design; test-first where it fits (tdd).
- `pnpm check` while working, `pnpm check:full` before proposing a commit. No review capture (no UI change).
- Docs: ADR 0027 (amend: leases, deleting), architecture (slice 13a or 14), clients.md if an answer changes,
  development.md, index.md; mark the cleanup part of the follow-ups note done.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked, simplifications, what you need me to decide.
```

## Prompt: buddies, starting with Push requirements

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: buddies on Dives, sent to and imported from SSI, built on a new Push requirements system in the provider
layer. First the requirements (agreed design in docs/research/2026-10-05-provider-layer-follow-ups.md), then
Participants, Connection Diver mappings (ADR 0024) and the buddies kind for SSI.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md
- docs/research/2026-10-05-provider-layer-follow-ups.md ("Push requirements")
- ADR 0027 (providers as adapters), 0024 (Diver External IDs, Connection Diver mappings), 0021 (External IDs,
  the SSI site ID by hand), 0016 (Divers, sharing later), 0015 (Overrides, Revisions, versions), 0014 (codes),
  0023 (checks)
- docs/glossary.md (Diver, Participant, Buddy, Buddy suggestion, Joint dive, Provider, Connection, External ID, Push),
  docs/spec/data-model.md (Participant, Connection Diver mappings, Scenarios 2 and 4), docs/spec/clients.md
  (Sending a Dive to a Provider, Dive sites), docs/spec/architecture.md (slice 13), docs/references/ssi-app-api.md
  (logbook_buddies, get_buddies, odin_user_log_buddy_ids; "no call to add a buddy is known")
- Code: apps/server/src/providers/ (provider.ts, push-service.ts, connection-service.ts, routes.ts),
  providers/ssi/ (ssi-adapter.ts, ssi-record.ts, ssi-client.ts), apps/server/src/sites/ (the site API's ssiSiteId),
  apps/server/src/divers/, dives/, db/schema.ts, apps/web/src/ (ProviderPanel.tsx, SiteForm.tsx, DiveDetail.tsx,
  DiversPage.tsx, lib/providers.ts), apps/server/test/ (provider-contract.ts, fake-ssi.ts, fake-handover-provider.ts)

Agreed (don't re-litigate):
- Requirements are checked against Dive Hub's own data only; the status never calls the Provider. Whether a remote
  record still exists is the adapter's check at send time.
- Severity: blocking (sending refuses with provider_requirements_unmet and the list) or advisory (sent without it,
  with a notice).
- Two types: `site_external_id` (source, pattern, accepted forms; no site first) and `diver_mapping` (per buddy).
  No catch-all type. A client meeting an unknown type shows the Provider's text and that it can't be fixed there.
- Fixed through generic routes on Dive Hub's records: `PUT /api/dive-sites/{id}/external-ids/{source}` (only for
  sources Users may type) and `PUT /api/connections/{id}/divers/{diverId}`.
- Known before you start: Participants are not built (no table, API or UI). SSI has no known call to create a
  buddy: Dive Hub can read the buddy list and put existing entries on a dive, not add people to it.

Confirm with me before building (give a recommendation for each):
1. The site API's `ssiSiteId`: replace it with the external-ID route (client contract change; the site form keeps
   its field), or keep it beside the route for a while.
2. Participant scope now: only role `buddy`, or all roles from the data model; Revisions for Participants; external
   Divers (no account) as buddies.
3. Buddy suggestions and Joint dives (another User's Diver as buddy): now, or later with sharing (ADR 0016).
4. Connection Diver mappings: table shape and unique rules; set by hand, matched by the Diver's SSI External ID
   (buddy_master_id), or suggested by name; what disconnecting does.
5. Importing the SSI buddy list: create Divers, link to existing ones, or only offer; where it's offered; what is
   stored (no more personal data than needed).
6. Export: an unmapped buddy is advisory (left out, with a notice) - confirm; on update, replace SSI's buddy IDs,
   add to them, or keep those set in the app; whether buddies count in the fingerprint ("outdated").
7. How requirements and the buddies kind appear in the capabilities (GET /api/providers), the status
   (`unmet`) and the contract suite.
8. Anything in the code that makes this harder than it looks: tell me before working around it.

Build (after my answers):
- Server: the requirements in the provider layer (declared by the adapter, evaluated generically, `unmet` in the
  status, provider_requirements_unmet replacing provider_site_id_missing); the generic resolution routes;
  Participants (schema, Revisions, routes); Connection Diver mappings; the buddies kind in the SSI adapter (the buddy
  list from the logbook read it already has, buddy IDs on create/update, read-back). No odin_* outside the adapter.
  Migrations generated and reviewed. Regenerate packages/api-client.
- Web: one resolver per requirement type (the SSI site picker becomes the `site_external_id` resolver, without
  ssiSiteId or SSI's QR format in the code); buddies on the dive page; mapping SSI buddies to Divers; importing the
  buddy list; advisory notices when sending. Translations (en, de); texts name the Provider.
- Tests: test-first where it fits; contract suite gains requirements and the buddies kind; a test-only adapter with
  a requirement of each type; server tests against the fake SSI (with a buddy list); browser tests with area tags;
  ui-quality cases for every new state.
- Docs: ADR(s) per the domain-modeling criteria (requirements amend 0027), glossary (Push requirement, Connection
  Diver mapping), data model, architecture (next slice), clients.md (routes, codes, duties), the SSI reference,
  index.md; mark the follow-ups note done.

Rules:
- Skills first (AGENTS.md): search ("relationships", "contacts", "people picker", "data mapping", "validation rules",
  "privacy personal data"), vet, propose, install only with my approval; record in docs/skills.md.
- Use codebase-design and api-and-interface-design for the interfaces, security-and-hardening for personal data
  (buddies are other people), ux-selection-controls / ux-search for picking Divers and buddy entries.
- `pnpm check` while working, `pnpm check:full` before proposing a commit, review capture with
  REVIEW_AREAS=dives,divers,sites,account; look at the screenshots.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked, simplifications, what you need me to decide.
```

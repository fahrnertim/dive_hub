---
title: SSI integration review
summary: The SSI code checked for soundness and for a generic layer other providers (PADI, QR, imports) could use; sound and well tested, but not generic. Findings and the agreed direction - providers as adapters that declare their capabilities, refactored before the remaining SSI work.
status: open
date: 2026-10-05
---

# SSI integration review

Asked by the owner on 2026-10-05 after slice 12: is the SSI integration sound, does it follow best practices, and
is it behind a generic layer so another provider (PADI) could be added later?

## Sound

- `SsiClient` (`apps/server/src/ssi/ssi-client.ts`): a small interface (`signIn`, `logbook`, `save`) with a factory,
  injectable `fetch`, timeouts, typed `SsiError` reasons, no URL in any log or error (SSI takes password and token in
  the query string), honest User-Agent.
- `ssi-record.ts`: the mapping is pure and unit-tested; updates put our values on top of SSI's current record; a
  fingerprint makes "outdated" cheap; the read-back records what SSI stored differently.
- Secrets: AES-256-GCM bound to row and purpose, key only in `DIVEHUB_ENCRYPTION_KEY`, passwords only by choice.
- Tests replay a fake SSI (`apps/server/test/fake-ssi.ts`), never the live service.
- The data model is mostly provider-neutral already: `push.target`, `push.mode`, `connection.target`,
  `diver_external_id` with `padi`.
- The site import already has the pattern: `SiteSourceAdapter` (OSM, Wikidata, SSI) behind one interface.

## Not generic

1. No provider interface: `createSsiService` mixes what every provider needs (Push records, current remote dive,
   outdated by fingerprint, one action per Dive, token renewal, Connections) with SSI's own steps (logbook read, ±2 min
   duplicate check, SSI numbers, SSI site ID).
2. SSI's raw record leaks: the service reads `odin_user_log_*` fields in 11 places; the client returns an untyped
   record.
3. API and contract are SSI-shaped: `/api/connections/ssi`, `/api/dives/{id}/ssi`, `ssi_*` problem codes,
   `SsiPanel.tsx`, `SsiConnections.tsx`.
4. The Connection assumes e-mail and password (`account_email`, `password`, `keep_signed_in`).
5. Deleting a Dive (slice 12) calls `SsiService` directly instead of asking every provider the Dive is at.

## Gaps against ADR 0024

- "A pause between Pushes" isn't built; only one action per Dive, in memory.
- Each send reads the whole SSI logbook (with profiles) twice: the duplicate check and the read-back.
- Sending runs in the request (known simplification, slice 10).

## Direction (owner, 2026-10-05)

Refactor before the remaining SSI work (buddies, QR payload, import from SSI). Each provider is an adapter that
declares its capabilities: which kinds of sign-in, and per kind of data (dives, Dive sites, buddies) whether it imports,
exports, or both, and with which operations (create, update, delete, link, find existing, read back, ID returned or
only handed over). The generic layer handles Connections and credentials, Pushes, state, locking, pacing and errors,
and passes the capabilities through to the API so clients show what a provider offers.

Only four points aren't settled by SSI alone, and the capabilities cover them: sign-in in the User's browser (OAuth,
2FA), delivery without an ID back (QR, browser automation; PADI has no logbook API per the
[dive data sources](2026-10-02-dive-data-sources.md) note), how a dive is found again, and the merge base for imports.
A second, test-only adapter checks that the layer is generic.

---
title: "ADR 0066: Live updates via server-sent event hints"
summary: Open pages stay current through one SSE hint stream per signed-in User; hints carry kinds and ids only, clients refetch through the normal API, PostgreSQL LISTEN/NOTIFY is the cross-process signal, polling stays as the automatic fallback.
status: Accepted
date: 2026-11-06
---

# ADR 0066: Live updates via server-sent event hints

## Status
Accepted – 2026-11-06 – by the owner. Discussion and acceptance:
[FAHAAA-9](/FAH/issues/FAHAAA-9); technical plan: [tech-plan](/FAH/issues/FAHAAA-9#document-tech-plan);
product plan: [plan](/FAH/issues/FAHAAA-9#document-plan); research:
[comment](/FAH/issues/FAHAAA-9#comment-2853ece1-9d1a-4408-8c33-c1277718ee5e).

## Context
Dive Hub does more and more on its own — scheduled fetches, Waiting pushes, Push runs, Imports,
certification pictures — and a page left open shows stale state until something polls or the user
reloads ([product plan](/FAH/issues/FAHAAA-9#document-plan)). The web client already polls while
work is active (`refetchInterval` in `apps/web`), but only for things it already knows about; a
logbook left open never learns that a scheduled fetch brought a new Dive.

Constraints that shape the decision: self-hosted behind the operator's reverse proxy
([ADR 0004](0004-system-architecture.md)); the worker may run as a separate process and
PostgreSQL is the only service (no Redis, no broker); session auth is an `HttpOnly` same-origin
cookie ([ADR 0011](0011-better-auth.md)); jobs are already enqueued in the writing transaction
(`graphile_worker.add_job`); small boxes — idle cost must be ~zero.

## Decision
- **One SSE stream per signed-in User: `GET /api/live`**, session-cookie authenticated like every
  other route. It carries **hints only** — `{ v, kind, id }` ("Dive X changed", "Import Y
  finished", "a new Dive arrived"), never data. The client reacts by invalidating the matching
  TanStack Query keys and refetching through the normal API, so permissions, shapes and the
  OpenAPI contract remain the only source of truth. Nothing is ever available only in the stream.
- **Cross-process signal: PostgreSQL `LISTEN/NOTIFY`.** Emitters call `SELECT pg_notify(...)`
  **inside the writing transaction** — the same transactional-outbox pattern as
  `graphile_worker.add_job`. A rolled-back write emits nothing; a committed write always emits.
  Each app process holds one dedicated `LISTEN` connection and fans notifications out to its SSE
  connections, filtered per User.
- **Visibility = readability.** Every hint carries a server-computed audience (the users who may
  already fetch the thing); the hub delivers only to those users' connections. The audience is
  never sent on the wire. A wrong hint can cause a needless refetch, never a leak.
- **Emission points:** the enumerated background mutation points (imports, scheduled fetch,
  waiting pushes, push runs, site imports, certification pictures, connections) — and dive/site
  changes through the existing `writeRevision` change-listener seam, which makes logbook hints
  **any-origin by construction** (web, worker, MCP, another tab) from phase 1. Remaining write
  paths get hints later only if a stale screen survives phase 1.
- **No replay, no durable log.** Hints are transient. On **every reconnect the client refetches
  what's on screen** (`invalidateQueries({ refetchType: 'active' })`), which covers dropped
  connections, deploys and restarts. Symmetrically, if a server process loses its `LISTEN`
  connection it closes all its SSE streams, forcing every client through the same resync path.
- **One connection per browser.** Tabs elect a leader (Web Locks) that holds the `EventSource`
  and fans hints out over `BroadcastChannel`; browsers without those APIs open one stream per
  tab. HTTP/2 on the proxy removes the connection cap entirely but is never required.
- **Polling stays as the automatic fallback.** Every existing `refetchInterval` is suspended
  while the channel is healthy and resumes unchanged when it drops. A proxy that strips the
  stream degrades to today's behaviour; nothing breaks. Polling remains a fully valid client
  strategy forever — MCP ([ADR 0035](0035-mcp-connector.md)) and future native clients get no
  stream and lose nothing but freshness.
- **Proxy guidance is part of the contract:** `Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `X-Accel-Buffering: no`, no compression on the route, a heartbeat
  comment every 15 s, and a read timeout above the heartbeat (the documented ≥2 min timeout for
  pushes already covers it). Caddy and Traefik stream by default; nginx needs
  `proxy_buffering off`. The sample proxy setup documents this next to the push timeout.

## Consequences
- Hints are cheap and idempotent; a missed hint is invisible after the next reconnect, and no
  event log or replay machinery is needed.
- Every new background mutation point must emit a hint in its writing transaction, or its screen
  waits for the next poll or reload.
- The browser holds one persistent HTTP connection per browser; on HTTP/1.1 that counts against
  the six-connections-per-origin budget, which the leader election keeps to one.
- A process that loses `LISTEN` closes every stream, so a short server-side gap costs every client
  one refetch rather than leaving a stale page.

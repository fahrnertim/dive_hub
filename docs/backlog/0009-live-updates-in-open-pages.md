---
title: Live updates in open pages (server-sent events instead of polling)
summary: Open pages learn of changes the worker makes (a Waiting push sent, held or stopped; a Push run's or an Import's progress) from an event stream instead of polling every few seconds; needs its own decision on the transport, the worker-to-server signal and what is sent to whom before it is planned.
status: draft
risk: medium
date: 2026-10-27
---

# Live updates in open pages (server-sent events instead of polling)

From the owner, while piece 6 was built ([plan](../superpowers/plans/2026-10-27-provider-automation.md)): the logbook
shows a waiting Dive's state only when the list is fetched again, and the Dive's page polls while a send waits. Not
ready: it needs a decision (ADR) first. Piece 6 itself only polls smarter: the Dive's page and the deleted dives ask
again at the entry's due time, and the logbook refreshes after every Retry, send, number set or remove, and when the
Dive's Waiting push changes while its page is open. A logbook left open on its own still shows the old state.

## Goal
- A page that is open shows a change the worker made within a second or two, without the client polling: a Waiting
  push that went out, was held or stopped; a Push run's progress; an Import that finished.
- Polling stays as the fallback when the stream is down; nothing is only in the stream.

## What it needs (none exists yet)
- A signal from the worker (its own process) to the API server, e.g. Postgres `NOTIFY` on a change, `LISTEN` in the server.
- A stream per signed-in User (server-sent events are enough: one direction), carrying only what that User may see
  (Dives of the Divers they manage), and reconnecting after a drop or a deploy.
- Clients invalidate the matching queries on an event (TanStack Query); the six `refetchInterval`s in `apps/web` are
  the candidates.
- An entry in the [client contract](../spec/clients.md) (subscribing, the event kinds, that polling stays valid).

## Limits to weigh in the decision
- Proxies and the hosting setup must pass a long-lived response (buffering, timeouts).
- One open connection per tab; the server's limits under many Users.
- Related but separate: [0008](0008-web-push-notices.md) is for a closed tab; this is for an open page.

## Open
- Server-sent events or WebSocket; whether the MCP connector or other clients want the same stream.

---
title: "ADR 0049: Dive Hub introduces itself to SSI as SSI's app"
summary: Since about 2026-10-08 SSI stores a save only when it comes with its own app's User-Agent and answers every other client "added to Log" with an invented dive ID; Dive Hub sends the app's User-Agent on calls to SSI until SSI answers the owner's request for a supported way, says "Dive Hub" in the phone parameters, tells the User so, and records a save that was answered and not stored as a failed Push with its own reason (provider_not_stored).
status: accepted
date: 2026-10-10
---

# ADR 0049: Dive Hub introduces itself to SSI as SSI's app

## Status
Accepted – 2026-10-10 (owner). Replaces the "User-Agent" point of [ADR 0024](0024-ssi-target-via-app-api.md); the rest
of that ADR stands. Meant to last until SSI answers the owner's request (below).

## Context
[ADR 0024](0024-ssi-target-via-app-api.md) decided that Dive Hub talks to SSI through the MySSI app's private API with
an honest User-Agent, `DiveHub (+<project URL>)`, and accepted that SSI could block it.

On 2026-10-09 the owner's updates to SSI stopped arriving. What was found on 2026-10-10 with the owner's account
(details and the evidence in the [SSI reference](../references/ssi-app-api.md#saves-only-from-the-apps-user-agent-2026-10-10)):
- The last update SSI stored was on 2026-10-07. The record Dive Hub sends did not change in between, and the commit
  before the dive numbers work failed the same way.
- SSI answers a save from Dive Hub as successful, `{ ok: "added to Log", error: "", odin_user_log_id: "9…" }`, with a
  nine-digit dive ID that exists nowhere, for an update as for a create, and stores nothing. Reading still works.
- A save captured from the MySSI app (5.0.43), sent again unchanged, was stored only when the User-Agent was the app's.
  Ten User-Agents were tried with Dive Hub's own record and parameters: SSI stored the save for
  `Dart/3.12 (dart:io)` and `Dart/3.5 (dart:io)`, and for none of the others (a browser's, okhttp, curl, node, an
  invented name, `DiveHub`, the project URL, and the app's with "DiveHub" appended).
- The query parameters don't decide it: the app's User-Agent with Dive Hub's parameters was stored, Dive Hub's
  User-Agent with the app's parameters was not.

So SSI takes saves from its own app only, by the form of the User-Agent. It is not aimed at Dive Hub by name. SSI gives
no error, which reads as intended.

The owner wrote to SSI on 2026-10-10 and asked for a supported way: an official interface or partner programme, or
leave for a client that identifies itself, or another way to bring dives with their profile into MySSI.

## Decision
- **Calls to SSI carry the app's User-Agent**, `Dart/3.12 (dart:io)` (`SSI_APP_USER_AGENT` in `ssi-client.ts`), on every
  call, reads too: one identity per token. `DIVEHUB_CONTACT` no longer goes to SSI.
- **Dive Hub still says what it is where SSI lets it:** the phone parameters the app sends since 5.0 (`device`,
  `deviceName`, `manufacturer`) say "Dive Hub", not a phone's name. The other parameters are the app's
  (`version=ADR_5.0.43-ssi`, `appVersion`, `platform`, `brand`, `osVersion`).
- **The User is told.** The Provider carries the notice `presents_as_app`: Dive Hub introduces itself to SSI as SSI's
  own app, SSI hasn't agreed to it and could object or block the account.
- **A save that was answered and not stored is a failed Push**, with the reason `provider_not_stored` (a generic
  Provider error, like `provider_refused`):
  - an update or delete SSI answers with another dive ID than the one saved;
  - a create whose dive is not in the logbook read right after.
  The Dive stays as its last real Push left it. Pushes recorded as confirmed in the days before are marked the same by
  a migration (`0033`).
- **It lasts until SSI answers.** A supported way replaces this; a refusal means sending to SSI stops (reads and imports
  don't need it). Either outcome gets its own ADR.

## Considered options
- **Stop sending to SSI** until SSI answers: honest, and the main use of the SSI Connection is gone for an unknown
  time. Kept as what happens if SSI says no.
- **The app's User-Agent only on saves:** less of it, but two identities on one token, and a fresh sign-in with Dive
  Hub's own User-Agent already answered `signed_out` on its first read.
- **Keep the honest User-Agent and report the failure:** what the new reason does when SSI's filter changes again.

## Consequences
- Dive Hub no longer identifies itself to SSI in the User-Agent. SSI can't tell it from the app there, and can't reach
  the operator through it. The risk is the User's SSI account, and every operator's Users'.
- SSI can change the filter at any time. Dive Hub then records `provider_not_stored`, not a false "confirmed".
- The fake SSI of the tests does as SSI does: a save from another User-Agent is answered and not stored.
- `SSI_APP_USER_AGENT` and the version in the parameters follow the app; when SSI's answers change, compare with a
  capture of the app ([how](../references/ssi-app-api.md#capturing-the-app)).
- Client contract: the notice and the new reason ([clients.md](../spec/clients.md)).

---
title: "ADR 0061: An attempt limit per client IP on the public token routes"
summary: Setup, invitation and password reset link routes count attempts per client IP in memory (30 per 15 minutes) and answer 429 too_many_attempts with Retry-After; amends ADR 0012 and 0013, which left them unlimited.
status: accepted
date: 2026-10-30
---

# ADR 0061: An attempt limit per client IP on the public token routes

## Status
Accepted – 2026-10-30 (owner's decision during the desloppify cleanup). Amends
[ADR 0012](0012-invitations-and-admin-bootstrap.md) (its consequence "the invitation and setup endpoints aren't
covered by Better Auth's rate limiter") and [ADR 0013](0013-account-management.md) (the reset link routes).

## Context
Better Auth limits its own routes per client IP (password sign-in: 10 per 15 minutes, [ADR 0012](0012-invitations-and-admin-bootstrap.md)).
Our five public routes that take a token are plain Fastify routes outside it: `POST /api/setup`,
`POST /api/invitations/lookup`, `POST /api/invitations/accept`, `POST /api/password-resets/lookup` and
`POST /api/password-resets/complete`. ADR 0012 accepted that, because the tokens (256 random bits) can't be guessed
and are checked before any password hashing. A review found the gap all the same: an unlimited public route
invites floods, `password-resets/complete` signs in server-side without passing the sign-in limiter, and the
setup token is checked by these routes alone. The owner chose to close it on 2026-10-30.

## Decision
- **One count per client IP across the five token routes**, in a fixed window: `TOKEN_ATTEMPTS` (30 attempts per
  15 minutes) in `apps/server/src/http/attempt-limit.ts`. Every request counts, whatever its answer. The client IP is
  Fastify's `request.ip`, which honours `DIVEHUB_TRUSTED_PROXIES` as for Better Auth.
- **Over the limit the route answers 429 `too_many_attempts`** with `Retry-After` (whole seconds until the window
  ends), as a Problem ([ADR 0014](0014-design-system-and-localization.md)), before the body is read.
- **In memory, no new dependency.** The limiter (`createAttemptLimit`) is built once in `createServices`, takes the
  services' clock (tests move it with `resettableClock`), and drops windows that are over at most once a window, so it
  keeps only the addresses of the last 15 minutes.
- `GET /api/setup` takes no token and stays unlimited.

## Considered options
- **`@fastify/rate-limit`.** Does the same with a dependency and its own reply format; five routes don't need it.
- **Better Auth's limiter with database storage.** Its rules cover only its own paths.
- **A sliding window.** Smoother, but a fixed window is enough at 30 attempts and says exactly when it ends.

## Consequences
- Guessing or flooding a token route from one address stops after 30 attempts for up to 15 minutes; a person
  filling in a form is never near the limit.
- The count lives in one process: it starts over on restart, and two app processes would count apart. That's
  enough for a self-hosted instance with one app process; several would need a shared store.
- Behind a proxy that isn't in `DIVEHUB_TRUSTED_PROXIES`, every client shares the proxy's address and its count.
- An IPv6 client counts by its /64 (an IPv4-mapped address as its IPv4), so stepping through the addresses of
  one network neither escapes the limit nor grows the count's memory (`clientKey`, 2026-10-31).
- Clients show the refusal ([client contract](../spec/clients.md)); the web translates `errors.too_many_attempts`.

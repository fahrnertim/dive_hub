---
title: "ADR 0011: Better Auth for accounts and sessions"
summary: Sign-in uses Better Auth (≥ 1.7.7) with argon2id, invite-only accounts, database sessions and a small plugin set; OIDC via its generic OAuth plugin later.
status: accepted
date: 2026-10-02
---

# ADR 0011: Better Auth for accounts and sessions

## Status
Accepted – 2026-10-02

## Context
[ADR 0004](0004-system-architecture.md) asks for built-in accounts, revocable sessions usable by web
and mobile, and room for OIDC later. The [auth research](../research/2026-10-02-data-sync-upload-auth.md)
recommends database sessions, argon2id, invite-only accounts, an explicit admin bootstrap and
credentials kept apart from the user record. Hand-written auth is where security bugs are most likely.
Fit check: [Better Auth fit check](../research/2026-10-02-better-auth-check.md).

## Decision
- **Better Auth** handles accounts, passwords and sessions, **pinned to ≥ 1.7.7** (fixes for
  account takeover and a PostgreSQL rate-limit race), mounted in Fastify at `/api/auth/*`.
- **Passwords** are hashed with **argon2id** through Better Auth's `hash`/`verify` hooks.
- **Invite-only:** public sign-up is disabled (`disableSignUp`). Admins create users with the admin
  plugin; we build the invitation link (one-time token, user sets their password) ourselves.
- **First admin** is created on first start from the setup configuration (or a one-time setup token
  printed to the log), via a server-side `createUser` call. No "first person to register becomes admin".
- **Sessions** are database-backed and revocable. Web uses cookies (`__Secure-`, `HttpOnly`,
  `SameSite=Lax`) with Better Auth's Origin/Fetch-Metadata CSRF checks; the SPA is served from the
  same site as the API. Mobile uses the Expo integration if the app is React Native, otherwise the
  bearer plugin.
- **Plugins** are kept to what we use: admin now; 2FA (TOTP), passkeys and generic OAuth (OIDC, with
  PKCE) when those features are built. No SSO, SCIM, Stripe or OIDC-provider plugins.
- **Production settings:** rate limiting on with database storage; proxy IP header / trusted proxies
  configured for the operator's reverse proxy.
- **Schema:** Better Auth's tables are generated into their own Drizzle schema file, renamed to our
  conventions where needed, and migrated with drizzle-kit like everything else
  ([ADR 0008](0008-drizzle-database-access.md)). Our Diver and logbook tables reference its `user` table.

## Considered options
- **Own implementation.** Exact fit with the research, but slow to build and we'd own every security
  bug in passwords, sessions, CSRF, reset flows, TOTP, passkeys and OIDC.

## Consequences
- Security fixes come from a dedicated project, but we must follow its advisory feed and update
  promptly; account-takeover advisories have appeared repeatedly, mostly in plugins we don't use.
- Auth endpoints live outside our own route definitions; its OpenAPI plugin describes them.
- No `__Host-` cookie prefix; same-site deployment keeps that acceptable.
- The invite flow and admin bootstrap are our code.

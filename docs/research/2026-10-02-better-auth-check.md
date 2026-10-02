---
title: Better Auth fit check
summary: Better Auth's documented behaviour checked against Dive Hub's auth requirements (hashing, invite-only, Fastify, sessions, mobile, OIDC, Drizzle, advisories).
status: done
date: 2026-10-02
---

# Better Auth fit check

## Question

Does Better Auth meet the auth recommendations in
[data, sync, upload, auth](2026-10-02-data-sync-upload-auth.md), on Fastify + Drizzle + PostgreSQL?

## Method

Official docs at better-auth.com, the source code on GitHub and the GitHub API, read on 2026-10-02.
All items below are [V] unless marked otherwise.

## Findings

| # | Topic | Finding |
|---|---|---|
| 1 | Version, license | Latest stable **1.7.7** (2026-09-30); 1.6.x still patched. MIT. [releases][releases] |
| 2 | Password hashing | Default **scrypt**; replaceable via `emailAndPassword.password.hash/verify`; docs include an argon2 example (`@node-rs/argon2`). [email-password][ep] |
| 3 | Invite-only | `emailAndPassword.disableSignUp`; admin plugin `createUser` (password optional in code, required in docs). **No invitations** outside the organization plugin; issue #5200 closed as not planned. [options][opts], [admin][admin] |
| 4 | First admin | CLI `npx auth@latest create-admin`, server-side `auth.api.createUser` without headers, or `adminUserIds`. No env-only bootstrap. [admin][admin] |
| 5 | Fastify | Official page: catch-all route `/api/auth/*` that builds a Fetch `Request` and calls `auth.handler`; register `@fastify/cors` first; SPA origin in `trustedOrigins`; `auth.api.getSession` in our routes. [fastify][fastify] |
| 6 | Sessions | Stored in the database; 7-day expiry, 1-day refresh; revocation per session or all. Cookies `HttpOnly`, `SameSite=Lax`, prefix **`__Secure-`** (never `__Host-`). CSRF via Origin check and Fetch Metadata. [sessions][sess], [security][sec] |
| 7 | Mobile | Bearer plugin (header `set-auth-token`; docs warn to use it only where cookies aren't possible). Expo integration stores cookies in SecureStore, no bearer needed. [bearer][bearer], [expo][expo] |
| 8 | OIDC later | Generic OAuth plugin with `discoveryUrl`, PKCE on by default. No named Authentik/Authelia helpers; plain OIDC discovery should work [?]. [generic-oauth][goauth] |
| 9 | Drizzle | Separate package `@better-auth/drizzle-adapter`. `npx auth@latest generate` writes a Drizzle schema (tables `user`, `session`, `account`, `verification`, plus plugin tables); names adjustable via `modelName`/`fields`/`usePlural`. Whether `generate` merges into an existing file is undocumented. [drizzle][drizzle] |
| 10 | OpenAPI | Plugin describes all auth endpoints; `generateOpenAPISchema()`. [openapi][openapi] |
| 11 | 2FA, passkeys | TOTP + backup codes plugin; passkeys via `@better-auth/passkey` (SimpleWebAuthn). [2fa][2fa], [passkey][passkey] |
| 12 | Rate limiting | Built in; **on only in production**, in-memory by default; strict limits on sign-in and 2FA; proxy IP header configurable. [rate-limit][rl] |
| 13 | Advisories | Handled via GitHub advisories with patch releases. Recent: Critical OAuth-state account takeover fixed in 1.7.7; PostgreSQL rate-limit race fixed in 1.7.7; several Critical/High in SSO, SCIM, Stripe, OIDC-provider plugins. [advisories][adv] |

## Implications

Recorded in [ADR 0011](../decisions/0011-better-auth.md): pin ≥ 1.7.7, argon2id, invite flow
built by us, small plugin set, database-backed rate limiting, auth schema in its own file.

## Sources

[releases]: https://github.com/better-auth/better-auth/releases
[ep]: https://www.better-auth.com/docs/authentication/email-password
[opts]: https://www.better-auth.com/docs/reference/options
[admin]: https://www.better-auth.com/docs/plugins/admin
[fastify]: https://www.better-auth.com/docs/integrations/fastify
[sess]: https://www.better-auth.com/docs/concepts/session-management
[sec]: https://www.better-auth.com/docs/reference/security
[bearer]: https://www.better-auth.com/docs/plugins/bearer
[expo]: https://www.better-auth.com/docs/integrations/expo
[goauth]: https://www.better-auth.com/docs/plugins/generic-oauth
[drizzle]: https://www.better-auth.com/docs/adapters/drizzle
[openapi]: https://www.better-auth.com/docs/plugins/open-api
[2fa]: https://www.better-auth.com/docs/plugins/2fa
[passkey]: https://www.better-auth.com/docs/plugins/passkey
[rl]: https://www.better-auth.com/docs/concepts/rate-limit
[adv]: https://github.com/better-auth/better-auth/security

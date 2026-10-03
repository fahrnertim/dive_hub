---
title: "ADR 0012: Invitation links, setup token for the first admin, 2FA later"
summary: Admins copy single-use invitation links (no mail server needed); the first admin is created with a one-time setup token printed to the log; TOTP comes in a later slice.
status: accepted
date: 2026-10-03
---

# ADR 0012: Invitation links, setup token for the first admin, 2FA later

## Status
Accepted – 2026-10-03

## Context
[ADR 0011](0011-better-auth.md) makes accounts invite-only and leaves the invitation flow and the
first-admin bootstrap to us. Better Auth has no invitations outside its organization plugin. Most
self-hosted installs have no mail relay. The [auth research](../research/2026-10-02-data-sync-upload-auth.md)
(recommendations 6 and 7) lists the options. The project owner chose them on 2026-10-03.

## Decision
- **Invitations are links the admin copies and passes on.** No SMTP for now. An Invitation is
  bound to one e-mail address and a role (`user` or `admin`), expires after 7 days and works once.
  The token has 256 random bits and only its SHA-256 is stored, so the link is shown once, when it
  is created. It travels in the URL fragment (`/#/invite/<token>`), which browsers keep out of
  server logs and `Referer`. A new Invitation for the same address revokes the open one. Accepting
  claims the Invitation in one `UPDATE … WHERE accepted_at IS NULL …`, then creates the User through
  Better Auth's admin API and signs them in. If creating the User fails, the Invitation is reopened.
- **First admin: a setup token printed to the log.** While no User exists, the server holds one
  random token in memory (hashed, valid 24 h) and logs it at start. The web client's setup page
  asks for it plus the admin's name, e-mail and password. It is used up synchronously before the
  admin is created, so two requests can't both succeed. It is put back if creating the admin fails.
  Each restart while no User exists issues a new one. No admin password sits in `.env`, the
  Compose file or `docker inspect`.
- **Every User gets their own Diver** in a Better Auth `user.create.after` hook, so it covers every
  creation path (setup, invitation, admin API).
- **Passwords:** argon2id at OWASP's minimum (m = 19 MiB, t = 2, p = 1), at least 15 characters
  (NIST, single factor), at most 128, no composition rules.
- **Admins can't impersonate Users.** The admin plugin's role definition leaves out `impersonate` (since [ADR 0013](0013-account-management.md) its endpoints aren't reachable over HTTP at all),
  because signing in as someone would show Dives whose Visibility excludes the admin.
- **Client IP:** Fastify works it out (`trustProxy` from `DIVEHUB_TRUSTED_PROXIES`) and passes it
  to Better Auth in a header of our own that the client can't set. Rate limiting (database storage,
  on in production; password sign-in limited to 10 per 15 minutes per IP) and session records use it.
- **Auth secret:** `DIVEHUB_AUTH_SECRET`, otherwise generated on first start into the data
  directory (`auth-secret`, mode 0600).
- **2FA (TOTP + backup codes) is a later slice.** Its plugin adds tables through an ordinary
  migration; nothing here needs redesigning.
- **Password reset** comes as an admin-issued, single-use link like an Invitation ([ADR 0013](0013-account-management.md)),
  later optionally by mail.

## Considered options
- **SMTP settings now.** Rejected for this slice: more configuration, a dependency and a
  copy-link fallback would still be needed when no relay is configured.
- **`DIVEHUB_ADMIN_EMAIL` / `DIVEHUB_ADMIN_PASSWORD` (Paperless style).** Scriptable, but the
  password stays in the environment. Can be added later if automated installs need it.
- **First person to register becomes admin.** Rejected (research): an exposed fresh instance can be claimed by anyone.

## Consequences
- Anyone who can read the server log of a fresh instance can create the first admin. That's the
  operator, by design. Once an admin exists, setup is closed for good.
- Admins carry links to people themselves. A leaked link works once, for its address, for 7 days,
  and can be revoked.
- A forgotten password needs an admin until password-reset links exist.
- The invitation and setup endpoints aren't covered by Better Auth's rate limiter. Their tokens
  can't be guessed, and they're checked before any password hashing happens.

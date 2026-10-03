---
title: "ADR 0013: Account management: reset links, disable vs delete, our routes in front of Better Auth"
summary: Admin-issued password reset links; admins disable (reversible) or delete (with all data only that User owns) Users; only four Better Auth endpoints are reachable over HTTP; always one enabled admin.
status: accepted
date: 2026-10-03
---

# ADR 0013: Account management: reset links, disable vs delete, our routes in front of Better Auth

## Status
Accepted – 2026-10-03

## Context
After slice 2 ([ADR 0011](0011-better-auth.md), [ADR 0012](0012-invitations-and-admin-bootstrap.md)),
a User who forgot their password was stuck, and admins couldn't change, disable or remove Users.
Better Auth's admin plugin offers these endpoints. Used directly, though, admins could bypass rules
only our code knows about: keep at least one admin, remove stored files, delete only data no one
else needs. Its `/list-sessions` also returns session tokens to page scripts. The project owner chose
"disable and delete" on 2026-10-03.

## Decision
- **Password reset links**, issued by an admin and passed on like an Invitation (no mail). They work
  once and expire after 24 h. Only the token's SHA-256 is stored and the token travels in the URL
  fragment (`/#/reset/<token>`). A new link revokes the User's open one. No links are issued for
  disabled Users. Using a link sets the password and ends every session of that User in one
  transaction, then signs them in. The token is checked before any password hashing.
- **Changing one's own password** uses Better Auth's `change-password` (current password required,
  other sessions end).
- **Own sessions:** `GET/DELETE /api/me/sessions` list and end sessions without ever returning a token.
- **Disable vs delete.** *Disable* blocks sign-in and ends all sessions, keeps all data, and can be
  undone (Better Auth's `banned` flag). *Delete* removes the account and everything only that User
  owns: their Originals, and stored files no other User's Original shares; their Imports; and the
  Divers no one else manages, with their Dives, Recordings, samples, Devices and Revisions. The
  admin confirms by typing the User's e-mail. Rows go in one transaction; files are removed after it commits.
- **Always one enabled admin.** Demoting, disabling or deleting the last enabled admin is refused.
  The rows are locked (`SELECT … FOR UPDATE`), so two admins can't demote each other at once.
  Admins can't disable or delete themselves.
- **Only four Better Auth endpoints are reachable over HTTP:** `sign-in/email`, `sign-out`,
  `get-session`, `change-password`. Everything else answers 404: admin plugin, sign-up, session
  listing, Better Auth's own reset flow, user updates. Our routes call the plugin's logic server-side
  or update the tables directly. This replaces ADR 0012's "no impersonation" role tweak with a
  stricter rule, and keeps the attack surface small (most Better Auth advisories were in endpoints we don't use).
- **OpenAPI:** the four endpoints are described in our OpenAPI document (from Better Auth's
  `openAPI` plugin, with its reference pages off), so generated clients cover sign-in.

## Considered options
- **Disable only.** Rejected: no way to honour an erasure request (GDPR) without manual database work.
- **Delete the login but keep the User's Divers as Divers without a User.** Deferred: it needs rules
  for who may see such Divers. It can come with Diver sharing.
- **Use Better Auth's admin and reset endpoints directly.** Rejected for the reasons above.

## Consequences
- Every new Better Auth feature we use needs its path added to the allowlist on purpose (e.g. the
  bearer plugin for mobile, 2FA).
- When Divers can be shared between Users, the delete rules must be revisited: today a Diver someone
  else also manages survives, but Recordings delivered by the deleted User's Imports go with them.
- If another User uploads the same file in the moment between "is this file still used?" and its
  removal, that User's Original can lose its file. The window is tiny and re-uploading restores it;
  a reference-counted store would close it.

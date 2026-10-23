---
title: "ADR 0058: Provider and auth code no longer ask the owner in interactive sessions"
summary: An interactive edit of apps/server/src/providers/** or apps/server/src/auth/** no longer asks the owner (amends ADR 0055 point 7); unattended runs still never change them (ADR 0054). The owner's ask list is migrations and schema, and ADRs.
status: proposed
date: 2026-10-23
---

# ADR 0058: Provider and auth code no longer ask the owner in interactive sessions

## Status
Proposed – 2026-10-23 (owner's decision during the SSI foundation branch; takes effect on that branch and is accepted
when it merges)

## Context
[ADR 0054](0054-unattended-implementation.md) put `apps/server/src/providers/**` and `apps/server/src/auth/**` on the
owner's list of paths an unattended run never changes. [ADR 0055](0055-local-dev-cycle.md) (point 7) made the same list
ask the owner before every interactive edit, also from subagents and in auto mode.

Provider code is changed in almost every task of the SSI alignment work. On the SSI foundation branch (2026-10-23), one
task waited about 2.3 hours, mostly on prompts. One implementer wrote a provider file through a shell script, which the
hook doesn't see. That is worse than no prompt: the edit went through unasked, and only the implementer's own report
showed it. Each prompt protected little, because these changes already go through tests first, a task review, a final
review and `architecture-review`. The owner sees the same for auth.

Migrations and the schema stay on the ask list, because they change stored data and are hard to undo once run. ADRs stay
on it, because they record the owner's decisions.

What made providers and auth worth guarding remains:
- Providers write to the User's data at an outside service, and the fake services in the tests only know what we
  assumed. That risk is met by the checks on the owner's account (announced, with [T] notes) and by the reviews.
- Auth is security-sensitive. That risk is met by the `better-auth-*` and `security-and-hardening` skills, the reviews,
  and ADR 0011's rules.

## Decision
- In an interactive session, an edit of `apps/server/src/providers/**` or `apps/server/src/auth/**` no longer asks the
  owner.
- Unattended runs still never change either (ADR 0054 unchanged).
- The owner's ask list (ADR 0055 point 7) is now two groups: migrations with `db/schema.ts`, and `docs/decisions/**`.
- In code: `OWNER_PATHS` in `scripts/agent-lib.mjs` loses the providers and auth patterns, and `PROTECTED` lists them in
  its owner group.

## Consequences
- Provider and auth work no longer stops on prompts, and subagents have no reason to route around the hook.
- The owner no longer sees each such edit as it happens. They see it in the task reviews and at the PR.
- A check on the owner's account still needs the owner (sign-in in their own terminal) and is announced before it runs.
- An agent session can change sign-in, sessions or passwords without a prompt. A security slip there is caught only by
  the reviews and tests.
- ADR 0055 point 7 is amended by this ADR, and its text is left as it was.

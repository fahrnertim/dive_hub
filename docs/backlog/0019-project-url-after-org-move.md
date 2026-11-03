---
title: The server names the repository's new address
summary: The repository moved to the Fahrner-Labs organisation; the User-Agent the Site import sends to Wikidata and OpenStreetMap still names the old address github.com/fahrnertim/dive_hub. Change PROJECT_URL and its two test expectations.
status: ready
risk: low
budget_tokens: 500000
date: 2026-11-03
---

# The server names the repository's new address

The repository moved from `github.com/fahrnertim/dive_hub` to
[github.com/Fahrner-Labs/dive_hub](https://github.com/Fahrner-Labs/dive_hub) (owner, 2026-11-03). GitHub redirects the
old address, so nothing is broken; but the Site import's User-Agent is how Wikidata and OpenStreetMap reach the project,
and it should name where the project is.

## Goal
`PROJECT_URL` in `apps/server/src/sites/import/polite-http.ts` is `https://github.com/Fahrner-Labs/dive_hub`. Done: the
two User-Agent expectations in `apps/server/test/site-source-adapters.test.ts` (around lines 48 and 212) expect the new
address and pass; nothing in `apps/` or `scripts/` names `github.com/fahrnertim/dive_hub` any more
(`grep -rn "fahrnertim/dive_hub" apps scripts`). One small PR against `main`.

## Read first
- `apps/server/src/sites/import/polite-http.ts` (`PROJECT_URL`, the User-Agent)
- [ADR 0021](../decisions/0021-site-external-ids-and-import.md) (the polite client; its example User-Agent)

## Decided
- Only the code and its tests change. Old links in accepted ADRs and finished designs (ADR 0021's example, PR links in
  `docs/superpowers/specs/2026-10-31-dive-continuation-design.md`) stay: they are history and GitHub redirects them.

## State
Base `main`. The local remote already points at the new address in the owner's checkout; a fresh clone takes it from the
workflow.

## Open
Nothing.

## Skills to load
`vitest`, `karpathy-guidelines`; read each one's override in [skills.md](../skills.md#overrides).

## Don't
Change the rest of the User-Agent (the contact part comes from configuration), or rewrite links in accepted ADRs.

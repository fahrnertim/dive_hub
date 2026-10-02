---
title: "ADR 0006: Apache-2.0 license; MIT FIT parser in the image, official Garmin SDK only in tests"
summary: Dive Hub is open source under Apache-2.0. Because Garmin's FIT SDK license forbids redistribution, published images use an MIT-licensed parser; the official SDK is a test-only cross-check.
status: accepted
date: 2026-10-02
---

# ADR 0006: Apache-2.0 license; MIT FIT parser in the image, official Garmin SDK only in tests

## Status
Accepted – 2026-10-02

## Context
Dive Hub will be open source. Common choices for self-hosted apps are AGPL-3.0 (Immich, Mealie)
and permissive licenses (MIT, Apache-2.0).

Phase 1 parses Garmin FIT files. Garmin's official FIT SDKs are under the proprietary **FIT
Protocol License Agreement** ([FIT parsing libraries](../research/2026-10-02-fit-parsing-libraries.md)):
- §2c forbids distributing or otherwise making the SDK available to third parties.
- §2d forbids combining it with a copyleft license.

Depending on the npm package is common, but our published Docker image would contain
`node_modules`, which is distribution. (This reading isn't legal advice.)

## Decision
- **Dive Hub is licensed under Apache-2.0.**
- **The published image contains only permissively licensed FIT parsing code.** Phase 1 uses
  `fit-file-parser` (MIT), which covers the dive and tank messages, developer fields and
  compressed timestamps.
- **`@garmin/fitsdk` is a development dependency only.** Tests run both parsers over the same
  sample files and compare results, so we notice when the MIT parser falls behind the official profile.
  It must never end up in a published image.
- **The parser sits behind our own FIT adapter interface**, so it can be replaced (e.g. by the
  official SDK if Garmin permits redistribution, or by our own decoder) without touching the rest.

## Considered options
- **AGPL-3.0.** Protects against closed forks, common for self-hosted apps. Rejected by
  the project owner in favour of a permissive license; it would also rule out the official SDK
  entirely (§2d).
- **MIT.** Simpler, but no explicit patent grant. Apache-2.0 was preferred.
- **Official SDK in the image.** Rejected: conflicts with §2c for distributed images.
- **Asking Garmin for permission first.** Not needed to proceed. Still possible later.

## Consequences
- The repository has a `LICENSE` (Apache-2.0 text) and a `NOTICE` file (copyright holder:
  Tim Fahrner). Dependencies must be
  license-compatible; a license check in CI is worth adding.
- We depend on a community parser with one main maintainer and its own profile. The test-time
  comparison against the official SDK limits that risk; the adapter allows swapping it.
- The FIT license also excludes "safety-critical applications". Dive Hub reads finished dives
  and is not a planning tool. This matters only if we ever add dive planning, which
  would need a fresh look.

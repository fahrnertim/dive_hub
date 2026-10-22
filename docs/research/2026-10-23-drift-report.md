---
title: Drift report 2026-10-23
summary: Import cycles, lint suppressions, complexity hotspots and reverts on 2026-10-23, compared with no earlier report. Written by scripts/drift-report.mjs.
status: living
date: 2026-10-23
---

# Drift report 2026-10-23

Written by `node scripts/drift-report.mjs` ([ADR 0054](../decisions/0054-unattended-implementation.md)). Worse than the last
report means a step down the ladder, not a failure. Compared with: nothing (first report).

| Measure | Now |
|---|---|
| Import edges in cycles (server and web) | 0 |
| ESLint suppressions, all rules (the baseline; may only shrink) | 80 |
| Known dependency violations (baseline) | 0 |
| Functions above cognitive complexity 15, all | 50 |
| Reverts in the last 30 days (of 162 commits) | 0 |

**Most complex functions:**

- `apps/server/src/sites/import/import-plan.ts:202`: 121
- `apps/server/src/assessment/rules.ts:261`: 95
- `apps/web/e2e/review-material.capture.ts:72`: 51
- `apps/server/src/providers/dive-import.ts:450`: 47
- `apps/server/src/providers/push-run-service.ts:112`: 43

<!-- drift: {"cycleEdges":0,"suppressions":80,"knownViolations":0,"complexFunctions":50,"reverts":0} -->

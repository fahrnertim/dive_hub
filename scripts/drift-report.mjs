#!/usr/bin/env node
// Drift report (ADR 0054, step 7 of the guardrails research): is the code getting worse while agents write it?
// Counts import cycles, lint suppressions, the most complex functions and reverts, compares with the last report
// and writes a dated note to docs/research/. Aggregates only; stdout is one short block (ADR 0039).
//
//   node scripts/drift-report.mjs [--days 30] [--no-write]
//
// A worse number than the last report is a reason to step down the ladder of ADR 0054, not a failure.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baselineSize } from './check-lib.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const days = Number(arg('--days') ?? 30);
const write = !process.argv.includes('--no-write');
const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'));

/** Import edges that sit in a cycle, the way ADR 0053 counts them (dependency-cruiser's rule `no-cycles`). */
function cycleEdges() {
  const file = path.join(tmp, 'violations.json');
  const run = node(['node_modules/dependency-cruiser/bin/dependency-cruiser.mjs', '--config', '.dependency-cruiser.cjs',
    '--output-type', 'baseline', '--output-to', file, 'apps/server/src', 'apps/web/src']);
  if (run.status !== 0) throw new Error(`dependency-cruiser failed: ${run.stderr}`.slice(0, 300));
  return JSON.parse(fs.readFileSync(file, 'utf8')).filter((v) => v.rule.name === 'no-cycles').length;
}

/** The functions above the complexity limit, suppressed or not, most complex first. */
function hotspots(top = 5) {
  const none = path.join(tmp, 'no-suppressions.json');
  fs.writeFileSync(none, '{}');
  const run = node(['node_modules/eslint/bin/eslint.js', '--no-warn-ignored', '--format', 'json', '--suppressions-location', none, '.']);
  const found = [];
  for (const f of JSON.parse(run.stdout || '[]')) {
    for (const m of f.messages) {
      const score = /Cognitive Complexity from (\d+)/.exec(m.message)?.[1];
      if (m.ruleId === 'sonarjs/cognitive-complexity' && score) {
        found.push({ at: `${path.relative(process.cwd(), f.filePath).replaceAll('\\', '/')}:${m.line}`, score: Number(score) });
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  return { count: found.length, top: found.slice(0, top) };
}

function reverts() {
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
  const since = `--since=${days} days ago`;
  return { reverts: git('log', since, '-i', '--grep=^revert', '--oneline'), commits: git('log', since, '--no-merges', '--oneline') };
}

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const now0 = new Date();
const today = `${now0.getFullYear()}-${String(now0.getMonth() + 1).padStart(2, '0')}-${String(now0.getDate()).padStart(2, '0')}`;
const spots = hotspots();
const rev = reverts();
const now = {
  cycleEdges: cycleEdges(),
  suppressions: baselineSize(read('eslint-suppressions.json')),
  knownViolations: baselineSize(read('.dependency-cruiser-known-violations.json')),
  complexFunctions: spots.count,
  reverts: rev.reverts,
};

const dir = 'docs/research';
const previousFile = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-drift-report\.md$/.test(f) && !f.startsWith(today)).sort().at(-1);
const previous = previousFile ? JSON.parse(/<!-- drift: (\{.*\}) -->/.exec(read(path.join(dir, previousFile)))?.[1] ?? 'null') : null;
const trend = (key) => (previous && key in previous ? ` (was ${previous[key]})` : '');

const lines = [
  `| Measure | Now |`,
  `|---|---|`,
  `| Import edges in cycles (server and web) | ${now.cycleEdges}${trend('cycleEdges')} |`,
  `| ESLint suppressions, all rules (the baseline; may only shrink) | ${now.suppressions}${trend('suppressions')} |`,
  `| Known dependency violations (baseline) | ${now.knownViolations}${trend('knownViolations')} |`,
  `| Functions above cognitive complexity 15, all | ${now.complexFunctions}${trend('complexFunctions')} |`,
  `| Reverts in the last ${days} days (of ${rev.commits} commits) | ${now.reverts}${trend('reverts')} |`,
];
const note = `---
title: Drift report ${today}
summary: Import cycles, lint suppressions, complexity hotspots and reverts on ${today}, compared with ${previousFile ?? 'no earlier report'}. Written by scripts/drift-report.mjs.
status: living
date: ${today}
---

# Drift report ${today}

Written by \`node scripts/drift-report.mjs\` ([ADR 0054](../decisions/0054-unattended-implementation.md)). Worse than the last
report means a step down the ladder, not a failure. Compared with: ${previousFile ?? 'nothing (first report)'}.

${lines.join('\n')}

**Most complex functions:**

${spots.top.map((s) => `- \`${s.at}\`: ${s.score}`).join('\n')}

<!-- drift: ${JSON.stringify(now)} -->
`;

if (write) fs.writeFileSync(path.join(dir, `${today}-drift-report.md`), note);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${lines.slice(2).map((l) => l.replaceAll('|', ' ').replace(/\s+/g, ' ').trim()).join('\n')}\nTop: ${spots.top.map((s) => `${s.at} ${s.score}`).join(', ')}`);
if (write) console.log(`Wrote ${dir}/${today}-drift-report.md`);

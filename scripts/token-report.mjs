// Where the tokens of this project's Claude Code sessions went (ADR 0039).
// Reads the session transcripts Claude Code keeps on this machine and prints aggregates only:
// no prompt text, no file contents, no account data. Nothing is written.
//
//   node scripts/token-report.mjs [--since YYYY-MM-DD] [--dir <transcript folder>]
//
// Token totals are the API's own counts. What the context consisted of is measured in characters,
// weighted by the number of later requests that carried each item.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

// Claude Code names a project's folder after its path, every other character replaced by "-".
function transcriptDir() {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const want = process.cwd().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const hit = fs.existsSync(root) && fs.readdirSync(root).find((d) => d.toLowerCase() === want);
  if (!hit) { console.error(`No transcripts for ${process.cwd()} under ${root}. Pass --dir.`); process.exit(1); }
  return path.join(root, hit);
}

const dir = arg('--dir') || transcriptDir();
const since = arg('--since') || '';
const repo = path.basename(process.cwd()).toLowerCase();
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));

// Paths inside the repository relative to it; anything else by kind, so no home folder is printed.
const shortPath = (p) => {
  const n = (p || '').split('\\').join('/');
  const i = n.toLowerCase().indexOf(`/${repo}/`);
  if (i >= 0) return n.slice(i + repo.length + 2);
  return n.includes('tool-results/') ? '(stored tool output)' : n.includes('scratchpad/') ? '(scratchpad file)' : '(outside the repository)';
};

// Opus 5.5 list prices relative to uncached input (checked 2026-10-07); other models differ.
const W = { in: 1, cw5: 1.25, cw1: 2, cr: 0.05, out: 5 };
const add = (o, k, v = 1) => (o[k] = (o[k] || 0) + v);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function parse(file) {
  const out = [];
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { /* partial line */ }
  }
  return out;
}

function usageOf(entries) {
  // one API request = one message.id; keep the last usage seen for it
  const byId = new Map();
  for (const o of entries) {
    if (o.type !== 'assistant' || !o.message?.usage || o.message.model === '<synthetic>') continue;
    byId.set(o.message.id, { u: o.message.usage, model: o.message.model, ts: o.timestamp, effort: o.effort });
  }
  return [...byId.values()];
}

function sumUsage(reqs) {
  const t = { n: 0, in: 0, cw5: 0, cw1: 0, cr: 0, out: 0, think: 0 };
  for (const { u } of reqs) {
    t.n++;
    t.in += u.input_tokens || 0;
    t.cw5 += u.cache_creation?.ephemeral_5m_input_tokens || 0;
    t.cw1 += u.cache_creation?.ephemeral_1h_input_tokens || 0;
    t.cr += u.cache_read_input_tokens || 0;
    t.out += u.output_tokens || 0;
    t.think += u.output_tokens_details?.thinking_tokens || 0;
  }
  t.cost = t.in * W.in + t.cw5 * W.cw5 + t.cw1 * W.cw1 + t.cr * W.cr + t.out * W.out;
  return t;
}

const classify = (cmd) => {
  const c = cmd.replace(/\s+/g, ' ');
  const tags = [];
  if (/check:full/.test(c)) tags.push('pnpm check:full');
  else if (/pnpm (run )?check\b/.test(c)) tags.push('pnpm check');
  if (/review[:\-_ ]?capture|REVIEW_AREAS|capture[:\-]review|review:shots|test:review/i.test(c)) tags.push('review capture');
  if (/test:e2e|playwright test/.test(c)) tags.push('browser tests (direct)');
  if (/vitest|pnpm .*\btest\b(?!:)/.test(c)) tags.push('unit tests (direct)');
  if (/\btsc\b|typecheck/.test(c)) tags.push('typecheck (direct)');
  if (/git (diff|log|show)/.test(c)) tags.push('git diff/log/show');
  if (/git commit/.test(c)) tags.push('git commit');
  if (/npx skills/.test(c)) tags.push('npx skills');
  if (/\b(cat|head|tail|sed|awk|grep|rg|find|ls|wc|Get-Content|Select-String|Get-ChildItem)\b/.test(c) && !tags.length) tags.push('shell read/search');
  if (/curl|Invoke-WebRequest|Invoke-RestMethod/.test(c) && !tags.length) tags.push('http');
  if (/docker/.test(c) && !tags.length) tags.push('docker');
  return tags.length ? tags : ['other'];
};

const total = { sessions: 0 };
const G = {
  usage: [], sub: [], perSession: [],
  carry: {}, added: {}, toolCalls: {}, toolResChars: {}, toolResCarry: {}, bash: {}, bashChars: {}, bashCarry: {},
  skills: {}, skillReads: {}, readFiles: {}, readPartial: 0, readFull: 0, readDocs: {}, images: {}, agents: {},
  attRendered: {}, attCount: {}, baseline: {}, breaks: [], compactions: 0, bigResults: [], ctxAll: [],
  gaps: { gt5m: 0, gt60m: 0 }, sysPrompt: [], firstCtx: [], subModels: {}, persisted: 0,
};

for (const f of files) {
  const entries = parse(path.join(dir, f)).filter((o) => !o.isSidechain);
  const reqs = usageOf(entries);
  if (!reqs.length || reqs[0].ts.slice(0, 10) < since) continue;
  total.sessions++;
  const sid = f.slice(0, 8);

  // ---- per request series
  const ctx = reqs.map(({ u }) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
  G.ctxAll.push(...ctx);
  G.firstCtx.push(ctx[0]);
  let compactions = 0, breaks = 0, breakTok = 0;
  for (let i = 1; i < reqs.length; i++) {
    const u = reqs[i].u;
    if (ctx[i] < ctx[i - 1] * 0.6 && ctx[i - 1] > 60000) compactions++;
    const gapMin = (new Date(reqs[i].ts) - new Date(reqs[i - 1].ts)) / 60000;
    if (gapMin > 5) G.gaps.gt5m++;
    if (gapMin > 60) G.gaps.gt60m++;
    const cw = u.cache_creation_input_tokens || 0;
    if (cw > 20000 && (u.cache_read_input_tokens || 0) < ctx[i] * 0.5) {
      breaks++; breakTok += cw;
      G.breaks.push({ sid, i, cw, cr: u.cache_read_input_tokens || 0, gapMin: Math.round(gapMin), afterCompaction: ctx[i] < ctx[i - 1] * 0.6 });
    }
  }
  G.compactions += compactions;

  // ---- content walk, weighted by how many later requests carry each item
  // position of each entry among requests: index of next request after this entry
  const idToReqIdx = new Map();
  { let k = -1; const seen = new Set();
    for (const o of entries) if (o.type === 'assistant' && o.message?.id && o.message.model !== '<synthetic>' && !seen.has(o.message.id)) { seen.add(o.message.id); idToReqIdx.set(o.message.id, ++k); } }
  // segment ends at compaction
  const segEnd = new Array(reqs.length).fill(reqs.length);
  { let end = reqs.length; for (let i = reqs.length - 1; i >= 1; i--) { segEnd[i] = end; if (ctx[i] < ctx[i - 1] * 0.6 && ctx[i - 1] > 60000) end = i; } segEnd[0] = end; }
  let cur = -1; // last request index seen
  const toolName = new Map(), toolInput = new Map();
  const item = (cat, chars, producedByReq) => {
    if (!chars) return;
    add(G.added, cat, chars);
    const firstCarrier = cur + 1; // read as input from the next request on
    const end = segEnd[Math.min(Math.max(firstCarrier, 0), reqs.length - 1)] ?? reqs.length;
    const carries = Math.max(0, end - firstCarrier);
    add(G.carry, cat, chars * carries);
    return carries;
  };
  let commits = 0, prompts = 0;
  for (const o of entries) {
    if (o.type === 'assistant' && o.message?.id && idToReqIdx.has(o.message.id)) {
      cur = Math.max(cur, idToReqIdx.get(o.message.id));
      for (const b of o.message.content || []) {
        if (b.type === 'text') item('model output: text', b.text.length, true);
        else if (b.type === 'thinking') item('model output: thinking (text kept in transcript)', (b.thinking || '').length, true);
        else if (b.type === 'tool_use') {
          toolName.set(b.id, b.name); toolInput.set(b.id, b.input);
          add(G.toolCalls, b.name);
          const s = JSON.stringify(b.input || {}).length;
          item(/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(b.name) ? 'model output: file edits (Write/Edit input)' : 'model output: other tool input', s, true);
          if (b.name === 'Skill') add(G.skills, b.input?.skill || '?');
          if (b.name === 'Agent' || b.name === 'Task') add(G.agents, `${b.input?.subagent_type || 'general-purpose'} / model:${b.input?.model || 'inherit'}`);
          if (b.name === 'Read') {
            const p = (b.input?.file_path || '').replace(/\\/g, '/');
            const m = p.match(/\.claude\/skills\/([^/]+)\//); if (m) add(G.skillReads, m[1]);
            if (b.input?.offset || b.input?.limit) G.readPartial++; else G.readFull++;
          }
          if (b.name === 'Bash' || b.name === 'PowerShell') { for (const t of classify(b.input?.command || '')) { add(G.bash, t); if (t === 'git commit') commits++; } }
        }
      }
    } else if (o.type === 'user') {
      const c = o.message?.content;
      if (typeof c === 'string') { if (!o.isMeta) prompts++; item('user prompts', c.length); continue; }
      for (const b of c || []) {
        if (b.type === 'text') { item('user prompts', b.text.length); if (!o.isMeta) prompts++; }
        else if (b.type === 'image') add(G.images, 'user-attached');
        else if (b.type === 'tool_result') {
          const name = toolName.get(b.tool_use_id) || '?';
          const inp = toolInput.get(b.tool_use_id) || {};
          let chars = 0, imgs = 0;
          if (typeof b.content === 'string') chars = b.content.length;
          else for (const x of b.content || []) { if (x.type === 'text') chars += x.text.length; else if (x.type === 'image') imgs++; }
          if (imgs) add(G.images, name, imgs);
          if (/persisted-output|Output too large/i.test(typeof b.content === 'string' ? b.content.slice(0, 300) : JSON.stringify(b.content || '').slice(0, 300))) G.persisted++;
          const short = name.startsWith('mcp__') ? name.split('__').slice(0, 2).join('__') + '__*' : name;
          add(G.toolResChars, short, chars);
          const carries = item(`tool output: ${short}`, chars) || 0;
          add(G.toolResCarry, short, chars * carries);
          if (name === 'Bash' || name === 'PowerShell') for (const t of classify(inp.command || '')) { add(G.bashChars, t, chars); add(G.bashCarry, t, chars * carries); }
          if (name === 'Read') {
            const p = shortPath(inp.file_path);
            const r = (G.readFiles[p] ||= { n: 0, chars: 0, carry: 0, partial: 0 });
            r.n++; r.chars += chars; r.carry += chars * carries; if (inp.offset || inp.limit) r.partial++;
            const kind = /^docs\/index\.md/.test(p) ? 'docs/index.md' : /^docs\/glossary\.md/.test(p) ? 'docs/glossary.md' : /^docs\/decisions\//.test(p) ? 'docs/decisions/*' : /^docs\/spec\//.test(p) ? 'docs/spec/*' : /^docs\/research\//.test(p) ? 'docs/research/*' : /^docs\/references\//.test(p) ? 'docs/references/*' : /^docs\//.test(p) ? 'docs/* other' : /\.claude\/skills\//.test(p) ? '.claude/skills/*' : /\.(png|jpe?g)$/i.test(p) ? 'images' : /e2e\//.test(p) ? 'apps/web/e2e' : /\.test\.tsx?$/.test(p) ? 'test files' : /^apps\/web\//.test(p) ? 'apps/web source' : /^apps\/|^packages\//.test(p) ? 'server/packages source' : 'other';
            const d = (G.readDocs[kind] ||= { n: 0, chars: 0, carry: 0, partial: 0 });
            d.n++; d.chars += chars; d.carry += chars * carries; if (inp.offset || inp.limit) d.partial++;
          }
          if (chars > 20000) G.bigResults.push({ tool: short, chars, what: name === 'Read' ? shortPath(inp.file_path) : (name === 'Bash' || name === 'PowerShell') ? classify(inp.command || '').join('+') : '' });
        }
      }
    } else if (o.type === 'attachment') {
      const t = o.attachment.type;
      const r = o.rendered === undefined ? 0 : JSON.stringify(o.rendered).length;
      add(G.attCount, t); add(G.attRendered, t, r);
      if (t === 'prompt_snapshot') G.sysPrompt.push(JSON.stringify(o.attachment.systemPrompt || '').length);
      if (['skill_listing', 'instructions', 'agent_listing_delta', 'mcp_instructions_delta', 'deferred_tools_delta', 'environment', 'session_context'].includes(t)) (G.baseline[t] ||= []).push(r);
      if (r) item(`harness: ${t}`, r);
    }
  }

  // ---- subagents
  const subDir = path.join(dir, f.replace('.jsonl', ''), 'subagents');
  let subT = sumUsage([]);
  if (fs.existsSync(subDir)) {
    const all = [];
    for (const sf of fs.readdirSync(subDir).filter((x) => x.endsWith('.jsonl'))) {
      const r = usageOf(parse(path.join(subDir, sf)));
      all.push(...r);
      for (const x of r) add(G.subModels, x.model);
    }
    subT = sumUsage(all); G.sub.push(...all);
  }

  const t = sumUsage(reqs);
  G.usage.push(...reqs);
  const sorted = [...ctx].sort((a, b) => a - b);
  const hrs = (new Date(reqs.at(-1).ts) - new Date(reqs[0].ts)) / 3.6e6;
  G.perSession.push({ sid, day: reqs[0].ts.slice(0, 10), hrs: +hrs.toFixed(1), prompts, reqs: t.n, commits, firstCtx: ctx[0], medCtx: sorted[sorted.length >> 1], maxCtx: sorted.at(-1), compactions, breaks, breakTok, cr: t.cr, cw: t.cw1 + t.cw5, out: t.out, think: t.think, cost: Math.round(t.cost), subCost: Math.round(subT.cost), subReqs: subT.n });
}

// ================= report
const T = sumUsage(G.usage), S = sumUsage(G.sub);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
console.log(`\n## Sessions: ${total.sessions}, main-thread requests: ${T.n}, subagent requests: ${S.n}`);
console.log('models main:', [...new Set(G.usage.map((r) => r.model))].join(', '), '| effort:', [...new Set(G.usage.map((r) => r.effort))].join(', '), '| subagent models:', JSON.stringify(G.subModels));
const line = (name, t) => console.log(`${name}: input ${fmt(t.in)} | cache write 5m ${fmt(t.cw5)} | cache write 1h ${fmt(t.cw1)} | cache read ${fmt(t.cr)} | output ${fmt(t.out)} (of which thinking ${fmt(t.think)})`);
line('MAIN', T); line('SUBAGENTS', S);
const costParts = (t) => ({ input: t.in * W.in, 'cache write': t.cw5 * W.cw5 + t.cw1 * W.cw1, 'cache read': t.cr * W.cr, 'output (non-thinking)': (t.out - t.think) * W.out, thinking: t.think * W.out });
const all = T.cost + S.cost;
console.log('\n## Price-weighted share (weights: input 1, 5m write 1.25, 1h write 2, cache read 0.05, output 5)');
for (const [k, v] of Object.entries(costParts(T))) console.log(`  main ${k}: ${pct(v, all)}`);
console.log(`  subagents total: ${pct(S.cost, all)}`);
for (const [k, v] of Object.entries(costParts(S))) console.log(`    sub ${k}: ${pct(v, all)}`);

console.log('\n## Per session');
console.table(G.perSession.sort((a, b) => a.day.localeCompare(b.day)));
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log('first-request context (tokens): min', Math.min(...G.firstCtx), 'median', med(G.firstCtx), 'max', Math.max(...G.firstCtx));
console.log('context per request (tokens): median', med(G.ctxAll), 'p90', [...G.ctxAll].sort((a, b) => a - b)[Math.floor(G.ctxAll.length * 0.9)], 'max', Math.max(...G.ctxAll));
const bands = [50e3, 100e3, 200e3, 400e3, 1e9]; const bc = bands.map(() => ({ n: 0, tok: 0 }));
for (const c of G.ctxAll) { const i = bands.findIndex((b) => c < b); bc[i].n++; bc[i].tok += c; }
console.log('requests by context size band (<50k,<100k,<200k,<400k,>=400k):', bc.map((b) => `${b.n} req / ${pct(b.tok, G.ctxAll.reduce((a, b) => a + b, 0))} of input tokens`).join(' ; '));
console.log('compactions (context drop >40%):', G.compactions, '| gaps between requests >5 min:', G.gaps.gt5m, '>60 min:', G.gaps.gt60m);
const bt = G.breaks.reduce((a, b) => a + b.cw, 0);
console.log(`cache breaks (>20k rewritten with <50% read): ${G.breaks.length}, tokens rewritten ${fmt(bt)} = ${pct(bt, T.cw1 + T.cw5)} of all cache writes; after gap>60min: ${G.breaks.filter((b) => b.gapMin > 60).length}, after gap 5-60min: ${G.breaks.filter((b) => b.gapMin > 5 && b.gapMin <= 60).length}, after compaction: ${G.breaks.filter((b) => b.afterCompaction).length}, other: ${G.breaks.filter((b) => b.gapMin <= 5 && !b.afterCompaction).length}`);

console.log('\n## Fixed prefix');
console.log('system prompt chars (prompt_snapshot): median', med(G.sysPrompt), 'n', G.sysPrompt.length);
for (const [k, v] of Object.entries(G.baseline)) console.log(`  ${k}: n ${v.length}, median rendered chars ${med(v)}, max ${Math.max(...v)}`);
const sumFirst = G.perSession.reduce((a, s) => a + s.firstCtx * s.reqs, 0);
console.log(`first-request context x requests = ${fmt(sumFirst)} tokens = ${pct(sumFirst, T.in + T.cr + T.cw1 + T.cw5)} of all main input-side tokens`);

console.log('\n## What the conversation part of the context was made of (chars x requests that carried them)');
const carryTotal = Object.values(G.carry).reduce((a, b) => a + b, 0), addedTotal = Object.values(G.added).reduce((a, b) => a + b, 0);
const group = (k) => (k.startsWith('tool output: ') ? 'tool output' : k.startsWith('harness: ') ? 'harness reminders/attachments' : k);
const gc = {}, ga = {};
for (const [k, v] of Object.entries(G.carry)) add(gc, group(k), v);
for (const [k, v] of Object.entries(G.added)) add(ga, group(k), v);
console.table(Object.keys(gc).sort((a, b) => gc[b] - gc[a]).map((k) => ({ category: k, 'added chars': fmt(ga[k]), 'share added': pct(ga[k], addedTotal), 'share carried': pct(gc[k], carryTotal) })));
console.table(Object.keys(G.carry).sort((a, b) => G.carry[b] - G.carry[a]).slice(0, 25).map((k) => ({ item: k, 'added chars': fmt(G.added[k]), 'share added': pct(G.added[k], addedTotal), 'share carried': pct(G.carry[k], carryTotal) })));
console.log('chars added in total:', fmt(addedTotal), '| tokens of context growth can be compared: sum cache writes', fmt(T.cw1 + T.cw5));

console.log('\n## Tool calls'); console.table(Object.entries(G.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => ({ tool: k, calls: v, 'result chars': fmt(G.toolResChars[k] || 0), 'avg chars': Math.round((G.toolResChars[k] || 0) / v) })));
console.log('\n## Shell commands by kind'); console.table(Object.entries(G.bash).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ kind: k, calls: v, 'result chars': fmt(G.bashChars[k] || 0), 'avg chars': Math.round((G.bashChars[k] || 0) / v), 'share of carried': pct(G.bashCarry[k] || 0, carryTotal) })));
console.log('\n## Reads: full', G.readFull, 'partial (offset/limit)', G.readPartial);
console.table(Object.entries(G.readDocs).sort((a, b) => b[1].carry - a[1].carry).map(([k, v]) => ({ kind: k, reads: v.n, partial: v.partial, chars: fmt(v.chars), 'avg chars': Math.round(v.chars / v.n), 'share of carried': pct(v.carry, carryTotal) })));
console.log('top files by chars read:'); console.table(Object.entries(G.readFiles).sort((a, b) => b[1].chars - a[1].chars).slice(0, 25).map(([k, v]) => ({ file: k, reads: v.n, partial: v.partial, chars: fmt(v.chars) })));
console.log('\n## Skills invoked (Skill tool):', JSON.stringify(G.skills)); console.log('SKILL files read directly (Read):', JSON.stringify(G.skillReads));
console.log('\n## Agent calls:', JSON.stringify(G.agents));
console.log('\n## Images in tool results:', JSON.stringify(G.images), '| results persisted to file (too large):', G.persisted);
console.log('\n## Results > 20,000 chars:', G.bigResults.length); const br = {}; for (const b of G.bigResults) { const k = `${b.tool} ${b.what}`; (br[k] ||= { n: 0, chars: 0 }); br[k].n++; br[k].chars += b.chars; }
console.table(Object.entries(br).sort((a, b) => b[1].chars - a[1].chars).slice(0, 20).map(([k, v]) => ({ what: k, n: v.n, chars: fmt(v.chars) })));
console.log('\n## attachments rendered chars by type'); console.table(Object.entries(G.attRendered).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ type: k, n: G.attCount[k], chars: fmt(v) })));

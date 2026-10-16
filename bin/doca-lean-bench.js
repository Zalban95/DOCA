#!/usr/bin/env node
'use strict';

/**
 * npm run lean-bench — what one step sends, with and without lean context (turn/step-ceiling.js; AGENTS.md "Lean
 * context per step"). Offline: a scripted stub model on a loopback port, real tools with outputs of the sizes a design
 * job produced on 2026-10-16 (scripts written, builds run, CAD tools' long replies, files read back), a throwaway data
 * folder (test/helpers.js), no keys and no network.
 *
 * Two runs of the same script, each in a fresh conversation:
 *   before   stepTokens 0, resultChars 0 — the clip and clearing as they were, under an install's large fold settings
 *   after    the shipped defaults (stepTokens 60000, resultChars 8000), the same fold settings
 * Each run is one long turn, then a short new request in the same conversation (whose first step shows what an old
 * conversation carries into new work). Prompt tokens are the harness's own estimate of each request as sent; "cached"
 * is the share of each request that is byte-identical to the start of the one before, which is what a provider's
 * prefix cache can serve.
 *
 *   npm run lean-bench [-- --steps 40 --json]
 */
const H = require('../test/helpers');
const fs = require('fs');
const path = require('path');
const http = require('http');

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const STEPS = Number(arg('steps', 40)) || 40;
const JSON_OUT = process.argv.includes('--json');
// before: as it was. ceiling: stepTokens alone. whole: results whole until cleared. lean: the shipped defaults.
const VARIANTS = {
  before:  { stepTokens: 0, resultChars: 0 },
  ceiling: { stepTokens: 60000, resultChars: 0 },
  whole:   { stepTokens: 60000, resultChars: 64000 },
  lean:    { stepTokens: 60000, resultChars: 8000 },
};

/** The scripted turn: what a design job's steps look like, by size. */
function call(i, dir) {
  const f = n => path.join(dir, `part${n}.scad`);
  const lines = (n, w) => `node -e "for(let i=0;i<${n};i++)console.log('line '+i+' '+'x'.repeat(${w}))"`;
  switch (i % 5) {
    case 0: return { name: 'write_file', args: { path: f(i), content: `// part ${i}\n` + 'cube([10,20,30]); translate([1,2,3]) cylinder(r=4,h=9);\n'.repeat(80) } };
    case 1: return { name: 'shell', args: { command: lines(200, 60) } };          // a build's log, ~14k characters
    case 2: return { name: 'read_file', args: { path: f(i - 2) } };                // a script read back
    case 3: return { name: 'shell', args: { command: lines(420, 70) } };          // a CAD tool's long reply, ~32k
    default: return { name: 'shell', args: { command: lines(8, 40) } };           // a short check
  }
}

/** One stub for both runs (an endpoint's address is read once per process); `state` is reset per run. */
async function stub(state) {
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw);
      const fold = /^Merge the notes/.test(body.messages?.[0]?.content || '');
      let message;
      if (fold) message = { content: 'Earlier: parts designed and built; files part*.scad in the workspace.\nTopics: cad, parts' };
      else {
        const { seen, dir } = state;
        seen.push(body);
        const last = [...body.messages].reverse().find(m => m.role === 'user' && !String(m.content).startsWith('[panel readings'));
        const short = /one more/.test(last?.content || '');
        const i = state.n++;
        const done = short ? seen.filter(b => b._short).length >= 3 : i >= STEPS;
        if (short) body._short = true;
        const c = call(short ? i + 1000 : i, dir);
        message = done ? { content: 'Done.' } : { content: '', tool_calls: [{ id: `k${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }] };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { completion_tokens: 20 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return server;
}

function measure(seen) {
  const budget = require('../modules/harness/budget');
  const out = [];
  let prev = '';
  for (const b of seen) {
    const tokens = budget.estimateRequest({ messages: b.messages, tools: b.tools });
    const text = JSON.stringify(b.tools || []) + JSON.stringify(b.messages);   // tools are served ahead of the messages
    let k = 0; const max = Math.min(prev.length, text.length);
    while (k < max && text.charCodeAt(k) === prev.charCodeAt(k)) k++;
    out.push({ tokens, cached: Math.min(tokens, Math.floor(k / budget.CHARS_PER_TOKEN)), short: !!b._short });
    prev = text;
  }
  return out;
}

async function run(server, state, label, { stepTokens, resultChars }) {
  const memory = require('../modules/harness/memory');
  const catalog = require('../modules/harness/catalog');
  const agent = require('../modules/harness/agent');
  const { CONFIG_PATH } = require('../modules/paths');
  const dir = fs.mkdtempSync(path.join(H.tmp, `${label}-`));
  const seen = [];
  Object.assign(state, { seen, dir, n: 0 });
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), leanstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  // An install's large fold settings (the one measured: a 1M window, fold at 500k): the old valves never fire.
  catalog.saveConfig('doca', { provider: 'leanstub', model: 'm', fallbackChain: [], maxSteps: STEPS + 10, orchestratorWorkSteps: 0,
    contextWindow: 1000000, compactTokens: 500000, historyTurns: 10000, summarizeAfter: 800,
    stepTokens, resultChars });
  const events = [];
  try {
    const s = memory.createSession(`lean bench ${label}`, { activate: false });
    await agent.turn({ message: 'design the mount: write the parts, build them, check them', sessionId: s.id, emit: e => events.push(e) });
    await agent.turn({ message: 'one more small change to the first part', sessionId: s.id, emit: e => events.push(e) });
  } finally { /* the stub is closed once both runs are done */ }
  const steps = measure(seen);
  const sum = k => steps.reduce((n, x) => n + x[k], 0);
  const long = steps.filter(x => !x.short);
  return {
    label, steps: steps.length, total: sum('tokens'), cached: sum('cached'),
    cachePercent: Math.round(100 * sum('cached') / Math.max(1, sum('tokens'))), uncached: sum('tokens') - sum('cached'),
    meanPerStep: Math.round(sum('tokens') / Math.max(1, steps.length)),
    peak: Math.max(...steps.map(x => x.tokens)), lastOfLongTurn: long.at(-1)?.tokens,
    firstOfNewRequest: steps.find(x => x.short)?.tokens,
    compacted: events.filter(e => e.type === 'compacted').length,
    perStep: steps.map(x => x.tokens),
  };
}

(async () => {
  await H.start();
  const state = {};
  const server = await stub(state);
  const results = [];
  try {
    for (const [label, v] of Object.entries(VARIANTS)) results.push(await run(server, state, label, v));
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); }
  if (JSON_OUT) { process.stderr.write(`${JSON.stringify(results, null, 2)}\n`); return; }
  const row = r => `${r.label.padEnd(8)} steps ${r.steps}  total ${r.total}  mean/step ${r.meanPerStep}  peak ${r.peak}  `
    + `last of long turn ${r.lastOfLongTurn}  first of next request ${r.firstOfNewRequest}  cached ${r.cachePercent}% (uncached ${r.uncached})  compactions ${r.compacted}`;
  // stderr: a test runner reading stdout as frames must never see this (AGENTS.md, T1).
  process.stderr.write(`${results.map(row).join('\n')}\n`);
  for (const r of results) process.stderr.write(`${r.label} per step: ${r.perStep.join(' ')}\n`);
})().catch(e => { process.stderr.write(`${e.stack || e}\n`); process.exitCode = 1; });

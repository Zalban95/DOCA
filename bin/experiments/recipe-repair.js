'use strict';

/**
 * `npm run experiment -- recipe-repair` (docs/experiments/recipe-repair.md): recipes with one deliberate break each,
 * run with the flag on; how many proposals, when accepted, then pass — with the tokens and seconds the repairs cost.
 * Runs inside bin/doca-experiment.js, on its throwaway copy of the settings.
 */
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function measure({ tmp }) {
  const agent = require('../../modules/harness/agent');
  const p = agent.params();
  if (!p.model) { console.log('No model is configured for the DOCA harness on this machine, so nothing can be measured.'); return 0; }
  require('../../modules/experiments').set('recipeRepair', true);
  const store = require('../../modules/recipes/store');
  const { run } = require('../../modules/recipes/run');
  const lifecycle = require('../../modules/harness/turn/lifecycle');
  const work = path.join(tmp, 'work');
  fs.mkdirSync(path.join(work, 'old'), { recursive: true }); fs.mkdirSync(path.join(work, 'new'), { recursive: true });
  // Each case: a recipe that worked, then the world changes under it.
  const cases = [
    { title: 'Read the report', steps: [{ tool: 'read_file', args: { path: path.join(work, 'old', 'report.txt') }, check: { contains: 'quarterly' } }],
      before: () => fs.writeFileSync(path.join(work, 'old', 'report.txt'), 'quarterly numbers\n'),
      change: () => fs.renameSync(path.join(work, 'old', 'report.txt'), path.join(work, 'new', 'report.txt')) },
    { title: 'Count the notes', steps: [{ tool: 'list_dir', args: { path: path.join(work, 'notes') }, check: { contains: 'todo.md' } }],
      before: () => { fs.mkdirSync(path.join(work, 'notes'), { recursive: true }); fs.writeFileSync(path.join(work, 'notes', 'todo.md'), '- x\n'); },
      change: () => fs.renameSync(path.join(work, 'notes'), path.join(work, 'notes-2026')) },
    { title: 'Check the config value', steps: [{ tool: 'read_file', args: { path: path.join(work, 'app.conf') }, check: { matches: 'port\\s*=\\s*8080' } }],
      before: () => fs.writeFileSync(path.join(work, 'app.conf'), 'port = 8080\n'),
      change: () => fs.writeFileSync(path.join(work, 'app.conf'), '[server]\nlisten_port = 8080\n') },
  ];
  const person = null;
  const rows = [];
  for (const c of cases) {
    c.before();
    const r = store.save({ title: c.title, steps: c.steps });
    c.change();
    const t0 = Date.now();
    const out = await run(r, { person });
    if (out.ok) { rows.push({ title: c.title, outcome: 'did not break' }); continue; }
    let proposed = null;
    for (let i = 0; i < 600 && !proposed; i++) { await sleep(500); proposed = store.proposed(r.id); if (!proposed && !lifecycle.isRunning(out.sessionId) && i > 10) break; }
    while (lifecycle.isRunning(out.sessionId)) await sleep(500);
    const secs = Math.round((Date.now() - t0) / 1000);
    const tokens = require('../../modules/harness/runs').forSession(out.sessionId, 5).reduce((n, x) => n + (x.tokens || 0), 0);
    if (!proposed) { rows.push({ title: c.title, outcome: 'no proposal', secs, tokens }); continue; }
    const accepted = store.accept(r.id);
    const again = await run(accepted, { person });
    rows.push({ title: c.title, outcome: again.ok ? 'repaired and passing' : `proposal still fails (${again.steps.at(-1)?.why})`, secs, tokens });
  }
  const ok = rows.filter(r => r.outcome === 'repaired and passing').length;
  console.log(JSON.stringify(rows, null, 2));
  const n = rows.filter(r => r.tokens != null);
  console.log(`\n| ${new Date().toISOString().slice(0, 10)} | ${p.provider} / ${p.model} | ${ok} of ${cases.length} | ${n.length ? Math.round(n.reduce((a, r) => a + r.tokens, 0) / n.length) : '—'} | ${n.length ? Math.round(n.reduce((a, r) => a + r.secs, 0) / n.length) : '—'} |`);
  return 0;
}


module.exports = { measure };

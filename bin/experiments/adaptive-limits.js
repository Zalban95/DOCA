'use strict';

/**
 * `npm run experiment -- adaptive-limits [set] [--models provider/model,…]` (docs/experiments/adaptive-limits.md):
 * an evaluation set (default `routing`) run with the experiment off and on — bin/doca-eval.js `--flag adaptiveLimits`,
 * each run in a child process on a fresh sandbox of its own — and success, tokens, steps and time printed per run and
 * per the cases' `difficulty` tag, as rows for the write-up's results table. Real turns against the configured model:
 * real tokens, so nothing runs it by itself. A set of your own (DATA_DIR/evals/sets) is copied into the sandbox first.
 */
const fs = require('fs');
const path = require('path');

function copySets(realDataDir) {
  const from = path.join(realDataDir || '', 'evals', 'sets');
  const to = path.join(require('../../modules/store').DATA_DIR, 'evals', 'sets');
  try { fs.cpSync(from, to, { recursive: true }); } catch { /* none of your own */ }
}

/** Runs doca-eval with the flag off and on; resolves to its comparison rows (null when it printed none). */
function compare(set, models) {
  const argv = [path.join(__dirname, '..', 'doca-eval.js'), set, '--json', '--flag', 'adaptiveLimits', ...(models ? ['--models', models] : [])];
  const child = require('child_process').spawn(process.execPath, argv, { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '', rows = null;
  child.stdout.on('data', d => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.run) console.log(`== ${o.run}`);
      else if (o.case) console.log(`${o.pass ? 'PASS' : 'FAIL'} ${o.i}/${o.n} ${o.case} — ${o.steps ?? '?'} steps, ${o.tokens ?? '?'} tokens`);
      else if (o.compare) rows = o.compare;
      else if (o.error) console.log(o.error);
    }
  });
  return new Promise(r => child.on('close', () => r(rows)));
}

const secs = ms => `${((ms || 0) / 1000).toFixed(1)} s`;

async function measure({ realDataDir, args = [] } = {}) {
  const set = args.find(a => !a.startsWith('--')) || 'routing';
  const i = args.indexOf('--models');
  copySets(realDataDir);
  if (!require('../../modules/evals/store').get(set)) { console.log(`No evaluation set "${set}". npm run eval -- --list`); return 2; }
  const rows = await compare(set, i >= 0 ? args[i + 1] : null);
  if (!rows?.length) { console.log('The evaluation printed no comparison: see its output above.'); return 1; }
  const date = new Date().toISOString().slice(0, 10);
  const cell = d => (d ? `${d.passed}/${d.total}` : '—');
  console.log('\n| date | model | set | flag | passed | tokens | steps | time | small / medium / large passed | notes |');
  for (const r of rows) {
    const [model, flag] = String(r.label).split(' · ');
    const by = r.byDifficulty || {};
    console.log(`| ${date} | ${model} | ${set} | ${/ on$/.test(flag || '') ? 'on' : 'off'} | ${r.passed}/${r.total} | ${r.tokens} | ${r.steps} | ${secs(r.ms)} `
      + `| ${cell(by.small)} / ${cell(by.medium)} / ${cell(by.large)} | ${by.untagged ? `${by.untagged.total} untagged` : ''} |`);
  }
  console.log('\n| flag | difficulty | passed | tokens | steps | time |');
  for (const r of rows) for (const [d, x] of Object.entries(r.byDifficulty || {}))
    console.log(`| ${/ on$/.test(r.label) ? 'on' : 'off'} | ${d} | ${x.passed}/${x.total} | ${x.tokens} | ${x.steps} | ${secs(x.ms)} |`);
  return 0;
}

module.exports = { measure };

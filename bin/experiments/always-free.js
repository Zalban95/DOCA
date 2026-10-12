'use strict';

/**
 * `npm run experiment -- always-free [set] [--models provider/model,…] [--follow seconds]` (docs/experiments/always-free.md):
 * an evaluation set (default `front`) asked of a fresh Orchestrator per case, each case following the work chats it
 * started (bin/doca-eval.js `--orchestrator --follow --flag alwaysFree`, off then on, each run in a child process on a
 * fresh sandbox), and printed as rows for the write-up's table: passes, lanes right, the first word's median, the
 * front's own busy time, tokens in front and behind. Real turns against the configured model — real tokens, so nothing
 * runs it by itself.
 */
const fs = require('fs');
const path = require('path');

function copySets(realDataDir) {
  const from = path.join(realDataDir || '', 'evals', 'sets');
  const to = path.join(require('../../modules/store').DATA_DIR, 'evals', 'sets');
  try { fs.cpSync(from, to, { recursive: true }); } catch { /* none of your own */ }
}

/** doca-eval with the flag off and on; resolves to its comparison rows (null when it printed none). */
function compare(set, { models, follow }) {
  const argv = [path.join(__dirname, '..', 'doca-eval.js'), set, '--json', '--orchestrator', '--follow', ...(follow ? [String(follow)] : []),
    '--flag', 'alwaysFree', ...(models ? ['--models', models] : [])];
  const child = require('child_process').spawn(process.execPath, argv, { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '', rows = null;
  child.stdout.on('data', d => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.run) console.log(`== ${o.run}`);
      else if (o.case) console.log(`${o.pass ? 'PASS' : 'FAIL'} ${o.i}/${o.n} ${o.case} — lane ${o.lane}${o.expectedLane && o.expectedLane !== o.lane ? ` (expected ${o.expectedLane})` : ''}, first ${o.firstMs ?? '?'} ms, front ${o.ms ?? '?'} ms, ${o.children} work chat(s), behind ${o.childTokens ?? 0} tokens`);
      else if (o.compare) rows = o.compare;
      else if (o.error) console.log(o.error);
    }
  });
  return new Promise(r => child.on('close', () => r(rows)));
}

const secs = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);

async function measure({ realDataDir, args = [] } = {}) {
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const set = args.find((a, i) => !a.startsWith('--') && !['--models', '--follow'].includes(args[i - 1])) || 'front';
  copySets(realDataDir);
  if (!require('../../modules/evals/store').get(set)) { console.log(`No evaluation set "${set}". npm run eval -- --list`); return 2; }
  const rows = await compare(set, { models: opt('--models'), follow: opt('--follow') });
  if (!rows?.length) { console.log('The evaluation printed no comparison: see its output above.'); return 1; }
  const date = new Date().toISOString().slice(0, 10);
  console.log('\n| date | model | set | flag | passed | lanes right | first word (median) | front busy (all cases) | result (median) | tokens front | tokens behind | work chats |');
  for (const r of rows) {
    const [model, flag] = String(r.label).split(' · ');
    console.log(`| ${date} | ${model} | ${set} | ${/ on$/.test(flag || '') ? 'on' : 'off'} | ${r.passed}/${r.total} | ${r.lanes ? `${r.lanes.right}/${r.lanes.of}` : '—'} `
      + `| ${secs(r.firstMsMedian)} | ${secs(r.ms)} | ${secs(r.resultMsMedian)} | ${r.tokens} | ${r.childTokens ?? 0} | ${r.children} |`);
  }
  return 0;
}

module.exports = { measure };

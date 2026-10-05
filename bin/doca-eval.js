#!/usr/bin/env node
'use strict';

/**
 * Run an evaluation set against the configured model (TODO H10.1): `npm run eval -- <set>` (`--list` names them).
 *
 * On a throwaway copy of this machine's settings and keys (bin/lib/sandbox.js), so the cases' conversations, memory
 * and files never touch the real data; the result is saved in the real data folder (evals/results/<set>/), where
 * Settings → Evaluations reads it. A paid provider's tokens are real, which is why nothing runs this by itself.
 * `--json` prints one JSON line per case and the result last, for the panel.
 */
const args = process.argv.slice(2);
const json = args.includes('--json');
const id = args.find(a => !a.startsWith('--'));
const store = require('../modules/evals/store');

if (args.includes('--list') || !id) {
  for (const s of store.list()) console.log(`${s.id.padEnd(24)} ${String(s.cases?.length || 0).padStart(3)} cases  ${s.title}${s.origin === 'shipped' ? '' : ' (yours)'}`);
  process.exit(id || args.includes('--list') ? 0 : 2);
}
const set = store.get(id);
if (!set) { console.error(`No evaluation set "${id}". npm run eval -- --list`); process.exit(2); }
const valid = store.validate(set);
const previous = store.results(id, 1)[0] || null;

const { realDataDir, cleanup } = require('./lib/sandbox').sandbox('doca-eval-');
const say = (o, line) => console.log(json ? JSON.stringify(o) : line);

(async () => {
  const p = require('../modules/harness/agent').params();
  if (!p.model) { say({ error: 'no model' }, 'No model is configured for the DOCA harness on this machine, so nothing can be evaluated.'); return 1; }
  const result = await require('../modules/evals/run').runSet(valid, { previous,
    onCase: (c, i, n) => say({ case: c.id, i, n, pass: c.pass, steps: c.steps, tokens: c.tokens },
      `${c.pass ? 'PASS' : 'FAIL'} ${i}/${n} ${c.id} — ${c.steps ?? '?'} steps, ${c.tokens ?? '?'} tokens${c.pass ? '' : `\n     ${c.checks.filter(x => !x.pass).map(x => x.why).join('\n     ')}`}`) });
  const file = require('../modules/evals/store').saveResult(result, require('path').join(realDataDir, 'evals'));
  say({ result: { ...result, file } }, `\n${result.passed}/${result.total} passed on ${result.model}, ${result.tokens} tokens`
    + `${result.regressed.length ? ` — regressed: ${result.regressed.join(', ')}` : ''}${result.fixed.length ? ` — fixed: ${result.fixed.join(', ')}` : ''}\n${file}`);
  return result.passed === result.total ? 0 : 1;
})().then(code => { cleanup(); process.exit(code); }, e => { say({ error: e.message }, `eval: ${e.message}`); cleanup(); process.exit(1); });

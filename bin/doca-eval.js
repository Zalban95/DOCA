#!/usr/bin/env node
'use strict';

/**
 * Run an evaluation set against the configured model (TODO H10.1): `npm run eval -- <set>` (`--list` names them).
 *
 * On a throwaway copy of this machine's settings and keys (bin/lib/sandbox.js), so the cases' conversations, memory
 * and files never touch the real data; the result is saved in the real data folder (evals/results/<set>/), where
 * Settings → Evaluations reads it. A paid provider's tokens are real, which is why nothing runs this by itself.
 * `--json` prints one JSON line per case and the result last, for the panel.
 *
 * Comparing (TODO B7): `--models ollama/qwen3:8b,deepseek/deepseek-chat` runs the set once per model, and
 * `--flag toolTiers` once with that experiment off and once on (`--flag toolTiers=on` only on), developer mode on in the
 * sandbox only; together,
 * every model × off/on. Each run is saved as usual; a table of passes, tokens and steps per run is printed last.
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

const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const models = (opt('--models') || '').split(',').map(x => x.trim()).filter(Boolean);
const [flag, only] = String(opt('--flag') || '').split('=');   // --flag toolTiers, or toolTiers=on / =off for one run

/** Point the sandbox's harness at one model (`provider/model`) and the flag on or off; returns its label. */
function configure(model, on) {
  const { loadPrefs, savePrefs } = require('../modules/utils');
  const prefs = loadPrefs();
  if (model) {
    const [provider, ...rest] = model.split('/');
    const doca = { ...(prefs.harness?.config?.doca || {}), provider, model: rest.join('/') };
    prefs.harness = { ...(prefs.harness || {}), config: { ...(prefs.harness?.config || {}), doca } };
  }
  if (flag) { prefs.developer = { ...(prefs.developer || {}), mode: true }; prefs.experiments = { ...(prefs.experiments || {}), [flag]: on }; }
  savePrefs(prefs);
  return `${model || 'configured model'}${flag ? ` · ${flag} ${on ? 'on' : 'off'}` : ''}`;
}

async function compare() {
  const rows = [];
  for (const model of models.length ? models : [null])
    for (const on of flag ? (only ? [only === 'on'] : [false, true]) : [null]) {
      const label = configure(model, on);
      say({ run: label }, `\n== ${label}`);
      const code = await once();
      const r = last;
      rows.push({ label, code, passed: r?.passed, total: r?.total, tokens: r?.tokens, steps: (r?.cases || []).reduce((n, c) => n + (c.steps || 0), 0) });
    }
  say({ compare: rows }, `\n| run | passed | tokens | steps |\n|---|---|---|---|\n${rows.map(r => `| ${r.label} | ${r.passed}/${r.total} | ${r.tokens} | ${r.steps} |`).join('\n')}`);
  return rows.every(r => r.code === 0) ? 0 : 1;
}

let last = null;   // the result of the latest run, for the comparison
const once = async () => {
  const p = require('../modules/harness/agent').params();
  if (!p.model) { say({ error: 'no model' }, 'No model is configured for the DOCA harness on this machine, so nothing can be evaluated.'); return 1; }
  const result = await require('../modules/evals/run').runSet(valid, { previous,
    onCase: (c, i, n) => say({ case: c.id, i, n, pass: c.pass, steps: c.steps, tokens: c.tokens },
      `${c.pass ? 'PASS' : 'FAIL'} ${i}/${n} ${c.id} — ${c.steps ?? '?'} steps, ${c.tokens ?? '?'} tokens${c.pass ? '' : `\n     ${c.checks.filter(x => !x.pass).map(x => x.why).join('\n     ')}`}`) });
  last = result;
  const file = require('../modules/evals/store').saveResult(result, require('path').join(realDataDir, 'evals'));
  say({ result: { ...result, file } }, `\n${result.passed}/${result.total} passed on ${result.model}, ${result.tokens} tokens`
    + `${result.regressed.length ? ` — regressed: ${result.regressed.join(', ')}` : ''}${result.fixed.length ? ` — fixed: ${result.fixed.join(', ')}` : ''}\n${file}`);
  return result.passed === result.total ? 0 : 1;
};

(models.length || flag ? compare() : once()).then(code => { cleanup(); process.exit(code); }, e => { say({ error: e.message }, `eval: ${e.message}`); cleanup(); process.exit(1); });

'use strict';

/**
 * `npm run experiment -- system-one [--models provider/model,…|none] [--only triage|front|browser] [--url …] [--dir …] [--device cpu|cuda]`
 * (docs/experiments/system-one.md): the System 1 model against today's way on labelled cases (bin/lib/system-one-cases.js)
 * — the triage's size (the rules, the rules + a quick model, the rules + Laya), a call's route (the rules, a model,
 * Laya) and a page's next element (one model step reading the snapshot, Laya) — accuracy and time per decision, and
 * Laya's accuracy by how sure it was. The models are real (real tokens); Laya is this hub's service, started from the
 * real data folder's environment on a port of its own, or `--url` / DOCA_SYSTEM_ONE_URL.
 * `--capture [--show]` captures the browser cases again from a throwaway panel (system-one-capture.js).
 */
const path = require('path');

const arg = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const timed = async fn => { const t = Date.now(); try { return { v: await fn(), ms: Date.now() - t }; } catch (e) { return { v: null, ms: Date.now() - t, err: e.message }; } };

const FRONT_PROMPT = 'A person said this in a live spoken call with an AI assistant that has tools. Reply with one word and nothing '
  + 'else: now (answer it in the call, at once or with one or two quick actions) or later (a longer piece of work to hand '
  + 'to a background worker: several steps, research, building or fixing something).';
const BROWSER_PROMPT = 'You drive a web page for an agent. Given the goal and the page (numbered elements [n]), reply with the '
  + 'number of the element to use next and how, and nothing else, e.g. "12 click" or "7 type".';

async function measure({ realDataDir, args = [] } = {}) {
  if (args.includes('--capture')) { console.log(await require('../lib/system-one-capture').capture({ show: args.includes('--show') })); return 0; }
  const { loadPrefs, savePrefs } = require('../../modules/utils');
  const prefs = loadPrefs();
  const s1 = { ...(prefs.systemOne || {}) };
  if (arg(args, '--device')) s1.device = arg(args, '--device');   // cpu, cuda, mps: where Laya computes for this run
  if (arg(args, '--dir')) s1.dir = path.resolve(arg(args, '--dir'));
  else if (!s1.dir) s1.dir = path.join(realDataDir, 'system-one');   // the environment set up on this hub, not the sandbox's
  savePrefs({ ...prefs, developer: { ...(prefs.developer || {}), mode: true }, experiments: { ...(prefs.experiments || {}), systemOne: true }, systemOne: s1 });
  if (arg(args, '--url')) process.env.DOCA_SYSTEM_ONE_URL = arg(args, '--url');
  const service = require('../../modules/system-one/service');
  let started = false;
  if (!process.env.DOCA_SYSTEM_ONE_URL) {
    process.env.DOCA_SYSTEM_ONE_PORT = process.env.DOCA_SYSTEM_ONE_PORT || '8792';   // never the live panel's own
    if (!service.ready()) { console.log('Laya is not set up here: Field → Models → Decision models → Install (or pass --url).'); return 2; }
    const st = await service.start({ why: 'npm run experiment -- system-one' });
    if (st.state !== 'running') { console.log(`Laya did not start: ${st.error}\n${st.log.join('\n')}`); return 1; }
    started = true;
  }
  try {
    const health = started ? await service.health() : null;
    const where = health ? Object.values(health.checkpoint_devices || {}).join('/') || health.device || 'this hub' : 'external';
    const models = (arg(args, '--models') || '').split(',').filter(m => m && m !== 'none').map(m => { const [p, ...r] = m.split('/'); return { provider: p, model: r.join('/') }; });
    if (!models.length && arg(args, '--models') !== 'none') { const p = require('../../modules/harness/turn/params').params(); if (p.model) models.push({ provider: p.provider, model: p.model }); }
    const only = arg(args, '--only');
    const date = new Date().toISOString().slice(0, 10);
    const rows = [];
    console.log(`Laya on ${where}; threshold ${require('../../modules/system-one').settings().threshold}; models: ${models.map(m => `${m.provider}/${m.model}`).join(', ') || 'none'}`);
    if (!only || only === 'triage') rows.push(...await require('../lib/system-one-parts').triage({ models, timed, date, where }));
    if (!only || only === 'front') rows.push(...await require('../lib/system-one-parts').front({ models, timed, date, where, FRONT_PROMPT }));
    if (!only || only === 'browser') rows.push(...await require('../lib/system-one-parts').browser({ models, timed, date, where, BROWSER_PROMPT }));
    console.log('\n| date | decision | way | cases | right | median time | notes |\n|---|---|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${date} | ${r.decision} | ${r.way} | ${r.n} | ${r.right}/${r.n} (${pct(r.right, r.n)}) | ${r.ms} ms | ${r.notes || ''} |`);
    return 0;
  } finally { if (started) service.stop(); }
}

module.exports = { measure, median, pct, FRONT_PROMPT, BROWSER_PROMPT };

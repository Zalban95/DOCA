#!/usr/bin/env node
'use strict';

/**
 * How well the guards do, on a labelled set: clean texts that must pass and
 * injected ones that must not (test/fixtures/guard/). Each enabled guard alone,
 * then all together as the airlock runs them (clean only if all say clean).
 *
 *   npm run guard-eval
 *
 * Uses this install's guards and data folder (DOCA_HOME / DOCA_DATA_DIR).
 */
const fs = require('fs');
const path = require('path');
const guard = require('../modules/harness/guard');

const load = f => fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'guard', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).text);
const clean = load('clean.jsonl'), injected = load('injected.jsonl');

(async () => {
  const all = guard.list();
  const ready = guard.status().guards.filter(g => g.enabled && g.ready);
  const pct = (n, d) => `${Math.round((n / d) * 100)}%`.padStart(4);
  console.log(`${clean.length} clean, ${injected.length} injected. Guards on: ${ready.map(g => g.id).join(', ') || 'none'}\n`);
  console.log('guard'.padEnd(26), 'caught', ' blocked', ' false alarms (flagged clean)');
  const run = async only => {
    if (only) guard.save(all.map(g => ({ ...g, enabled: g.id === only })));
    const inj = [], cl = [];
    for (const t of injected) inj.push((await guard.screen(t, { direction: 'eval' })).verdict);
    for (const t of clean) cl.push((await guard.screen(t, { direction: 'eval' })).verdict);
    return { caught: inj.filter(v => v !== 'clean').length, blocked: inj.filter(v => v === 'blocked').length, alarms: cl.filter(v => v !== 'clean').length };
  };
  try {
    for (const g of ready) {
      const r = await run(g.id);
      console.log(g.id.padEnd(26), pct(r.caught, injected.length), '  ', pct(r.blocked, injected.length), '  ', pct(r.alarms, clean.length));
    }
    guard.save(all);
    const r = await run(null);
    console.log('ALL (the airlock)'.padEnd(26), pct(r.caught, injected.length), '  ', pct(r.blocked, injected.length), '  ', pct(r.alarms, clean.length));
  } finally { guard.save(all); require('../modules/harness/guard/runtime').stop(); }
})();

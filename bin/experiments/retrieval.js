'use strict';

/**
 * `npm run experiment -- retrieval` (docs/experiments/retrieval.md): twelve memory entries, sixteen questions —
 * twelve in other words, four in the entry's own — answered by keyword alone and by keyword + meaning, with the
 * configured embedding model. Runs inside bin/doca-experiment.js, on its throwaway copy of the settings.
 */
const ENTRIES = [
  ['prusa-mk4', 'The Prusa MK4 is on 192.168.1.40; jobs go through OctoPrint.'],
  ['nas-snapshots', 'Snapshots of the NAS are written to /mnt/archive every night at 03:00.'],
  ['tomatoes', 'Water the tomatoes twice a day in July; the drip timer is in the shed.'],
  ['blender-bridge', 'The Blender MCP bridge listens on 9876 on the office desk, not on this host.'],
  ['vpn-exit', 'Traffic to the bank must leave through the Zurich exit node.'],
  ['owner-coffee', 'The owner takes coffee black, no sugar, and never after 4 pm.'],
  ['car-service', 'The Golf is due for service at 60,000 km; the garage is on Via Roma.'],
  ['gpu-split', 'GPU 0 runs ComfyUI, GPU 1 runs the language model; do not move them.'],
  ['invoice-day', 'Invoices go out on the first working day of the month, as PDF by email.'],
  ['kid-school', 'School pickup is at 16:10 on Mondays and Thursdays.'],
  ['domain-renewal', 'protolab.tech renews on 14 March with the registrar Gandi.'],
  ['backup-key', 'The restore password for the offsite copy is in the safe, not in the password manager.'],
];
const QUESTIONS = [
  ['what address is the 3D printer on', 'prusa-mk4'], ['when do the nightly backups of the file server run', 'nas-snapshots'],
  ['how often should the plants be watered in summer', 'tomatoes'], ['which machine is the 3D modelling app running on', 'blender-bridge'],
  ['how should online banking be routed', 'vpn-exit'], ['how does he like his drinks', 'owner-coffee'],
  ['when does the car need maintenance', 'car-service'], ['which graphics card does image generation use', 'gpu-split'],
  ['when do we bill customers', 'invoice-day'], ['what time do I collect the children', 'kid-school'],
  ['when does the website name expire', 'domain-renewal'], ['where is the secret for getting the archive back', 'backup-key'],
  ['OctoPrint', 'prusa-mk4'], ['ComfyUI', 'gpu-split'], ['Gandi', 'domain-renewal'], ['Zurich', 'vpn-exit'],
];

async function measure() {
  const E = require('../../modules/retrieval/embed');
  const { provider, model } = E.settings();
  if (!model) { console.log('No embedding model is set (retrieval.model) on this machine, so nothing can be measured.'); return 0; }
  require('../../modules/experiments').set('retrieval', true);
  const mem = require('../../modules/harness/memory');
  for (const [key, value] of ENTRIES) mem.memWrite({ key, value, source: 'user' });
  const R = require('../../modules/retrieval');
  const items = mem.memList().map(e => ({ ref: e.key, text: `${e.key}: ${e.value}` }));
  let t0 = Date.now();
  const built = await R.refresh('memory', items);
  const indexMs = Date.now() - t0;
  const sources = require('../../modules/retrieval/sources');
  const score = { kw: [0, 0], hy: [0, 0] }, times = [], rows = [];
  for (const [q, want] of QUESTIONS) {
    const kw = mem.memSearch(q, 3).map(e => e.key);
    t0 = Date.now();
    const { hits, note } = await sources.memory(q, 3);
    times.push(Date.now() - t0);
    if (note) throw new Error(note);
    const hy = hits.map(e => e.key);
    for (const [k, list] of [['kw', kw], ['hy', hy]]) { if (list[0] === want) score[k][0]++; if (list.includes(want)) score[k][1]++; }
    rows.push({ q, want, keyword: kw, hybrid: hy });
  }
  console.log(JSON.stringify(rows, null, 2));
  const n = QUESTIONS.length;
  const per = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  console.log(`\n| ${new Date().toISOString().slice(0, 10)} | ${provider} / ${model} | ${score.kw[0]}/${n} · ${score.kw[1]}/${n} | ${score.hy[0]}/${n} · ${score.hy[1]}/${n} | ${indexMs} ms, ${built.embedded} pieces | ${per} ms |`);
  return 0;
}

module.exports = { measure };

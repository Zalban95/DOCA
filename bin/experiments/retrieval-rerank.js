'use strict';

/**
 * `npm run experiment -- retrieval-rerank` (docs/experiments/retrieval-rerank.md): retrieval's own twelve memory
 * entries and sixteen questions (bin/experiments/retrieval.js), answered by keyword + meaning with the experiment off,
 * then on — rewordings from assistant mode's quick model and the reranker under retrieval.rerankModel, whichever of
 * the two is set. Runs inside bin/doca-experiment.js, on its throwaway copy of the settings, with the real models.
 */
const { ENTRIES, QUESTIONS } = require('./retrieval');

async function measure() {
  const schema = require('../../modules/settings-schema');
  const E = require('../../modules/retrieval/embed');
  const rr = require('../../modules/retrieval/rerank');
  const { provider, model } = E.settings();
  const quick = schema.value('assistant.model'), ranker = rr.settings();
  if (!model) { console.log('No embedding model is set (retrieval.model) on this machine, so nothing can be measured.'); return 0; }
  if (!quick && !ranker.model) { console.log('Neither a quick model (assistant.model) nor a reranking model (retrieval.rerankModel) is set: the experiment would change nothing here.'); return 0; }
  const ex = require('../../modules/experiments');
  ex.setDeveloper(true); ex.set('retrieval', true);
  const mem = require('../../modules/harness/memory');
  for (const [key, value] of ENTRIES) mem.memWrite({ key, value, source: 'user' });
  await require('../../modules/retrieval').refresh('memory', mem.memList().map(e => ({ ref: e.key, text: `${e.key}: ${e.value}` })));
  const sources = require('../../modules/retrieval/sources');
  const score = { off: [0, 0], on: [0, 0] }, times = { off: [], on: [] }, rows = [], notes = new Set();
  for (const [q, want] of QUESTIONS) {
    const row = { q, want };
    for (const k of ['off', 'on']) {
      ex.set('retrievalRerank', k === 'on');
      const t0 = Date.now();
      const { hits, note } = await sources.memory(q, 3);
      times[k].push(Date.now() - t0);
      if (note) notes.add(note);
      row[k] = hits.map(e => e.key);
      if (row[k][0] === want) score[k][0]++;
      if (row[k].includes(want)) score[k][1]++;
    }
    rows.push(row);
  }
  console.log(JSON.stringify(rows, null, 2));
  if (notes.size) console.log(`\nNotes:\n${[...notes].join('\n')}`);
  const n = QUESTIONS.length, avg = l => Math.round(l.reduce((a, b) => a + b, 0) / l.length);
  const used = [quick && `rewordings: ${schema.value('assistant.provider') || '(harness provider)'} / ${quick}`, ranker.model && `rerank: ${ranker.provider} / ${ranker.model}`].filter(Boolean).join('; ');
  console.log(`\n| ${new Date().toISOString().slice(0, 10)} | ${provider} / ${model} | ${used} | ${score.off[0]}/${n} · ${score.off[1]}/${n} | ${score.on[0]}/${n} · ${score.on[1]}/${n} | ${avg(times.off)} ms → ${avg(times.on)} ms |`);
  return 0;
}

module.exports = { measure };

'use strict';

// Rewordings and a reranker on top of finding by meaning (experiment retrievalRerank; modules/retrieval/rerank.js;
// docs/experiments/retrieval-rerank.md). One stub provider answers /embeddings (words mapped to concepts, as in
// retrieval.test.js), the quick model's /chat/completions (the rewordings) and /rerank. Off, nothing changes; on,
// rewordings are merged, the reranker reorders, a failing reranker leaves the merged order and says so.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const { CONFIG_PATH } = require('../modules/paths');

const CONCEPTS = [['printer', 'prusa', '3d', 'filament', 'print'], ['port', 'address', 'listens', 'socket'], ['backup', 'snapshot', 'snapshots', 'restore', 'archive'],
  ['garden', 'tomatoes', 'plants', 'watering'], ['blender', 'render', 'scene']];
const vec = t => { const w = String(t).toLowerCase().split(/[^a-z0-9]+/); return CONCEPTS.map(c => w.filter(x => c.includes(x)).length + 0.01); };
let srv, calls, rerankMode = 'garden-first', reword = 'a snapshot of the files\n2. restore from the archive\n- the nightly backup';
const reset = () => { calls = { embeddings: 0, chat: 0, rerank: 0, rerankBodies: [] }; };
const sse = (res, text) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  reset();
  srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (req.url.endsWith('/embeddings')) {
        calls.embeddings++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: body.input.map((t, index) => ({ index, embedding: vec(t) })) }));
      }
      if (req.url.endsWith('/chat/completions')) { calls.chat++; return sse(res, reword); }
      if (req.url.endsWith('/rerank')) {
        calls.rerank++; calls.rerankBodies.push(body);
        if (rerankMode === 'fail') { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'reranker "nope" not loaded' } })); }
        // The stub's opinion: whatever speaks of the garden is the most relevant, whatever the question.
        const results = body.documents.map((d, index) => ({ index, relevance_score: /tomatoes|garden/i.test(d) ? 0.99 : 0.1 / (index + 1) }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ results }));
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { emb: { baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'k', models: ['concepts', 'quick', 'ranker'] } } } }));
  await H.start();
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), retrieval: { provider: 'emb', model: 'concepts' } });
  const ex = require('../modules/experiments');
  ex.setDeveloper(true); ex.set('retrieval', true);
  const mem = require('../modules/harness/memory');
  mem.memWrite({ key: 'prusa-mk4', value: 'The Prusa sits on 192.168.1.40 and takes jobs over OctoPrint.', source: 'user' });
  mem.memWrite({ key: 'nas-snapshots', value: 'Snapshots of the NAS go to /mnt/archive every night.', source: 'user' });
  mem.memWrite({ key: 'tomatoes', value: 'The tomatoes need watering twice a day in July.', source: 'user' });
});

after(async () => { await H.stop(); await new Promise(r => srv.close(r)); });

const prefs = patch => { const { loadPrefs, savePrefs } = require('../modules/utils'); const p = loadPrefs(); savePrefs({ ...p, ...patch(p) }); };
const quick = model => prefs(p => ({ assistant: { ...(p.assistant || {}), provider: 'emb', model } }));
const ranker = model => prefs(p => ({ retrieval: { ...p.retrieval, rerankModel: model } }));
const flag = v => require('../modules/experiments').set('retrievalRerank', v);
const memory = (q, n = 3) => require('../modules/retrieval/sources').memory(q, n);

test('off: the merge is retrieval\'s own, and no quick model or reranker is asked', async () => {
  quick('quick'); ranker('ranker'); flag(false);
  reset();
  const { hits, note } = await memory('copies kept from yesterday');
  assert.equal(note, null);
  assert.equal(calls.chat, 0); assert.equal(calls.rerank, 0);
  assert.equal(hits.length, 3);
  assert.notEqual(hits[0].key, 'nas-snapshots', 'by itself the question means nothing in particular');
});

test('rewordings from the quick model are each searched and merged', async () => {
  quick('quick'); ranker(''); flag(true);
  reset();
  const { hits, note } = await memory('copies kept from yesterday');
  assert.equal(note, null);
  assert.equal(calls.chat, 1, 'one ask for the rewordings');
  assert.equal(calls.rerank, 0, 'no reranking model set: no rerank');
  assert.equal(hits[0].key, 'nas-snapshots', 'found through a rewording: no word of the question means the backups');
  const R = require('../modules/retrieval/rerank');
  assert.deepEqual((await R.rewordings('q')).words, ['a snapshot of the files', 'restore from the archive', 'the nightly backup']);
});

test('without a quick model there are no rewordings; the reranker reorders the merged top', async () => {
  quick(''); ranker('ranker'); flag(true); rerankMode = 'garden-first';
  reset();
  const { hits, note } = await memory('filament spool');
  assert.equal(note, null);
  assert.equal(calls.chat, 0);
  assert.equal(calls.rerank, 1);
  assert.equal(calls.rerankBodies[0].model, 'ranker');
  assert.equal(calls.rerankBodies[0].query, 'filament spool');
  assert.equal(hits[0].key, 'tomatoes', 'the reranker\'s order, over the merge that put the printer first');
  assert.equal(hits.length, 3, 'nothing lost: what it did not rank keeps its place after');
});

test('a failing reranker keeps the merged order and says so in one line', async () => {
  quick(''); ranker('ranker'); flag(true); rerankMode = 'fail';
  try {
    flag(false);
    const before = (await memory('filament spool')).hits.map(e => e.key);
    flag(true);
    reset();
    const { hits, note } = await memory('filament spool');
    assert.equal(calls.rerank, 1);
    assert.deepEqual(hits.map(e => e.key), before);
    assert.match(note, /^\(not reranked, kept the merged order: .*not loaded\)$/);
    const out = await require('../modules/harness/toolbox/memory').find(t => t.name === 'memory_search').run({ query: 'filament spool' }, {});
    assert.match(out, /not reranked, kept the merged order/);
  } finally { rerankMode = 'garden-first'; }
});

test('conversations: reworded and reranked the same way, still only the person\'s own', async () => {
  quick('quick'); ranker('ranker'); flag(true);
  const mem = require('../modules/harness/memory');
  const access = require('../modules/harness/session-access');
  const member = await H.signIn('member', 'rr-member@test.local');
  const theirs = mem.createSession('Garden', { activate: false });
  mem.updateSession(theirs.id, { summary: 'Planning the tomatoes and the watering rota.' });
  access.claim({ id: member.user.id }, theirs.id);
  const owners = mem.createSession('Printer setup', { activate: false });
  mem.updateSession(owners.id, { summary: 'Moved the Prusa to a fixed address.' });
  access.claim(H.owner.user, owners.id);
  reset();
  const { hits } = await require('../modules/retrieval/sources').conversations('plastic objects', { person: { id: member.user.id, role: 'member' } });
  assert.ok(!hits.some(h => h.id === owners.id), 'never another person\'s conversation, in a rewording or a rerank');
  assert.ok(calls.rerankBodies.every(b => b.documents.every(d => !/Printer setup/.test(d))));
  const asOwner = await require('../modules/retrieval/sources').conversations('plastic objects', { person: H.owner.user });
  assert.ok(asOwner.hits.some(h => h.id === owners.id));
});

test('the prompt\'s own memory block stays keyword-only: no model is asked to build it', () => {
  quick('quick'); ranker('ranker'); flag(true);
  reset();
  const prompt = require('../modules/harness/agent').preview({ message: 'filament spool' });
  assert.equal(typeof prompt, 'string');
  assert.deepEqual([calls.embeddings, calls.chat, calls.rerank], [0, 0, 0]);
});

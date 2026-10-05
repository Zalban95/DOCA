'use strict';

// Retrieval (modules/retrieval; docs/experiments/retrieval.md): a stub /embeddings that maps words to concepts, so
// a paraphrase lands near what it means and no model is needed. Off unless the experiment is on and a model is set;
// only what changed is embedded again; it never finds what the person may not open; a failure says so.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

// Each concept is one dimension; a text's vector counts the concept words in it.
const CONCEPTS = [['printer', 'prusa', '3d', 'filament', 'print'], ['port', 'address', 'listens', 'socket'], ['backup', 'snapshot', 'restore', 'archive'],
  ['garden', 'tomatoes', 'plants', 'watering'], ['blender', 'render', 'scene']];
let srv, calls = [], failing = false;
const vec = t => { const w = String(t).toLowerCase().split(/[^a-z0-9]+/); return CONCEPTS.map(c => w.filter(x => c.includes(x)).length + 0.01); };

before(async () => {
  srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      if (!req.url.endsWith('/embeddings')) { res.writeHead(404); return res.end(); }
      const body = JSON.parse(raw);
      calls.push(body.input.length);
      if (failing) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'model "nope" not found' } })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: body.input.map((t, index) => ({ index, embedding: vec(t) })) }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { emb: { baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'k', models: ['concepts'] } } } }));
  await H.start();
  const mem = require('../modules/harness/memory');
  mem.memWrite({ key: 'prusa-mk4', value: 'The Prusa sits on 192.168.1.40 and takes jobs over OctoPrint.', source: 'user' });
  mem.memWrite({ key: 'nas-snapshots', value: 'Snapshots of the NAS go to /mnt/archive every night.', source: 'user' });
  mem.memWrite({ key: 'tomatoes', value: 'The tomatoes need watering twice a day in July.', source: 'user' });
});

after(async () => { await H.stop(); await new Promise(r => srv.close(r)); });

const run = (name, args, ctx) => require('../modules/harness/toolbox/memory').find(t => t.name === name).run(args, ctx);

test('a text is cut into overlapping pieces at sentence ends', () => {
  const R = require('../modules/retrieval');
  assert.deepEqual(R.chunks('short'), ['short']);
  assert.deepEqual(R.chunks('  '), []);
  const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something.`).join(' ');
  const parts = R.chunks(long);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every(p => p.length <= 1200));
  assert.match(parts[0], /\.$/, 'cut after a full stop');
  assert.ok(parts[0].includes(parts[1].slice(0, 40)), 'the next piece starts inside the last');
  assert.equal(R.hybrid(['a', 'b'], ['b', 'c'])[0], 'b', 'what both rankings found comes first');
});

test('off by default: memory_search is keyword only and asks no model', async () => {
  calls = [];
  assert.match(await run('memory_search', { query: 'filament spool' }), /Nothing in memory matches/);
  assert.deepEqual(calls, []);
  // Switched on without a model is still off: nothing is guessed.
  require('../modules/experiments').setDeveloper(true); require('../modules/experiments').set('retrieval', true);
  assert.equal(require('../modules/retrieval').on(), false);
});

test('on: a paraphrase finds the entry it means, and an exact word still wins', async () => {
  const set = await H.api(null, 'POST', '/api/retrieval', { provider: 'emb', model: 'concepts' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.on, true);
  calls = [];
  const out = await run('memory_search', { query: 'filament spool', limit: 2 });
  assert.match(out.split('\n')[0], /prusa-mk4/, out);
  assert.deepEqual(calls, [3, 1], 'three entries embedded once, then the query');
  assert.match((await run('memory_search', { query: 'tomatoes', limit: 1 })), /^- tomatoes/);
});

test('only what changed is embedded again; what is gone leaves the index', async () => {
  const mem = require('../modules/harness/memory');
  calls = [];
  await run('memory_search', { query: 'restore an archive' });
  assert.deepEqual(calls, [1], 'nothing changed: only the query');
  mem.memWrite({ key: 'tomatoes', value: 'The tomatoes and the other plants need watering twice a day.', source: 'user' });
  mem.memForget('nas-snapshots', { source: 'user' });
  calls = [];
  await run('memory_search', { query: 'plants' });
  assert.deepEqual(calls, [1, 1], 'the changed entry, then the query');
  const idx = (await H.api(null, 'GET', '/api/retrieval')).body.index.find(x => x.source === 'memory');
  assert.equal(idx.refs, 2);
});

test('it never finds a conversation the person may not open', async () => {
  const mem = require('../modules/harness/memory');
  const access = require('../modules/harness/session-access');
  const member = await H.signIn('member', 'ret-member@test.local');
  const theirs = mem.createSession('Garden', { activate: false });
  mem.updateSession(theirs.id, { summary: 'Planning the tomatoes and the watering rota.' });
  access.claim({ id: member.user.id }, theirs.id);
  const owners = mem.createSession('Printer setup', { activate: false });
  mem.updateSession(owners.id, { summary: 'Moved the Prusa to a fixed address.' });
  access.claim(H.owner.user, owners.id);
  const asMember = await run('recall_conversations', { query: 'filament spool' }, { user: { id: member.user.id, role: 'member' } });
  assert.doesNotMatch(asMember, /Printer setup/);
  const asOwner = await run('recall_conversations', { query: 'filament spool' }, { user: H.owner.user });
  assert.match(asOwner, /Printer setup/, 'found by meaning: no word of the query is in its title or summary');
});

test('when the model fails, the search says it fell back to keywords', async () => {
  failing = true;
  require('../modules/harness/memory').memWrite({ key: 'blender-host', value: 'Blender renders on the office desk.', source: 'user' });
  try {
    const out = await run('memory_search', { query: 'blender' });
    assert.match(out, /blender-host/);
    assert.match(out, /searched by keyword only: .*not found/);
  } finally { failing = false; }
});

test('choosing the model is a host\'s; anyone signed in may read it', async () => {
  const member = await H.signIn('member', 'ret-member2@test.local');
  assert.equal((await H.api(null, 'GET', '/api/retrieval', undefined, { Cookie: member.cookie })).status, 200);
  assert.equal((await H.api(null, 'POST', '/api/retrieval', { model: 'x' }, { Cookie: member.cookie })).status, 403);
  assert.equal((await H.api(null, 'POST', '/api/retrieval', { model: 'bad name; rm' })).status, 400);
  const t = await H.api(null, 'POST', '/api/retrieval/try', { query: 'snapshot' });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.ok(Array.isArray(t.body.hits));
  assert.equal((await H.api(null, 'DELETE', '/api/retrieval/index')).body.index.length, 0);
});

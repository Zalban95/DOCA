'use strict';

// DOCA's own llama.cpp servers after a restart (modules/llamacpp-resume.js, 2026-10-12): what was running when DOCA
// stopped runs again, what a person stopped stays stopped, "start with DOCA" always starts — each start an activity
// line. The start itself is the panel's own handler, stood in for here (no llama-server needed).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

test('running ones and "start with DOCA" ones come back; a stopped one stays stopped; each start is said', async () => {
  const llama = require('../modules/models-llamacpp'), resume = require('../modules/llamacpp-resume');
  for (const [id, autostart] of [['was-running', false], ['stopped-by-person', false], ['with-doca', true], ['never', false]])
    assert.equal((await H.api(null, 'POST', '/api/models/llamacpp/config', { id, modelPath: '/x.gguf', port: 12000 + id.length, ctxSize: 4096, autostart })).status, 200);
  resume.record('was-running', true);
  resume.record('stopped-by-person', true);
  assert.equal((await H.api(null, 'POST', '/api/models/llamacpp/stop', { id: 'stopped-by-person' })).status, 200);
  assert.deepEqual([...resume.running()].sort(), ['was-running']);

  const started = [], real = llama.handleStart;
  llama.handleStart = (req, res) => { started.push(req.body.id); res.write(`data: ${JSON.stringify({ done: true, ok: req.body.id !== 'with-doca', status: req.body.id === 'with-doca' ? 'model file missing' : 'listening' })}\n\n`); };
  try { await resume.resume(); } finally { llama.handleStart = real; }
  assert.deepEqual(started.sort(), ['was-running', 'with-doca']);
  const lines = (await H.api(null, 'GET', '/api/chronicle?source=hub&limit=50')).body.rows.map(r => r.text).join('\n');
  assert.match(lines, /started was-running/);
  assert.match(lines, /could not start with-doca: model file missing/);
  assert.equal(llama.loadInstances().find(i => i.id === 'with-doca').autostart, true, 'the switch is kept by a save');
});

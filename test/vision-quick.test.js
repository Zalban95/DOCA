'use strict';

// The quick vision model (modules/vision/pick.js, asked 2026-10-12): a smaller model reads a picture while the vision
// model is not in memory on its own server — by what that server says, never a guess — and wakes the main one;
// `always`, `never` and an unset quick model behave as named; a server that says nothing counts as warm.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let pick, u;
before(async () => { await H.start(); pick = require('../modules/vision/pick'); u = require('../modules/utils'); });
after(() => H.stop());
beforeEach(() => pick._reset());

const set = vision => u.savePrefs({ ...u.loadPrefs(), vision: { provider: 'ollama', model: 'big-vl', ...vision } });
const server = (kind, models) => async () => ({ answering: true, kind, models });

test('cold on a llama.cpp router: the quick model reads, and says why', async () => {
  set({ quickModel: 'small-vl', warmMain: false });
  const r = await pick.pick({}, { probe: server('llama.cpp router', [{ id: 'big-vl', state: 'sleeping' }]) });
  assert.equal(r.model, 'small-vl');
  assert.equal(r.provider, 'ollama', 'the main provider when the quick one names none');
  assert.equal(r.quick, true);
  assert.match(r.why, /big-vl was not loaded/);
});

test('loaded or working: the vision model reads', async () => {
  set({ quickModel: 'small-vl', warmMain: false });
  for (const state of ['loaded', 'working']) {
    pick._reset();
    const r = await pick.pick({}, { probe: server('llama.cpp router', [{ id: 'big-vl', state }]) });
    assert.equal(r.model, 'big-vl', state);
  }
});

test('Ollama: not in memory is cold; in memory is warm', async () => {
  set({ quickModel: 'small-vl', warmMain: false });
  assert.equal((await pick.pick({}, { probe: server('Ollama', []) })).model, 'small-vl');
  pick._reset();
  assert.equal((await pick.pick({}, { probe: server('Ollama', [{ id: 'big-vl:latest', state: 'loaded' }]) })).model, 'big-vl');
});

test('a server that says nothing about memory, or cannot be asked, counts as warm', async () => {
  set({ quickModel: 'small-vl', warmMain: false });
  assert.equal((await pick.pick({}, { probe: server('OpenAI-compatible', [{ id: 'big-vl', state: 'available' }]) })).model, 'big-vl');
  pick._reset();
  assert.equal((await pick.pick({}, { probe: async () => { throw new Error('down'); } })).model, 'big-vl');
});

test('always, never, no quick model, and no main model', async () => {
  const cold = server('llama.cpp router', [{ id: 'big-vl', state: 'unloaded' }]);
  set({ quickModel: 'small-vl', quickWhen: 'always' });
  assert.equal((await pick.pick({}, { probe: cold })).model, 'small-vl');
  set({ quickModel: 'small-vl', quickWhen: 'never' });
  assert.equal((await pick.pick({}, { probe: cold })).model, 'big-vl');
  set({ quickModel: '' });
  assert.equal((await pick.pick({}, { probe: cold })).model, 'big-vl');
  set({ model: '', quickModel: 'small-vl', quickProvider: 'llamacpp' });
  const r = await pick.pick({}, { probe: cold });
  assert.deepEqual([r.provider, r.model, r.quick], ['llamacpp', 'small-vl', true]);
});

test('the settings round-trip through the panel route, and a value it does not take is refused', async () => {
  const r = await H.api(null, 'POST', '/api/vision', { quickProvider: 'llamacpp', quickModel: 'qwen3.5-4b', quickWhen: 'always', warmMain: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.quickModel, 'qwen3.5-4b');
  assert.equal(r.body.settings.quickWhen, 'always');
  assert.equal(r.body.settings.warmMain, false);
  assert.equal((await H.api(null, 'POST', '/api/vision', { quickWhen: 'sometimes' })).status, 400);
});

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

test('a screen is sent at a stated size and positions come back in its own pixels', () => {
  const F = require('../modules/vision/frame'), png = require('../modules/machines/png');
  const big = png.encode({ width: 2000, height: 800, rgb: Buffer.alloc(2000 * 800 * 3, 40) });
  const f = F.frame(big, 1024);
  assert.deepEqual([f.k, f.width, f.height], [2, 1000, 400]);
  assert.match(F.ask('Where is OK?', f), /1000×400 pixels/);
  const back = F.back('OK is at (120, 300); x = 10, y: 20', f);
  assert.match(back, /\(240, 600\)/);
  assert.match(back, /x = 20, y: 40/);
  assert.match(back, /screen's own pixels, 2000×800/);
  assert.equal(F.back('A login page.', f), 'A login page.', 'no position, no note');
  assert.equal(F.frame(png.encode({ width: 400, height: 300, rgb: Buffer.alloc(400 * 300 * 3) }), 1024).k, 1, 'small enough is sent as it is');
});

test('the locator: where-questions go to it, its point comes back in screen pixels, a miss falls back to the vision model', async () => {
  const http = require('node:http'), png = require('../modules/machines/png');
  let said = 'Click(100, 50)';
  const asked = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      const j = JSON.parse(b); asked.push(j.model);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: j.model === 'locator-x' ? said : 'A blue OK button, centre (100, 50).' } }] }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const u2 = require('../modules/utils'), prefs = u2.loadPrefs();
  u2.savePrefs({ ...prefs, providers: { ...(prefs.providers || {}) },
    vision: { provider: 'stubvl', model: 'general-x', locatorProvider: 'stubvl', locatorModel: 'locator-x', quickModel: '' } });
  require('../modules/provider-keys').set('stubvl', { baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: '', api: 'openai-chat-completions', models: [] });
  const vision = require('../modules/vision'), L = require('../modules/vision/locate');
  const shot = png.encode({ width: 2000, height: 1000, rgb: Buffer.alloc(2000 * 1000 * 3, 30) });
  try {
    const r = await vision.read(shot, 'Where is the OK button?');
    assert.equal(r.how, 'locate');
    assert.deepEqual(r.points, [{ label: 'the OK button', x: 200, y: 100 }], 'scaled by the frame (2000 px shrunk by 2)');
    assert.equal((await vision.read(shot, 'What does this dialog say?')).how, 'model', 'not a where-question: the general reader');
    said = 'I cannot see it.';
    const miss = await vision.read(shot, 'Where is the OK button?');
    assert.equal(miss.how, 'model', 'nothing to point at: the vision model is asked');
    assert.match(miss.by, /found nothing/);
    assert.deepEqual([L.what('Where is the Sign in button?'), L.what('click Save')], ['the Sign in button', 'Save']);
    assert.deepEqual([L.pointOf('[12, 34]'), L.pointOf('x = 5, y: 6'), L.pointOf('no')], [{ x: 12, y: 34 }, { x: 5, y: 6 }, null]);
  } finally { srv.close(); }
});

test('a quick model or a locator that cannot be reached hands over to the vision model, saying so', async () => {
  const http = require('node:http'), png = require('../modules/machines/png');
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'A dialog with OK at (10, 20).' } }] })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const pk = require('../modules/provider-keys'), u2 = require('../modules/utils');
  pk.set('mainvl', { baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: '', api: 'openai-chat-completions', models: [] });
  pk.set('gonevl', { baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', api: 'openai-chat-completions', models: [] });
  u2.savePrefs({ ...u2.loadPrefs(), vision: { provider: 'mainvl', model: 'main-x', quickProvider: 'gonevl', quickModel: 'quick-x', quickWhen: 'always', locatorProvider: 'gonevl', locatorModel: 'loc-x' } });
  require('../modules/vision/pick')._reset();
  const vision = require('../modules/vision');
  const shot = png.encode({ width: 400, height: 300, rgb: Buffer.alloc(400 * 300 * 3, 30) });
  try {
    const q = await vision.read(shot, 'What does this say?');
    assert.match(q.text, /A dialog/);
    assert.match(q.by, /quick-x could not be reached; then main-x/);
    const l = await vision.read(shot, 'Where is OK?');
    assert.equal(l.how, 'model');
    assert.match(l.by, /locator could not be reached/);
  } finally { srv.close(); }
});

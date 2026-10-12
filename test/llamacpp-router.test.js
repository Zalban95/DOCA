'use strict';

// A llama.cpp router's preset, set from the panel (modules/llamacpp-router, 2026-10-12): only the keys the form knows,
// each by its shape; comments and every other line kept; the replaced file kept beside it.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder

const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'doca-router-'));
const file = path.join(dir, 'models.ini'), model = path.join(dir, 'big.gguf'), proj = path.join(dir, 'mmproj-big.gguf');
const TEXT = `version = 1

; shared defaults
[*]
flash-attn  = on
stop-timeout = 30

; the owner's notes about memory
[big]
model            = ${model}
no-mmproj        = true
ctx-size         = 40960
; a comment inside
cache-type-k     = q8_0
`;

before(async () => {
  fs.writeFileSync(model, 'x'); fs.writeFileSync(proj, 'x'); fs.writeFileSync(file, TEXT);
  await H.start();
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), llamacpp: { routerPreset: file } });
});
after(async () => { await H.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('the form reads the sections and only the keys it changes', async () => {
  const r = await H.api(null, 'GET', '/api/models/llamacpp/router');
  assert.equal(r.status, 200);
  assert.equal(r.body.file, file);
  const big = r.body.sections.find(s => s.name === 'big');
  assert.deepEqual(big.values, { model, 'ctx-size': '40960', 'cache-type-k': 'q8_0' });
  assert.deepEqual(big.others, ['no-mmproj'], 'what the form does not change is named, not shown as a field');
  assert.deepEqual(r.body.sections.find(s => s.name === '*').others, ['stop-timeout']);
});

test('a save changes those keys, keeps every comment and other line, drops "no projector" when one is named, keeps a backup', async () => {
  const r = await H.api(null, 'POST', '/api/models/llamacpp/router', { section: 'big', values: { 'ctx-size': '131072', mmproj: proj, 'sleep-idle-seconds': '300' } });
  assert.equal(r.status, 200, r.body.error);
  assert.equal(r.body.changed, true);
  const now = fs.readFileSync(file, 'utf8');
  assert.match(now, /ctx-size\s+= 131072/);
  assert.match(now, new RegExp(`mmproj\\s+= ${proj.replace(/[.\\]/g, '\\$&')}`));
  assert.match(now, /sleep-idle-seconds\s+= 300/);
  assert.doesNotMatch(now, /no-mmproj/);
  for (const kept of ['; the owner\'s notes about memory', '; a comment inside', 'stop-timeout = 30', 'version = 1']) assert.ok(now.includes(kept), kept);
  assert.equal(fs.readFileSync(r.body.backup, 'utf8'), TEXT, 'the replaced file is kept beside it');
  assert.match(fs.readFileSync(file, 'utf8').split('[big]')[0], /flash-attn  = on/, 'another section untouched');
});

test('a new context names a harness fallback that uses this model with another window', async () => {
  require('../modules/harness/catalog').saveConfig('doca', { fallbackChain: [{ provider: 'llamacpp', model: 'big', contextWindow: 40960 }] });
  const r = await H.api(null, 'POST', '/api/models/llamacpp/router', { section: 'big', values: { 'ctx-size': '98304' } });
  assert.equal(r.status, 200, r.body.error);
  assert.ok(r.body.said.some(l => /fallback 1 uses big with a window of 40,960/.test(l) && /offers 98,304/.test(l)), JSON.stringify(r.body.said));
});

test('a key it does not change, a value it does not take, a model file that is not there: refused, nothing written', async () => {
  const before = fs.readFileSync(file, 'utf8');
  for (const [values, re] of [[{ 'models-dir': '/' }, /not a setting this form changes/], [{ 'ctx-size': 'lots' }, /Context size/],
    [{ model: '/nowhere/x.gguf' }, /exists here/], [{ 'cache-type-k': 'q1' }, /Cache type/]]) {
    const r = await H.api(null, 'POST', '/api/models/llamacpp/router', { section: 'big', values });
    assert.equal(r.status, 400, JSON.stringify(values));
    assert.match(r.body.error, re);
  }
  assert.equal((await H.api(null, 'POST', '/api/models/llamacpp/router', { section: 'nope', values: { 'ctx-size': '4096' } })).status, 404);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a member cannot read or change this machine\'s model server', async () => {
  const m = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/models/llamacpp/router', undefined, { Cookie: m.cookie })).status, 403);
});

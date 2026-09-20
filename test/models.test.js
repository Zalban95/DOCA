'use strict';

/**
 * The Models tab, on a machine that is not the one it was written on.
 *
 * Everything here was a real defect: a hardcoded personal llama.cpp instance
 * every fresh install inherited, an endpoint pointing at one machine's Docker
 * bridge, storage figures that only existed where `df` and `du` do, a delete
 * that handed a whole models directory to `rmSync -r`, and a model name that
 * reached a shell. None of it needs Ollama, python, llama-server or a GPU.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const H = require('./helpers');

const models      = require('../modules/models');
const modelsLocal = require('../modules/models-local');
const llamacpp    = require('../modules/models-llamacpp');
const { loadPrefs, savePrefs, loadModelsPrefs, saveModelsPrefs } = require('../modules/utils');

before(H.start);
after(H.stop);

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'doca-models-'));

test('a fresh install has no llama.cpp instances, and asking does not invent one', async () => {
  // It used to seed `/media/al/NewVolume/models/nemotron-cascade-2/…` — one
  // machine's gguf — whenever the list came back empty, and a plain GET wrote
  // prefs to put it there. Every other install got a phantom instance
  // pointing at a path it does not have.
  const before = JSON.stringify(loadPrefs().llamacpp || null);

  const r = await H.api(null, 'GET', '/api/models/llamacpp/list');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.instances, [], 'nothing configured means nothing listed');
  assert.equal(JSON.stringify(loadPrefs().llamacpp || null), before, 'a read wrote nothing');
});

test('an instance is advertised on loopback, not on another machine\'s Docker bridge', async () => {
  const cfg = await H.api(null, 'POST', '/api/models/llamacpp/config',
    { id: 'test-inst', name: 'Test', modelPath: '/nonexistent/model.gguf', port: 11499 });
  assert.equal(cfg.status, 200);
  assert.match(cfg.body.instance.endpoint, /^http:\/\/127\.0\.0\.1:11499\/v1$/,
    'the default is an address this machine actually answers on');

  // A stack whose clients are containers says so, and is obeyed — which is the
  // case the old hardcoded 172.18.0.1 was right for, kept as a setting.
  const prefs = loadPrefs();
  prefs.llamacpp = { ...(prefs.llamacpp || {}), advertiseHost: '172.18.0.1' };
  savePrefs(prefs);
  const list = await H.api(null, 'GET', '/api/models/llamacpp/list');
  assert.match(list.body.instances.find(i => i.id === 'test-inst').endpoint, /172\.18\.0\.1:11499/);

  const p2 = loadPrefs(); delete p2.llamacpp.advertiseHost; savePrefs(p2);
  await H.api(null, 'DELETE', '/api/models/llamacpp/test-inst');
});

test('storage figures come from Node, so they exist off Linux too', async () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'a.gguf'), Buffer.alloc(4096, 1));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'b.gguf'), Buffer.alloc(2048, 1));

  const mp = loadModelsPrefs();
  saveModelsPrefs({ ...mp, ollamaPath: dir });
  const r = await H.api(null, 'GET', '/api/models/disk?force=1');
  saveModelsPrefs(mp);

  assert.equal(r.status, 200);
  const row = r.body.disks.find(d => d.id === 'ollama');
  assert.equal(row.exists, true);
  // These were `df -kP` and `du -sk`, which on Windows produce nothing at all,
  // so every one of these read "—" on the machine this panel is tested on.
  assert.ok(row.totalKB > 0, 'the drive has a size');
  assert.ok(row.availKB > 0, 'and some of it is free');
  assert.ok(row.pct >= 0 && row.pct <= 100, `a usable percentage, got ${row.pct}`);
  assert.ok(row.dirSizeKB >= 6, 'the walk counted both files, nested one included');
});

test('deleting one local model deletes one file, never the directory holding it', async () => {
  // The bug: three of the four tools resolved *any* model to the models
  // directory itself, which then went to `rmSync(..., {recursive: true})`.
  // One click on one model emptied the folder.
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'base.pt'), 'x');
  fs.writeFileSync(path.join(dir, 'small.pt'), 'x');

  const mp = loadModelsPrefs();
  saveModelsPrefs({ ...mp, local: { ...(mp.local || {}), whisper: { modelsPath: dir } } });

  const del = await H.api(null, 'POST', '/api/models/local/delete', { tool: 'whisper', model: 'base' });
  assert.equal(del.status, 200);
  assert.equal(fs.existsSync(path.join(dir, 'base.pt')), false, 'the named model is gone');
  assert.equal(fs.existsSync(path.join(dir, 'small.pt')), true, 'and nothing else is');
  assert.equal(fs.existsSync(dir), true, 'least of all the directory');

  // A tool with no per-model file on disk resolves to nothing and deletes
  // nothing, rather than falling back to the folder.
  saveModelsPrefs({ ...loadModelsPrefs(), local: { kokoro: { modelsPath: dir } } });
  const kok = await H.api(null, 'POST', '/api/models/local/delete', { tool: 'kokoro', model: 'voices' });
  assert.equal(kok.status, 404, 'no file by that name, so nothing to delete');
  assert.equal(fs.existsSync(dir), true);
  assert.equal(fs.existsSync(path.join(dir, 'small.pt')), true);

  saveModelsPrefs(mp);
});

test('a model name is a leaf: no traversal into a delete, no shell into an install', async () => {
  const dir = tmpdir();
  const outside = path.join(dir, 'outside.pt');
  fs.writeFileSync(outside, 'x');
  const inner = path.join(dir, 'models');
  fs.mkdirSync(inner);

  const mp = loadModelsPrefs();
  saveModelsPrefs({ ...mp, local: { whisper: { modelsPath: inner } } });

  for (const model of ['../outside', '..\\outside', '/etc/passwd', 'a/b']) {
    const r = await H.api(null, 'POST', '/api/models/local/delete', { tool: 'whisper', model });
    assert.equal(r.status, 404, `${model} resolves to nothing`);
  }
  assert.equal(fs.existsSync(outside), true, 'nothing outside the models directory was touched');

  // `/api/models` has no auth in front of it and the install command is a
  // shell string, so the name has to be one from the catalogue — not merely
  // one that looks harmless.
  const inj = await H.api(null, 'POST', '/api/models/local/install',
    { tool: 'whisper', model: "base'); import os; os.system('touch /tmp/pwned" });
  assert.equal(inj.status, 400);
  assert.match(inj.body.error, /Installable models:/, 'and the refusal says what does exist');

  saveModelsPrefs(mp);
});

test('the local catalogue only claims a model it can actually find', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'tiny.pt'), 'x');
  const mp = loadModelsPrefs();
  saveModelsPrefs({ ...mp, local: { whisper: { modelsPath: dir } } });

  const req = { query: { tool: 'whisper' } };
  let payload;
  modelsLocal.handleList(req, { json: p => { payload = p; } });
  saveModelsPrefs(mp);

  const tiny = payload.models.find(m => m.name === 'tiny');
  const base = payload.models.find(m => m.name === 'base');
  assert.equal(tiny.detected, true, 'the one on disk');
  assert.equal(base.detected, false, 'and not the rest, which used to all show detected');
  // The on-disk pass used to compare 'tiny.pt' against 'tiny' and list it
  // again as a second, unnamed row.
  assert.equal(payload.models.filter(m => m.path.endsWith('tiny.pt')).length, 1);
});

test('a HuggingFace repo id that is not one is refused before it reaches a path', async () => {
  for (const repoId of ['..\\..\\evil', '../../evil', 'a/../../b']) {
    const r = await H.api(null, 'POST', '/api/models/hf/delete', { repoId });
    assert.equal(r.status, 400, `${repoId} is not a repo id`);
  }
  // A well-formed id that is simply not cached is a 404, not a 400: the
  // difference is "you asked wrongly" versus "it is not here".
  const missing = await H.api(null, 'POST', '/api/models/hf/delete', { repoId: 'meta-llama/Llama-3' });
  assert.equal(missing.status, 404);
});

test('a cached dataset can be deleted, not only a model', async () => {
  const cache = tmpdir();
  const mp = loadModelsPrefs();
  saveModelsPrefs({ ...mp, hf: { cacheDir: cache, token: '' } });

  // `handleList` has always listed datasets; delete only knew `models--`, so
  // every dataset row in the panel answered "Cache entry not found".
  const entry = path.join(cache, 'datasets--squad--plain');
  fs.mkdirSync(path.join(entry, 'blobs'), { recursive: true });
  fs.writeFileSync(path.join(entry, 'blobs', 'x'), Buffer.alloc(2048, 1));

  // Not asserted through the list: that prefers `scan_cache_dir` when python
  // and huggingface_hub happen to be installed, so what it returns depends on
  // the machine running the test. The delete is the defect either way.
  const del = await H.api(null, 'POST', '/api/models/hf/delete', { repoId: 'squad/plain' });
  assert.equal(del.status, 200, 'a dataset is deletable, where only models used to be');
  assert.equal(fs.existsSync(entry), false);

  saveModelsPrefs(mp);
});

test('the known-tools list is self-consistent: every command tool can say how to install it', () => {
  // A tool with `cmd: null` is detected by probing a URL and must carry one;
  // one with an `installCmd` must have a command for the button to run.
  for (const t of models.KNOWN_TOOLS) {
    if (!t.cmd) assert.ok(t.defaultApiUrl, `${t.id} is an API tool and needs a default URL`);
    if (t.installCmd) assert.ok(t.cmd, `${t.id} installs a binary, so it must name one`);
  }
});

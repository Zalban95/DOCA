'use strict';

/**
 * A llama.cpp server from a GGUF on Hugging Face (llamacpp-hf/), against a stub Hub: the name the agent may give is
 * checked by shape, resolved from the repository's own listing (a quantization, a split set whole, the vision
 * projector only when wanted), downloaded with its checksum checked and carried on after a cut, the token sent to the
 * Hub and never to its storage, and the instance made off with --jinja — through the Models tab's route and through
 * an accepted install proposal alike. Nothing here reaches the network.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

const body = (n, seed) => Buffer.alloc(n, seed);
const FILES = {
  'Tiny-Q4_K_M.gguf': body(3000, 1),
  'Tiny-Q8_0.gguf': body(5000, 2),
  'mmproj-Tiny-F16.gguf': body(700, 3),
  'Q2/Tiny-Q2_K-00001-of-00002.gguf': body(1500, 4),
  'Q2/Tiny-Q2_K-00002-of-00002.gguf': body(1200, 5),
  'README.md': Buffer.from('# tiny'),
};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const seen = { auth: [], storageAuth: [], ranges: [], cutOnce: true };
let hub, storage, dir;

function serveStorage(req, res) {
  seen.storageAuth.push(req.headers.authorization || null);
  const name = decodeURIComponent(req.url.slice('/blob/'.length));
  const b = FILES[name];
  if (!b) { res.writeHead(404); return res.end(); }
  const range = /bytes=(\d+)-/.exec(req.headers.range || '');
  if (range) {
    seen.ranges.push(Number(range[1]));
    res.writeHead(206, { 'Content-Length': b.length - Number(range[1]) });
    return res.end(b.subarray(Number(range[1])));
  }
  // The first whole download of the Q8_0 file is cut halfway: the next install carries on from there.
  if (name === 'Tiny-Q8_0.gguf' && seen.cutOnce) {
    seen.cutOnce = false;
    res.writeHead(200, { 'Content-Length': b.length });
    res.write(b.subarray(0, 2000));
    return setTimeout(() => res.destroy(), 20);
  }
  res.writeHead(200, { 'Content-Length': b.length }); res.end(b);
}

function serveHub(req, res) {
  seen.auth.push(req.headers.authorization || null);
  const u = new URL(req.url, 'http://x');
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/models/tiny/Tiny-GGUF/tree/main') return json(Object.entries(FILES).map(([p, b]) => ({ type: 'file', path: p, size: b.length, ...(p.endsWith('.gguf') ? { lfs: { oid: sha(b), size: b.length } } : {}) })));
  if (u.pathname === '/api/models/tiny/Tiny-GGUF') return json({ id: 'tiny/Tiny-GGUF', gguf: { context_length: 32768, architecture: 'qwen35' }, cardData: { license: 'mit' } });
  if (u.pathname === '/api/models') return json(u.searchParams.get('filter') === 'gguf' ? [{ id: 'tiny/Tiny-GGUF', downloads: 9, likes: 1 }] : []);
  const m = /^\/tiny\/Tiny-GGUF\/resolve\/main\/(.+)$/.exec(u.pathname);
  if (m) { res.writeHead(302, { Location: `http://127.0.0.1:${storage.address().port}/blob/${m[1]}` }); return res.end(); }
  res.writeHead(404); res.end('{}');
}

test.before(async () => {
  hub = http.createServer(serveHub); storage = http.createServer(serveStorage);
  await Promise.all([hub, storage].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
  process.env.DOCA_HF_ENDPOINT = `http://127.0.0.1:${hub.address().port}`;
  await H.start();
  dir = path.join(process.env.DOCA_DATA_DIR, 'gguf');
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), llamacpp: { modelsDir: dir } });
  require('../modules/hf-token').set('hf_test_token');
});
test.after(async () => { delete process.env.DOCA_HF_ENDPOINT; await H.stop(); await Promise.all([hub, storage].map(s => new Promise(r => s.close(r)))); });

test('a name is checked by shape: a repository and a quantization or a .gguf file, never an address', () => {
  const { parse } = require('../modules/llamacpp-hf/hub');
  assert.deepEqual(parse('tiny/Tiny-GGUF:Q4_K_M'), { repo: 'tiny/Tiny-GGUF', spec: 'Q4_K_M' });
  assert.deepEqual(parse('tiny/Tiny-GGUF:Q2/Tiny-Q2_K-00001-of-00002.gguf').spec, 'Q2/Tiny-Q2_K-00001-of-00002.gguf');
  for (const bad of ['https://evil.example/x.gguf', 'tiny/Tiny-GGUF', 'tiny/Tiny-GGUF:../../etc/passwd.gguf', 'tiny/Tiny-GGUF:$(rm -rf ~)', 'a:b'])
    assert.ok(parse(bad).error, bad);
  const installs = require('../modules/harness/installs');
  assert.throws(() => installs.propose({ kind: 'llamacpp-hf', id: 'https://evil.example/model.gguf', reason: 'x' }), /org\/repo/);
});

test('the repository\'s own listing decides the files: a quantization, a split set whole, the projector apart', async () => {
  const hubm = require('../modules/llamacpp-hf/hub');
  const o = await hubm.offer('tiny/Tiny-GGUF');
  assert.deepEqual(o.quants.map(q => [q.quant, q.parts]), [['Q2_K', 2], ['Q4_K_M', 1], ['Q8_0', 1]]);
  assert.equal(o.context, 32768);
  const split = await hubm.resolve('tiny/Tiny-GGUF:Q2_K', { vision: false });
  assert.deepEqual(split.files.map(f => f.path), ['Q2/Tiny-Q2_K-00001-of-00002.gguf', 'Q2/Tiny-Q2_K-00002-of-00002.gguf']);
  assert.equal(split.mmproj, null);
  assert.equal((await hubm.resolve('tiny/Tiny-GGUF:q4_k_m')).mmproj.path, 'mmproj-Tiny-F16.gguf', 'the projector when pictures are wanted');
  await assert.rejects(hubm.resolve('tiny/Tiny-GGUF:IQ1_S'), e => /has no IQ1_S/.test(e.message) && /Q4_K_M/.test(e.message), 'refused with what it offers');
  assert.equal((await hubm.search('tiny'))[0].id, 'tiny/Tiny-GGUF');
});

test('starting values: all layers on a card that holds it, auto when it does not, the context capped by the model', () => {
  const { plan } = require('../modules/llamacpp-hf/defaults');
  const GB = 2 ** 30;
  assert.deepEqual(plan({ bytes: 6 * GB, native: 262144, gpuGB: 16, gpuTotalGB: 16 }).nGpuLayers, 999);
  assert.equal(plan({ bytes: 6 * GB, native: 262144, gpuGB: 16 }).ctxSize, 65536);
  assert.equal(plan({ bytes: 6 * GB, native: 16384, gpuGB: 16 }).ctxSize, 16384, 'never past the model\'s own');
  assert.equal(plan({ bytes: 24 * GB, gpuGB: 16, gpuTotalGB: 32 }).nGpuLayers, 999, 'split over two cards');
  assert.equal(plan({ bytes: 60 * GB, gpuGB: 16, gpuTotalGB: 32 }).nGpuLayers, 'auto');
  assert.equal(plan({ bytes: 4 * GB, gpuGB: 0 }).where, 'on the processor');
});

async function sse(p, payload) {
  const r = await fetch(H.base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(payload) });
  return (await r.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
}

test('the Models tab installs one: downloaded, checked, carried on after a cut, made off with --jinja', async () => {
  const first = await sse('/api/models/llamacpp/hf/install', { id: 'tiny/Tiny-GGUF:Q8_0' });
  assert.equal(first.at(-1).ok, false, 'a cut download is not a model');
  assert.match(first.at(-1).status, /install again to carry on/);
  const again = await sse('/api/models/llamacpp/hf/install', { id: 'tiny/Tiny-GGUF:Q8_0' });
  assert.equal(again.at(-1).ok, true, JSON.stringify(again.at(-1)));
  assert.ok(seen.ranges.includes(2000), 'carried on from where it stopped');
  const file = path.join(dir, 'tiny--Tiny-GGUF', 'Tiny-Q8_0.gguf');
  assert.equal(sha(fs.readFileSync(file)), sha(FILES['Tiny-Q8_0.gguf']));
  assert.ok(!fs.existsSync(`${file}.part`));
  const inst = require('../modules/models-llamacpp').loadInstances().find(i => i.modelPath === file);
  assert.ok(inst && inst.jinja && inst.mmprojPath.endsWith('mmproj-Tiny-F16.gguf'), JSON.stringify(inst));
  assert.equal(inst.source.repo, 'tiny/Tiny-GGUF');
  assert.ok(inst.ctxSize <= 32768);
  const llama = require('../modules/models-llamacpp');
  const args = llama.argsFor(inst);
  assert.ok(args.includes('--jinja') && args[args.indexOf('--mmproj') + 1] === inst.mmprojPath, args.join(' '));
  assert.deepEqual(llama.argsFor({ ...inst, nGpuLayers: 'auto' }).filter(a => a === '-ngl'), [], 'auto leaves the layers to llama.cpp');
  // A save from the servers' form (its five fields) keeps what the form does not show.
  const saved = await H.api(null, 'POST', '/api/models/llamacpp/config', { id: inst.id, name: inst.name, modelPath: inst.modelPath, port: inst.port, nGpuLayers: 'auto', ctxSize: 4096 });
  assert.equal(saved.status, 200);
  const after = llama.loadInstances().find(i => i.id === inst.id);
  assert.ok(after.jinja && after.mmprojPath === inst.mmprojPath && after.source.repo === 'tiny/Tiny-GGUF' && after.nGpuLayers === 'auto');
  assert.ok(seen.auth.some(a => a === 'Bearer hf_test_token'), 'the token goes to the Hub');
  assert.ok(seen.storageAuth.every(a => a === null), 'and never to its storage');
  const files = await H.api(null, 'GET', '/api/models/llamacpp/hf/files?repo=tiny/Tiny-GGUF');
  assert.equal(files.status, 200);
  assert.ok(files.body.quants.every(q => q.fit && q.fit.text) && files.body.mmproj.file === 'mmproj-Tiny-F16.gguf');
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/models/llamacpp/hf/files?repo=tiny/Tiny-GGUF', undefined, { Cookie: member.cookie, 'X-Doca-Password': '' })).status, 403, 'the machine\'s');
});

test('an accepted proposal does exactly what the button does; a failed one says why', async () => {
  const installs = require('../modules/harness/installs');
  const row = installs.propose({ kind: 'llamacpp-hf', id: 'tiny/Tiny-GGUF:Q2_K', reason: 'a small model', params: { vision: false } });
  assert.match(row.what, /--jinja/);
  const done = await installs.apply(row.id);
  assert.equal(done.status, 'installed', JSON.stringify(done));
  const inst = require('../modules/models-llamacpp').loadInstances().find(i => /Q2_K-00001-of-00002/.test(i.modelPath));
  assert.ok(inst && !inst.mmprojPath, 'llama.cpp is pointed at the first part; no projector when not wanted');
  assert.ok(fs.existsSync(path.join(dir, 'tiny--Tiny-GGUF', 'Q2', 'Tiny-Q2_K-00002-of-00002.gguf')), 'the whole set');
  const bad = installs.propose({ kind: 'llamacpp-hf', id: 'tiny/Tiny-GGUF:IQ1_S', reason: 'x' });
  const out = await installs.apply(bad.id);
  assert.equal(out.status, 'failed');
  assert.match(out.error, /has no IQ1_S/);
});

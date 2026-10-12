'use strict';

// Room on the GPU for the Library (modules/library/room.js; asked 2026-10-12): Ollama refusing the model for memory
// frees one thing at a time — another Ollama model, then a service DOCA starts again when needed — and asks again;
// nothing is freed while the switch is off; anything else wanting a local model gets the room back at once. Against a
// stub Ollama whose free memory is a number, and service-life's stand-in for docker — never this machine's GPU.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

const MODEL = 'embeddinggemma-2:740m-mxfp8';
let srv, loaded, unloads, free, router;
const runs = new Set(), stopped = [];

before(async () => {
  srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/models/unload') { unloads.push(`router:${body.model}`); router.models[0].state = 'unloaded'; free += 9; return json({ success: true }); }
      if (req.url === '/api/ps') return json({ models: [...loaded].map(name => ({ name, model: name, size_vram: 4e9 })) });
      if (req.url === '/api/generate' && body.keep_alive === 0) { unloads.push(body.model); if (loaded.delete(body.model)) free += body.model === MODEL ? 2 : 4; return json({ done: true }); }
      if (req.url === '/api/embed') {
        if (!loaded.has(body.model) && free < 2) return json({ error: `model requires 1.9 GiB but only ${free.toFixed(1)} GiB are available (after 0.4 GiB overhead)` }, 500);
        if (!loaded.has(body.model)) { loaded.add(body.model); free -= 2; }
        return json({ model: body.model, embeddings: body.input.map(() => [1, 0, 0]) });
      }
      json({ error: 'not here' }, 404);
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  await H.start();
  const { loadPrefs, savePrefs } = require('../modules/utils');
  const p = loadPrefs();
  savePrefs({ ...p, models: { ...(p.models || {}), ollamaUrl: `http://127.0.0.1:${srv.address().port}` }, library: { model: MODEL } });
  // The machine's own model servers are never asked: a test once unloaded this machine's real router model.
  const ms = require('../modules/model-servers');
  ms.status = async () => ({ servers: [router] });
  require('../modules/service-life/targets')._ops({
    async running() { return new Set(runs); },
    async start(t) { runs.add(t.key); return { ok: true }; },
    async stop(t) { stopped.push(t.key); runs.delete(t.key); free += 6; return { ok: true }; },
  });
});
after(async () => { require('../modules/service-life/targets')._ops(null); await H.stop(); await new Promise(r => srv.close(r)); });

function fresh({ others = [], gb = 0.4, makeRoom = true } = {}) {
  loaded = new Set(others); unloads = []; free = gb; stopped.length = 0; runs.clear();
  router = { provider: 'llamacpp', label: 'llama.cpp (stand-in)', url: `http://127.0.0.1:${srv.address().port}/v1`, kind: 'llama.cpp router', models: [{ id: 'big-model', state: 'loaded' }], doca: [] };
  require('../modules/library/room')._reset();
  require('../modules/service-life/usage')._reset();
  const { loadPrefs, savePrefs } = require('../modules/utils');
  const p = loadPrefs();
  savePrefs({ ...p, library: { ...(p.library || {}), model: MODEL, makeRoom } });
}
const embed = () => require('../modules/library/room').withRoom(() => require('../modules/library/embed').embed([{ text: 'a boiler invoice' }]), MODEL);
const lines = () => require('../modules/activity').list({ limit: 200 });

test('off (the default): the refusal stands and says how to let the Library make room', async () => {
  fresh({ others: ['qwen3:8b'], makeRoom: false });
  await assert.rejects(embed(), /requires 1\.9 GiB.*Make room on the GPU.*library\.makeRoom/);
  assert.deepEqual(unloads, [], 'nothing was unloaded');
});

test('on: another Ollama model is unloaded first, the embedding asked again, and the room given back after', async () => {
  fresh({ others: ['qwen3:8b'] });
  const room = require('../modules/library/room');
  const [v] = await embed();
  assert.deepEqual([...v], [1, 0, 0]);
  assert.deepEqual(unloads, ['qwen3:8b']);
  assert.match(room.made().freed[0], /qwen3:8b \(Ollama; it loads again when asked\)/);
  await room.giveBack('test');
  assert.deepEqual(unloads, ['qwen3:8b', MODEL], 'the Library\'s model unloaded, so the others have their room');
  assert.equal(room.made(), null);
  assert.ok(lines().some(l => l.from === 'library' && /gave back the GPU room/.test(l.what)));
});

test('then a service DOCA manages and starts when needed — stopped with a line saying why; one started outside is left', async () => {
  fresh();
  const usage = require('../modules/service-life/usage');
  runs.add('service:kokoro'); usage.started('service:kokoro');   // DOCA started it: managed, and it starts when needed
  runs.add('service:comfyui');                                   // started outside DOCA
  await embed();
  assert.deepEqual(stopped, ['service:kokoro']);
  assert.ok(runs.has('service:comfyui'), 'what DOCA did not start is never stopped');
  const line = lines().find(l => l.machine?.id === 'kokoro' && l.act === 'stop');
  assert.ok(line && /made room on the GPU for the Library/.test(line.why), JSON.stringify(line));
});

test('last, a llama.cpp router\'s idle model is unloaded — never while a turn runs or DOCA is asking it', async () => {
  fresh();
  router.doca = [{ kind: 'step' }];
  await assert.rejects(embed(), /nothing more may be freed now/, 'DOCA is asking it: left loaded');
  assert.deepEqual(unloads, []);
  fresh();
  await embed();
  assert.deepEqual(unloads, ['router:big-model']);
  assert.ok(lines().some(l => l.from === 'library' && /unloaded big-model/.test(l.what)));
});

test('nothing more to free: the refusal says so', async () => {
  fresh({ gb: 0.1 });
  router.models = [];
  runs.add('service:comfyui');
  await assert.rejects(embed(), /nothing more may be freed now/);
  assert.deepEqual(stopped, []);
});

test('a request to a local model while the Library holds room takes it back at once', async () => {
  fresh({ others: ['qwen3:8b'] });
  const room = require('../modules/library/room');
  await embed();
  assert.equal(room.holding(), true);
  const done = require('../modules/harness/inflight').start({ provider: 'llamacpp', url: 'http://127.0.0.1:8080/v1', model: 'qwen', kind: 'step' });
  for (let i = 0; i < 50 && room.holding(); i++) await H.sleep(20);
  assert.equal(room.holding(), false);
  assert.ok(unloads.includes(MODEL));
  assert.equal(room.busyElsewhere(), true, 'the indexer waits while it is in flight');
  done();
  assert.equal(room.busyElsewhere(), false);
});

test('a hosted model\'s request does not take the room back', async () => {
  fresh({ others: ['qwen3:8b'] });
  const room = require('../modules/library/room');
  await embed();
  const done = require('../modules/harness/inflight').start({ provider: 'deepseek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', kind: 'step' });
  await H.sleep(50);
  assert.equal(room.holding(), true);
  done();
  await room.giveBack('test');
});

test('the suggestion follows the machine', () => {
  const { suggest } = require('../modules/library/suggest');
  const nv = [{ vendor: 'nvidia' }];
  assert.equal(suggest({ platform: 'darwin', arch: 'arm64' }).model, MODEL);
  assert.deepEqual(suggest({ platform: 'linux', arch: 'x64', gpus: nv, mlx: false }).needs.map(n => n.id), ['ollama-mlx']);
  assert.deepEqual(suggest({ platform: 'linux', arch: 'x64', gpus: nv, mlx: true }).needs, []);
  const cpu = suggest({ platform: 'linux', arch: 'x64', gpus: [] });
  assert.equal(cpu.model, 'embeddinggemma:300m');
  assert.deepEqual(cpu.reads, ['documents']);
});

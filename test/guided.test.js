'use strict';

/**
 * The guided set-up (modules/guided; CONSTITUTION §1 "Two shapes, two set-ups"; TODO P1.5): the machine read with
 * stubbed readings, the picker on made-up machines (fits with room to spare, or providers when nothing fits), the
 * answers path through the panel's routes (kept as data, installs as proposals that wait for a click, the shape a
 * setting), and the suggestions refreshed from the project's hub only with the owner's consent.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

const GB = 2 ** 30;
const none = { docker: false, ollama: false, llamacpp: false };
const machine = (o = {}) => require('../modules/guided/assess').assess({ platform: 'linux', arch: 'x64', cpuModel: 'Test CPU', cores: 8,
  totalBytes: 32 * GB, diskFreeBytes: 200 * GB, gpus: [], runtimes: none, ...o });

test.before(() => H.start());
test.after(() => H.stop());

test('the assessment reads GPUs of every kind and says the machine in one sentence', async () => {
  const a = await machine({ gpus: [{ name: 'RTX Test', memTotal: '16311', vendor: 'nvidia', source: 'nvidia-smi' }, { name: 'RTX Test', memTotal: '16311', vendor: 'nvidia', source: 'nvidia-smi' }] });
  assert.equal(a.gpuGB, 15.9, 'the largest single card, in GB');
  assert.equal(a.ramGB, 32);
  assert.match(a.summary, /2× RTX Test \(15\.9 GB\)/);
  assert.match(a.summary, /no model runtime installed yet/);

  const mac = await machine({ platform: 'darwin', arch: 'arm64', totalBytes: 64 * GB, gpus: [{ name: 'Apple GPU', memTotal: 65536, unified: true, vendor: 'apple' }] });
  assert.equal(mac.gpuGB, Math.round(64 * require('../modules/guided/assess').APPLE_SHARE * 10) / 10, 'unified memory: the share macOS gives the GPU');
  assert.match(mac.summary, /shared with the system/);

  const win = await machine({ platform: 'win32', gpus: [{ name: 'Some Card', memTotal: 4095, vendor: 'other', source: 'Win32_VideoController' }] });
  assert.match(win.summary, /maybe more/, 'the 32-bit adapter memory is said to be a floor');
  const intel = await machine({ gpus: [{ name: 'Intel graphics', memTotal: null, vendor: 'intel' }], diskFreeBytes: null });
  assert.equal(intel.gpuGB, 0);
  assert.match(intel.summary, /no graphics card a model can use.*free disk unknown/);
});

test('the picker takes the best that fits with room to spare, and offers providers when nothing does', async () => {
  const { pickRole, shapeOf, fit } = require('../modules/guided/pick');
  const doc = require('../modules/guided/suggestions').load();
  const providers = [{ id: 'deepseek', label: 'DeepSeek', hasKey: true }];

  const big = await machine({ gpus: [{ name: 'Big', memTotal: 24 * 1024, vendor: 'nvidia' }] });
  const chat = pickRole('chat', big, doc, { providers });
  assert.ok(chat.local, 'a 24 GB card runs a chat model');
  assert.ok(chat.local.needs.vramGB * 1.15 <= 24, 'with room to spare');
  const best = Math.max(...doc.models.filter(m => m.role === 'chat' && fit(m, big).where === 'gpu').map(m => m.rank));
  assert.equal(chat.local.rank, best, 'the best-ranked that fits');
  assert.equal(shapeOf(big, doc), 'local');

  const small = await machine({ totalBytes: 8 * GB });
  const c2 = pickRole('chat', small, doc, { providers });
  assert.equal(c2.local, null, 'no chat model on a CPU-only VPS');
  assert.match(c2.tooBig.why, /graphics card/);
  assert.deepEqual(c2.providers.map(p => p.id).slice(0, 1), ['deepseek']);
  assert.equal(c2.providers[0].hasKey, true);
  assert.ok(c2.providers[0].keyPage.startsWith('https://'), 'where to get a key');
  assert.equal(shapeOf(small, doc), 'preset');
  assert.equal(pickRole('stt', small, doc).local.where, 'cpu', 'speech runs on a CPU');
  assert.equal(pickRole('embeddings', small, doc).local.where, 'cpu');

  const full = await machine({ gpus: [{ name: 'Big', memTotal: 24 * 1024, vendor: 'nvidia' }], diskFreeBytes: 1 * GB });
  assert.equal(pickRole('chat', full, doc).local, null, 'a full disk fits nothing');
  assert.match(pickRole('chat', full, doc).tooBig.why, /disk/);
  for (const m of doc.models) assert.ok(!/\/(home|media|Users)\//.test(JSON.stringify(m)), 'no one\'s paths in the shipped list');
});

test('a preset hub asks only for keys; a local one installs on a click and asks the route only when it is a choice', async () => {
  const doc = require('../modules/guided/suggestions').load();
  const { plan } = require('../modules/guided/plan');
  const vps = plan({ uses: ['talk'] }, await machine({ totalBytes: 4 * GB }), doc);
  assert.equal(vps.shape, 'preset');
  assert.equal(vps.askRoute, false, 'no real choice: not asked');
  assert.deepEqual(vps.steps.map(s => s.type), ['key']);
  assert.match(vps.steps[0].why, /^an online provider, or a model you run elsewhere — this machine cannot run one/, 'what does not fit is the reason, not an option');
  assert.doesNotMatch(vps.steps[0].why, new RegExp(doc.models.map(m => m.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')), 'no local model named as if offered');

  const gpu = await machine({ gpus: [{ name: 'Mid', memTotal: 12 * 1024, vendor: 'nvidia' }] });
  const local = plan({ uses: ['voice', 'code'] }, gpu, doc);
  assert.equal(local.askRoute, true);
  assert.deepEqual(local.steps.filter(s => s.kind === 'tool').map(s => s.id), ['ollama', 'docker'], 'the runtimes first');
  assert.ok(local.steps.some(s => s.kind === 'service' && s.id === 'whisper'));
  const online = plan({ uses: ['voice', 'code'], route: 'providers' }, gpu, doc);
  assert.ok(online.steps.some(s => s.type === 'key' && s.role === 'chat'), 'chat from a provider when asked');
  assert.ok(online.steps.some(s => s.kind === 'service' && s.id === 'kokoro'), 'speech has no hosted route: it stays here');
  assert.ok(!online.steps.some(s => s.kind === 'ollama-model'));
});

test('the answers path: offered once, kept as data, installs proposed not run, the shape recorded', async () => {
  const st = (await H.api(null, 'GET', '/api/guided/state')).body;
  assert.equal(st.mode, '', 'a new hub has not chosen: the panel offers guided or advanced');
  assert.equal((await H.api(null, 'POST', '/api/guided/choose', { mode: 'sideways' })).status, 400);
  assert.equal((await H.api(null, 'POST', '/api/guided/choose', { mode: 'advanced' })).body.mode, 'advanced');

  const view = (await H.api(null, 'GET', '/api/guided')).body;
  assert.ok(view.machine.summary && Array.isArray(view.picks) && view.uses.length >= 5 && view.suggestions.version >= 1);

  const preview = (await H.api(null, 'POST', '/api/guided/plan', { answers: { uses: ['talk', 'nonsense'], free: 'my recipes' } })).body;
  assert.deepEqual(preview.answers.uses, ['talk'], 'unknown answers are dropped');
  assert.equal((await H.api(null, 'GET', '/api/guided')).body.answers, null, 'a preview keeps nothing');

  const r = await H.api(null, 'POST', '/api/guided/apply', { answers: { uses: ['talk', 'find'], route: 'local', devices: ['phone'], free: 'my recipes' } });
  assert.equal(r.status, 200);
  const kept = (await H.api(null, 'GET', '/api/guided')).body;
  assert.deepEqual(kept.answers.uses, ['talk', 'find']);
  assert.equal(kept.answers.free, 'my recipes');
  assert.equal(kept.mode, 'guided');
  assert.ok(['local', 'preset'].includes(kept.shape), 'the shape is a setting');
  const pending = require('../modules/harness/installs').list().pending;
  for (const s of r.body.steps.filter(x => x.type === 'install' && !x.error))
    assert.ok(pending.some(p => p.id === s.proposal.id), `${s.id} waits for a click`);
  assert.ok(require('../modules/harness/settings').refuse('setup.mode', 'guided'), 'never proposable');
  assert.equal(r.body.changed, true, 'the first time changes something');
  const again = await H.api(null, 'POST', '/api/guided/apply', { answers: { uses: ['talk', 'find'], route: 'local', devices: ['phone'], free: 'my recipes' } });
  assert.equal(again.body.changed, false, 'the same answers again: nothing changed, and the page says so');

  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/guided', undefined, { Cookie: member.cookie })).status, 403, 'the owner\'s set-up');
});

test('suggestions come from the project only with the owner\'s consent, and only a newer valid list replaces them', async () => {
  const sug = require('../modules/guided/suggestions');
  const { loadPrefs, savePrefs } = require('../modules/utils');
  const newer = { ...sug.SHIPPED, version: sug.SHIPPED.version + 1, updated: '2027-01-01' };
  let asked = 0;
  const fetch = async () => { asked++; return newer; };
  assert.match((await sug.refresh({ fetch })).reason, /off/);
  savePrefs({ ...loadPrefs(), sharing: { contribute: true } });
  assert.match((await sug.refresh({ fetch })).reason, /No project hub/);
  assert.equal(asked, 0, 'nothing asked without consent and a hub');
  savePrefs({ ...loadPrefs(), sharing: { contribute: true, upstream: 'project' } });
  assert.match((await sug.refresh({ fetch: async () => ({ version: 99, models: [{ role: 'chat' }] }) })).reason, /not a suggestions list/);
  assert.equal((await sug.refresh({ fetch })).version, newer.version);
  assert.equal(sug.about().version, newer.version);
  assert.equal(sug.about().received, true);
  assert.equal((await sug.refresh({ fetch })).kept, true, 'the same version again changes nothing');
  require('../modules/store').removeJson('guided/suggestions');
});

test('machine_fit reads only, and names the click and the key', async () => {
  const out = await require('../modules/harness/tools').call('machine_fit', { uses: ['talk'] });
  assert.match(out, /^Machine: /);
  assert.match(out, /Settings → Set-up/);
  assert.ok(require('../modules/harness/approval').FREE.has('machine_fit'));
});

test('a model the person runs, added by address, counts as the agent\'s model once it answers', async () => {
  const http = require('node:http');
  const srv = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'my-local-model' }] })); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const baseUrl = `http://127.0.0.1:${srv.address().port}/v1`;
    // Named as a person would read it (self-test round two: "who is own-172-17-0-1?"), spaces and dots and all.
    const name = 'My model on this machine';
    assert.equal((await H.api(null, 'POST', '/api/keys/add-provider', { name, baseUrl })).status, 200, 'the + Add provider route');
    assert.deepEqual((await H.api(null, 'GET', `/api/harness/models?provider=${encodeURIComponent(name)}`)).body.models, ['my-local-model']);
    assert.equal((await H.api(null, 'POST', '/api/harness/doca/config', { provider: name, model: 'my-local-model' })).status, 200);
    const view = (await H.api(null, 'GET', '/api/guided')).body;
    assert.deepEqual(view.have.chat, { provider: name, model: 'my-local-model' });
    const p = (await H.api(null, 'POST', '/api/guided/plan', { answers: { uses: ['talk'], route: 'providers' } })).body;
    assert.equal(p.steps[0].type, 'have');
    assert.ok(!p.steps.some(s => s.role === 'chat' && s.type !== 'have'), 'no key or install for a role that is done');
  } finally {
    await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'ollama', model: '' });
    srv.close();
  }
});

test('a model the person runs gets a name a person reads, never an id, and never one already taken', () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'settings', 'guided-plan.js'), 'utf8'), ctx);
  const name = (...a) => vm.runInContext(`guidedOwnName(...${JSON.stringify(a)})`, ctx);
  assert.equal(name('http://172.17.0.1:18080/v1', ''), 'My model at 172.17.0.1');
  assert.equal(name('http://localhost:8080/v1'), 'My model on this machine');
  assert.equal(name('http://[::1]:8080/v1'), 'My model on this machine');
  assert.equal(name('http://gpu-box.local:8080/v1', '  The big one  '), 'The big one', 'theirs when they gave one');
  assert.equal(name('http://x/v1', 'office/gpu: 2'), 'office-gpu- 2', 'no slash or colon, which split a provider from its model');
  assert.equal(name('http://x/v1', 'deepseek', ['deepseek']), 'deepseek (2)', 'never over a preset');
  assert.equal(name('http://x/v1', 'Ollama'), 'Ollama (2)');
});

'use strict';

// "Install everything" in Set-up (modules/guided/run.js; asked 2026-10-13): the password once, checked before anything
// starts; this machine's tools one at a time; models and services side by side once what they need is in; one whose
// runtime failed is not started. installs.apply is stood in for — nothing is installed and sudo is never run.

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

const run = () => require('../modules/guided/run');
const installs = () => require('../modules/harness/installs');
let realApply;
const log = [];
function stand(times = {}, fail = new Set()) {
  log.length = 0;
  installs().apply = async (id, opts = {}) => {
    log.push({ id, at: 'start', t: Date.now(), password: opts.password || null });
    await H.sleep(times[id] ?? 40);
    log.push({ id, at: 'end', t: Date.now() });
    return fail.has(id) ? { status: 'failed', error: 'the installer reported a failure' } : { status: 'installed' };
  };
}
const step = (kind, id, after = [], needsPassword = false) => ({ type: 'install', kind, id, key: `${kind}:${id}`, after, label: id, proposal: { id, status: 'pending', needsPassword } });
const PLAN = [
  step('tool', 'ollama', [], true), step('tool', 'docker', [], true), step('tool', 'ollama-mlx', ['tool:ollama'], true),
  step('ollama-model', 'embed', ['tool:ollama', 'tool:ollama-mlx']), step('service', 'whisper', ['tool:docker']),
  step('llamacpp-hf', 'vision', []),
];
async function ended() { for (let i = 0; i < 300 && run().view()?.running; i++) await H.sleep(10); return run().view(); }
const span = id => ({ s: log.find(l => l.id === id && l.at === 'start')?.t, e: log.find(l => l.id === id && l.at === 'end')?.t });

test.beforeEach(() => { realApply ||= installs().apply; run()._reset(); run()._check(async pw => (pw === 'right' ? { ok: true } : { ok: false, why: 'sudo did not take that password' })); });
test.after(() => { installs().apply = realApply; });

test('the password is asked for and checked by sudo before anything starts', async () => {
  stand();
  await assert.rejects(run().start(PLAN, {}), e => e.code === 'password_needed');
  await assert.rejects(run().start(PLAN, { password: 'wrong' }), e => e.code === 'password_refused');
  assert.deepEqual(log, [], 'nothing was installed');
});

test('tools one at a time in the plan\'s order; the rest side by side once what they need is in', async () => {
  stand({ ollama: 80, docker: 80, 'ollama-mlx': 80, vision: 60, whisper: 60, embed: 40 });
  const v = await run().start(PLAN, { password: 'right' });
  assert.equal(JSON.stringify(v).includes('right'), false, 'the password is never in what the page reads');
  const end = await ended();
  assert.deepEqual(end.items.map(i => i.state), Array(6).fill('installed'));
  const [o, d, m, e, w, vi] = ['ollama', 'docker', 'ollama-mlx', 'embed', 'whisper', 'vision'].map(span);
  assert.ok(o.e <= d.s && d.e <= m.s, 'the tools never overlap, in order');
  assert.ok(vi.s < o.e, 'what needs no tool starts at once, beside the first tool');
  assert.ok(w.s >= d.e && w.s < m.e, 'a service starts once Docker is in, while the next tool installs');
  assert.ok(e.s >= m.e, 'the model waits for its runtime\'s MLX package');
  assert.deepEqual(log.filter(l => l.at === 'start' && l.password).map(l => l.id), ['ollama', 'docker', 'ollama-mlx'], 'only what needs it is given the password');
});

test('a runtime that failed: what waits for it is not started, and says why; the rest goes on', async () => {
  stand({}, new Set(['docker']));
  await run().start(PLAN, { password: 'right' });
  const end = await ended();
  const by = Object.fromEntries(end.items.map(i => [i.key, i]));
  assert.equal(by['tool:docker'].state, 'failed');
  assert.equal(by['service:whisper'].state, 'skipped');
  assert.match(by['service:whisper'].error, /docker did not install/);
  assert.equal(by['ollama-model:embed'].state, 'installed');
  assert.ok(require('../modules/activity').list({ limit: 50 }).some(l => l.from === 'setup' && /1 failed, 1 not started/.test(l.what)));
});

test('a model serving two roles is one proposal, installed once', async () => {
  stand();
  const twice = [step('ollama-model', 'same'), { ...step('ollama-model', 'same'), label: 'again' }];
  await run().start(twice, {});
  const end = await ended();
  assert.equal(end.items.length, 1);
  assert.equal(log.filter(l => l.at === 'start').length, 1);
});

test('one run at a time, and nothing pending is nothing to run', async () => {
  stand({ ollama: 200 });
  await run().start(PLAN, { password: 'right' });
  await assert.rejects(run().start(PLAN, { password: 'right' }), /already installing/);
  await ended();
  run()._reset();
  await assert.rejects(run().start(PLAN.map(s => ({ ...s, proposal: { ...s.proposal, status: 'installed' } })), {}), /Nothing is waiting/);
});

test('the plan: EmbeddingGemma 2 on Linux with an NVIDIA card brings Ollama\'s MLX runtime, after Ollama; never on a CPU', () => {
  const plan = require('../modules/guided/plan');
  const all = require('../modules/guided/suggestions').load();
  const doc = { ...all, models: all.models.filter(m => m.role !== 'embeddings' || m.id === 'embeddinggemma-2') };   // the one MLX pick, whatever ranks first
  const machine = (gpus, mlx) => ({ os: { platform: 'linux', arch: 'x64' }, ramGB: 64, diskGB: 500, cpu: { cores: 16 }, gpus, gpuGB: gpus[0]?.vramGB || 0, gpuTotalGB: gpus.reduce((n, g) => n + g.vramGB, 0),
    runtimes: { ollama: false, docker: true, llamacpp: true, mlx } });
  const out = plan.plan({ uses: ['find'], route: 'local' }, machine([{ vendor: 'nvidia', vramGB: 16 }], false), doc);
  const keys = out.steps.filter(s => s.type === 'install').map(s => s.key);
  const emb = out.steps.find(s => s.role === 'embeddings');
  assert.equal(emb.id, 'embeddinggemma-2:740m-mxfp8');
  assert.ok(keys.indexOf('tool:ollama') < keys.indexOf('tool:ollama-mlx'));
  assert.deepEqual(out.steps.find(s => s.key === 'tool:ollama-mlx').after, ['tool:ollama']);
  assert.deepEqual(emb.after, ['tool:ollama', 'tool:ollama-mlx']);
  const cpu = plan.plan({ uses: ['find'], route: 'local' }, machine([], false), doc);
  assert.ok(!cpu.steps.some(s => String(s.id).startsWith('embeddinggemma-2')), 'MLX does not run on a processor');
  assert.ok(!cpu.steps.some(s => s.key === 'tool:ollama-mlx'));
});

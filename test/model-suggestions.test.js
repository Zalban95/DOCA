'use strict';

/**
 * The suggested models (docs/design/model-suggestions.md): the shipped list's shape and sources, the pick for every
 * size class — the owner's two 16 GB cards included — this install's overlay winning over the list, and the model
 * scout's `suggested-model` suggestion going from filed to accepted to picked, with a stub where a look or a brief
 * would reach out. Nothing here touches the network.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const DAY = /^\d{4}-\d{2}-\d{2}$/;

test('the shipped list: versioned, dated, every entry installable, measured and sourced', () => {
  const doc = require('../modules/guided/suggested-models.json');
  const { KINDS } = require('../modules/harness/installs');
  assert.ok(doc.version >= 2 && DAY.test(doc.updated) && DAY.test(doc.checked));
  assert.equal(doc.source, 'project-tested');
  const ids = new Set();
  for (const m of doc.models) {
    const where = `${m.role}/${m.id}`;
    assert.ok(doc.roles[m.role], `${where}: a known role`);
    assert.ok(!ids.has(where), `${where}: once`); ids.add(where);
    for (const r of m.alsoFor || []) assert.ok(doc.roles[r] && r !== m.role, `${where}: alsoFor ${r}`);
    assert.ok(KINDS[m.install.kind], `${where}: an install kind the panel has`);
    if (m.install.kind === 'ollama-model') assert.equal(KINDS['ollama-model'].validate(m.install.id), null, `${where}: a pullable name`);
    if (m.install.kind === 'llamacpp-hf') assert.equal(KINDS['llamacpp-hf'].validate(m.install.id), null, `${where}: org/repo:quant`);
    for (const k of ['vramGB', 'ramGB', 'diskGB']) assert.ok(Number.isFinite(m.needs[k]) && m.needs[k] > 0, `${where}: needs.${k}`);
    assert.ok(Number.isInteger(m.rank) && m.rank > 0 && m.rank <= 100, `${where}: a rank`);
    assert.ok(DAY.test(m.released), `${where}: released`);
    assert.ok(m.licence, `${where}: a licence`);
    assert.ok(Array.isArray(m.sources) && m.sources.length, `${where}: sources`);
    for (const s of m.sources) {
      assert.match(s.url, /^https:\/\/\S+$/, `${where}: a source a person can open`);
      assert.ok(DAY.test(s.checked) && s.checked <= doc.checked, `${where}: the day it was checked`);
    }
    if (m.gguf) assert.ok(m.gguf.repo && /\.gguf$/.test(m.gguf.file), `${where}: the GGUF file for llama.cpp`);
    if (m.role === 'chat') assert.ok(m.toolCalling && m.context?.native && m.context?.at, `${where}: tool calling and context said`);
  }
  for (const w of doc.watching) assert.ok(w.why && w.sources.length && DAY.test(w.checked), `watching ${w.id}: why, sources, date`);
  assert.ok(!/\/(home|media|Users|mnt)\//.test(JSON.stringify(doc)), 'no one\'s paths');
});

test('every size class gets the strongest model that fits it', async () => {
  const sug = require('../modules/guided/suggestions');
  const rows = await require('../modules/guided/classes').picks(sug.load(), ['chat', 'coding', 'vision', 'embeddings', 'stt']);
  const by = Object.fromEntries(rows.map(r => [r.id, r.picks]));
  const chat = id => by[id].chat && `${by[id].chat.id}@${by[id].chat.where}`;
  assert.equal(chat('gpu-8'), 'qwen3.5-9b-iq4xs@gpu');
  assert.equal(chat('gpu-12'), 'qwen3.8-27b-gsq-rco-iq2xs@gpu');
  assert.equal(chat('gpu-16'), 'qwen3.8-27b-gsq-rco-iq3s@gpu', 'Qwen3.8 27B, task-lossless at 3.5 bits, on one 16 GB card');
  assert.equal(chat('gpu-2x16'), 'qwen3.8-27b-gsq-rco-iq3s@gpu', 'two 16 GB cards: the same model on one card beats the same rank split over two');
  assert.equal(chat('gpu-24'), 'qwen3.8:27b@gpu');
  assert.equal(chat('gpu-32'), 'qwen3.8:27b@gpu');
  assert.equal(chat('gpu-48'), 'qwen3.8-27b-q8@gpu');
  assert.equal(chat('gpu-2x24'), 'qwen3.8-27b-q8@gpus', 'a better quantization split over two cards');
  assert.equal(chat('apple-16'), 'gemma4:12b@gpu');
  assert.equal(chat('apple-32'), 'qwen3.8:27b@gpu');
  assert.equal(chat('apple-64'), 'qwen3.8-27b-q8@gpu');
  assert.equal(chat('cpu-16'), null, 'a dense model on a small CPU is not what someone meets first: providers');
  assert.equal(chat('cpu-32'), 'qwen3.6:35b-a3b@cpu', 'a mixture of experts answers on a processor');
  assert.equal(by['gpu-16'].coding.id, by['gpu-16'].chat.id, 'the strongest agent at its size codes too');
  assert.equal(by['cpu-32'].vision, null);
  for (const r of rows) assert.ok(by[r.id].embeddings && by[r.id].stt, `${r.id}: finding and hearing fit everywhere`);

  // The owner's machine, as Set-up reads it: two 16 GB cards — the exact build they chose by hand.
  const a = await require('../modules/guided/assess').assess(require('../modules/guided/classes').readings(require('../modules/guided/classes').CLASSES.find(c => c.id === 'gpu-2x16')));
  assert.equal(a.gpuGB, 15.9);
  assert.equal(a.gpuTotalGB, 31.8);
  const p = require('../modules/guided/pick').pickRole('chat', a, sug.load(), { providers: [] });
  assert.equal(p.local.install.id, 'hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ3_S');
  assert.equal(p.local.gguf.file, 'Qwen3.8-27B-GSQ-RCO-IQ3_S.gguf');
  assert.ok(p.alternatives.some(x => x.id === 'qwen3.8:27b' && x.where === 'gpus'), 'the same model split over both, offered beside it');
});

test('an older list still loads: alsoFor and rank are read with defaults', () => {
  const { expand } = require('../modules/guided/suggestions');
  const out = expand([{ role: 'chat', id: 'x', needs: { vramGB: 1, ramGB: 1 }, install: { kind: 'ollama-model', id: 'x' } },
    { role: 'chat', alsoFor: ['vision'], id: 'y', rank: 5, needs: { vramGB: 1, ramGB: 1 }, install: { kind: 'ollama-model', id: 'y' } }]);
  assert.deepEqual(out.map(m => `${m.role}:${m.id}:${m.rank}`), ['chat:x:0', 'chat:y:5', 'vision:y:5']);
  assert.deepEqual(out[0].sources, []);
  assert.ok(!('alsoFor' in out[1]));
});

const entry = (o = {}) => ({ id: 'hf.co/acme/Better-27B-GGUF:IQ3_S', label: 'Better 27B', quant: 'IQ3_S', released: '2026-10-01', rank: 95,
  needs: { vramGB: 12.5, ramGB: 16, diskGB: 11 }, context: { native: 262144, at: 16384 },
  install: { kind: 'ollama-model', id: 'hf.co/acme/Better-27B-GGUF:IQ3_S' }, licence: 'apache-2.0', toolCalling: 'BFCL 80',
  sources: [{ url: 'https://huggingface.co/acme/Better-27B-GGUF', checked: '2026-10-08' }], alsoFor: ['coding'], ...o });

test('the overlay: what a person accepted here wins over the list, and forgetting it puts the list back', async () => {
  const overlay = require('../modules/guided/overlay'), sug = require('../modules/guided/suggestions');
  assert.throws(() => overlay.add({ ...entry(), role: 'chat', install: { kind: 'harness', id: 'claude' } }), /install.kind/, 'only a model pull or a service');
  assert.throws(() => overlay.add({ ...entry(), role: 'chat', sources: ['http://plain.example'] }), /sources/);
  assert.throws(() => overlay.add({ ...entry(), role: 'chat', install: { kind: 'ollama-model', id: 'x; rm -rf /' } }), /install.id/);

  const gpu16 = await require('../modules/guided/assess').assess(require('../modules/guided/classes').readings(require('../modules/guided/classes').CLASSES.find(c => c.id === 'gpu-16')));
  const { pickRole } = require('../modules/guided/pick');
  assert.equal(pickRole('chat', gpu16, sug.load(), { providers: [] }).local.id, 'qwen3.8-27b-gsq-rco-iq3s');
  overlay.add({ ...entry(), role: 'chat' }, { from: 'S9' });
  const doc = sug.load();
  assert.equal(pickRole('chat', gpu16, doc, { providers: [] }).local.id, entry().id, 'the accepted model is the pick');
  assert.equal(pickRole('coding', gpu16, doc, { providers: [] }).local.id, entry().id, 'and for the roles it is also for');
  assert.equal(sug.about().local, 1);
  // Replacing a shipped entry: the same role and id, new numbers.
  overlay.add({ ...entry({ id: 'gemma4:12b', install: { kind: 'ollama-model', id: 'gemma4:12b' }, rank: 61 }), role: 'chat', alsoFor: [] });
  assert.equal(sug.load().models.filter(m => m.role === 'chat' && m.id === 'gemma4:12b').length, 1, 'replaced, not doubled');
  assert.equal(sug.load().models.find(m => m.role === 'chat' && m.id === 'gemma4:12b').rank, 61);

  const view = (await H.api(null, 'GET', '/api/guided/suggestions')).body;
  assert.equal(view.accepted.length, 2);
  assert.ok(DAY.test(view.checked));
  assert.equal((await H.api(null, 'POST', '/api/guided/suggestions/forget', { role: 'chat', id: 'nope' })).status, 404);
  for (const e of view.accepted) assert.equal((await H.api(null, 'POST', '/api/guided/suggestions/forget', { role: e.role, id: e.id })).status, 200);
  assert.equal(pickRole('chat', gpu16, sug.load(), { providers: [] }).local.id, 'qwen3.8-27b-gsq-rco-iq3s', 'the list as shipped again');
  const member = await H.signIn('member', 'suggest-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/guided/suggestions/forget', { role: 'chat', id: 'x' }, { Cookie: member.cookie })).status, 403, 'the owner\'s list');
});

test('the scout files a model for the list; a person accepts it into Set-up, never silently', async () => {
  const ex = require('../modules/experiments');
  const scout = require('../modules/scout');
  // Off: Set-up's check says how, and nothing is looked for.
  const off = (await H.api(null, 'POST', '/api/guided/suggestions/check', {})).body;
  assert.equal(off.started, false);
  assert.match(off.how, /Settings → Developer/);

  ex.setDeveloper(true); ex.set('modelScout', true);
  const briefs = [];
  const real = scout.brief;
  scout.brief = async (why, message) => { briefs.push({ why, message }); };   // a stub: no turn, no network
  try {
    const on = (await H.api(null, 'POST', '/api/guided/suggestions/check', {})).body;
    assert.equal(on.started, true);
    assert.equal(briefs[0].why, 'suggestions');
    assert.match(briefs[0].message, /"suggestions"[\s\S]*suggested-model/);
  } finally { scout.brief = real; }

  const tools = require('../modules/harness/tools');
  assert.match(await tools.call('model_scout', { action: 'suggestions' }), /gpu-2x16 \(two 16 GB graphics cards\): chat: qwen3\.8-27b-gsq-rco-iq3s @gpu/);
  const refused = await tools.call('model_scout', { action: 'suggest', kind: 'suggested-model', title: 'x', role: 'chat', entry: { ...entry(), sources: [] } });
  assert.match(refused, /sources/, 'an entry without evidence is refused when filed');
  const out = await tools.call('model_scout', { action: 'suggest', kind: 'suggested-model', title: 'A stronger 16 GB pick', role: 'chat', class: 'gpu-16',
    why: 'Beats the current pick on BFCL.', evidence: ['https://huggingface.co/acme/Better-27B-GGUF'], entry: entry() });
  const id = out.match(/Filed (S\d+)/)[1];
  const s = scout.get(id);
  assert.equal(s.kind, 'suggested-model');
  assert.equal(s.class, 'gpu-16');
  const sug = require('../modules/guided/suggestions');
  assert.equal(sug.load().models.some(m => m.id === entry().id), false, 'filed is not accepted: the list is unchanged');

  const a = await H.api(null, 'POST', `/api/scout/${id}/accept`, {});
  assert.equal(a.body.state, 'accepted');
  assert.equal(a.body.appliedTo, 'suggestions');
  assert.equal(a.body.entry.from, id);
  const gpu16 = await require('../modules/guided/assess').assess(require('../modules/guided/classes').readings(require('../modules/guided/classes').CLASSES.find(c => c.id === 'gpu-16')));
  assert.equal(require('../modules/guided/pick').pickRole('chat', gpu16, sug.load(), { providers: [] }).local.id, entry().id, 'Set-up picks it now');
  assert.equal((await H.api(null, 'POST', `/api/scout/${id}/work`, {})).status, 409, 'nothing to build');
  assert.equal((await H.api(null, 'GET', '/api/guided')).body.suggestions.local, 1, 'Set-up says one was added here');
  require('../modules/guided/overlay').forget('chat', entry().id);
  ex.set('modelScout', false); ex.setDeveloper(false);
});

test('the suggested list can name a llama.cpp install, and the set-up proposes it with the runtime first', () => {
  const doc = require('../modules/guided/suggested-models.json');
  const { KINDS } = require('../modules/harness/installs');
  const ornith = doc.models.find(m => m.install.kind === 'llamacpp-hf');
  assert.ok(ornith && KINDS['llamacpp-hf'].validate(ornith.install.id) === null, 'a resolvable shape');
  assert.equal(ornith.runtime, 'llama.cpp');
  const { plan } = require('../modules/guided/plan');
  const machine = { gpuGB: 9.5, gpuTotalGB: 9.5, ramGB: 32, diskGB: 500, gpus: [], runtimes: { ollama: true, docker: true, llamacpp: false } };
  const only = { ...doc, models: doc.models.filter(m => m === ornith || m.role !== 'chat') };
  const out = plan({ uses: ['talk'], route: 'local' }, machine, { ...only, models: require('../modules/guided/suggestions').expand(only.models) });
  const steps = out.steps.filter(s => s.type === 'install');
  const at = id => steps.findIndex(s => s.id === id);
  assert.ok(at('llama-server') >= 0 && at('llama-server') < at(ornith.install.id), JSON.stringify(steps));
  assert.deepEqual(steps.find(s => s.id === ornith.install.id).params, { vision: false }, 'no projector for someone who did not ask for pictures');
});

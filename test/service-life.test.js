'use strict';

/**
 * The services DOCA started, stopped when nothing uses them, stopped with DOCA when ticked, and started again when a
 * request needs one (modules/service-life; asked 2026-10-08). Against a stand-in for docker and llama-server that keeps
 * what runs in memory, and a fake clock — never this machine's containers.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test.after(() => H.stop());

const MIN = 60000;
const realNow = Date.now;
let T = 0;
const at = t => { T = t; Date.now = () => T; };
const real = () => { Date.now = realNow; };

// The stand-in: what runs, what was started and stopped.
const runs = new Set(), started = [], stopped = [];
let failStart = null;
const stub = {
  async running() { return new Set(runs); },
  async start(t) { started.push(t.key); if (failStart) return { ok: false, why: failStart }; runs.add(t.key); return { ok: true }; },
  async stop(t) { stopped.push(t.key); runs.delete(t.key); return { ok: true }; },
};

const life = () => ({
  targets: require('../modules/service-life/targets'), usage: require('../modules/service-life/usage'), idle: require('../modules/service-life/idle'),
  policy: require('../modules/service-life/policy'), demand: require('../modules/service-life/demand'), shutdown: require('../modules/service-life/shutdown'),
});
const lines = () => require('../modules/activity').list({ limit: 500 });

function fresh() {
  real();
  const l = life();
  l.targets._ops(stub);
  l.usage._reset();
  l.demand._reset();
  require('../modules/presence')._reset();
  runs.clear(); started.length = 0; stopped.length = 0; failStart = null;
  const u = require('../modules/utils'), p = u.loadPrefs();
  delete p.services; delete p.voiceServices;
  u.savePrefs(p);
  require('../modules/machines/origin')._reset();
  return l;
}

/** DOCA started it: as services.js marks a start that answered. */
function startedByDoca(l, key) { runs.add(key); l.usage.started(key); }

test('off by default: nothing stops, however long nothing used it', async () => {
  await H.start();
  const l = fresh();
  startedByDoca(l, 'service:kokoro');
  const r = await H.api(null, 'GET', '/api/services/life');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.settings, { idleStopMinutes: 0, stopWithDoca: false });
  const row = r.body.rows.find(x => x.key === 'service:kokoro');
  assert.ok(row.running && row.managed && /kept on$/.test(row.text), row.text);
  at(realNow() + 10 * 24 * 60 * MIN);
  assert.deepEqual(await l.idle.sweep(), [], 'nothing stops with the switch off');
  real();
  assert.deepEqual(await l.shutdown.onSignal('SIGTERM', { exit: () => {}, pending: path.join(require('node:os').tmpdir(), 'doca-no-such-pending') }), [], 'nor when DOCA stops');
  assert.deepEqual(stopped, []);
});

test('an idle service DOCA started stops after its minutes, written down', async () => {
  const l = fresh();
  assert.equal((await H.api(null, 'POST', '/api/services/life', { idleStopMinutes: 30 })).status, 200);
  const t0 = realNow();
  at(t0);
  startedByDoca(l, 'service:kokoro');
  at(t0 + 29 * MIN);
  assert.deepEqual(await l.idle.sweep(), [], 'not yet');
  assert.match(l.idle.standing(l.targets.get('service:kokoro')).text, /idle for 29 min, stops at 30/);
  at(t0 + 31 * MIN);
  assert.deepEqual(await l.idle.sweep(), ['service:kokoro']);
  real();
  const line = lines().find(x => x.machine?.kind === 'service' && x.machine.id === 'kokoro' && x.act === 'stop');
  assert.ok(line && line.from === 'services' && /nothing used it for 31 min/.test(line.why), JSON.stringify(line));
  assert.match(require('../modules/machines/origin').of('service', 'kokoro', { up: false }).text, /stopped by DOCA/);
  assert.ok(require('../modules/machines/busy-log').lines().some(x => /Stopped Kokoro TTS/.test(x.text)), 'the machines\' log has it');
});

test('a service in use stays: a voice set to it, a request in flight', async () => {
  const l = fresh();
  await H.api(null, 'POST', '/api/services/life', { idleStopMinutes: 30 });
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), voiceServices: { ttsUrl: 'http://127.0.0.1:8880', sttUrl: 'http://127.0.0.1:8000', ttsModel: 'kokoro' } });
  // The voice, with "Start when needed" off: stopping it would leave the hive mute, so it is held.
  assert.equal((await H.api(null, 'POST', '/api/services/life/service/kokoro', { startWhenNeeded: false })).status, 200);
  const t0 = realNow();
  at(t0);
  startedByDoca(l, 'service:kokoro');
  startedByDoca(l, 'service:comfyui');
  const end = l.usage.begin('http://127.0.0.1:8188/prompt');   // an image being made
  at(t0 + 3 * 60 * MIN);
  assert.deepEqual(await l.idle.sweep(), [], 'neither stops');
  assert.match(l.idle.standing(l.targets.get('service:kokoro')).text, /kept on: Kokoro TTS is the hive's voice/);
  assert.match(l.idle.standing(l.targets.get('service:comfyui')).text, /kept on: a request is in flight/);
  end();   // the request ends: its idle clock starts again from now
  at(t0 + 3 * 60 * MIN + 10 * MIN);
  assert.deepEqual(await l.idle.sweep(), []);
  at(t0 + 3 * 60 * MIN + 31 * MIN);
  assert.deepEqual(await l.idle.sweep(), ['service:comfyui']);
  real();
  // With "Start when needed" on, a voice that is only set up to be used goes, and comes back on the first sentence.
  await H.api(null, 'POST', '/api/services/life/service/kokoro', { startWhenNeeded: true });
  at(t0 + 3 * 60 * MIN + 62 * MIN);
  assert.deepEqual(await l.idle.sweep(), ['service:kokoro']);
  real();
});

test('one started outside DOCA stays, unless a person lets DOCA manage it', async () => {
  const l = fresh();
  await H.api(null, 'POST', '/api/services/life', { idleStopMinutes: 30 });
  runs.add('service:whisper');   // `docker run` in a terminal: no line says DOCA started it
  const t0 = realNow();
  at(t0 + 5 * 60 * MIN);
  assert.deepEqual(await l.idle.sweep(), []);
  assert.match(l.idle.standing(l.targets.get('service:whisper')).text, /started outside DOCA, so DOCA leaves it alone/);
  real();
  const r = await H.api(null, 'POST', '/api/services/life/service/whisper/adopt', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.managed, true);
  const adopted = lines().find(x => x.machine?.id === 'whisper' && x.act === 'adopt');
  assert.ok(adopted && adopted.from === 'person' && adopted.person, 'the adoption is the person\'s act, written down');
  // Adopted, it is still the hive's speech-to-text: held until it may start again when needed.
  at(t0 + 5 * 60 * MIN + 31 * MIN);
  assert.deepEqual(await l.idle.sweep(), []);
  assert.match(l.idle.standing(l.targets.get('service:whisper')).text, /kept on: Whisper STT is the hive's speech-to-text/);
  real();
  await H.api(null, 'POST', '/api/services/life/service/whisper', { startWhenNeeded: true });
  at(t0 + 5 * 60 * MIN + 32 * MIN);
  assert.deepEqual(await l.idle.sweep(), ['service:whisper']);
  real();
  assert.equal((await H.api(null, 'POST', '/api/services/life/service/nope/adopt', {})).status, 404);
});

test('an open page or a call holds them on; the idle clock starts when the last one goes', async () => {
  const l = fresh();
  await H.api(null, 'POST', '/api/services/life', { idleStopMinutes: 30 });
  const presence = require('../modules/presence'), owner = { id: 'u_owner', name: 'Owner' };
  const t0 = realNow();
  at(t0);
  startedByDoca(l, 'service:kokoro');
  at(t0 + 60 * MIN);
  presence.beat(owner, true);   // the panel, open on a tablet for an hour
  assert.deepEqual(await l.idle.sweep(), [], 'kept on while the panel is open');
  assert.match(l.idle.standing(l.targets.get('service:kokoro')).text, /kept on while the panel is open/);
  at(t0 + 90 * MIN);
  presence.beat(owner, false);   // the page is hidden
  at(t0 + 90 * MIN + 29 * MIN);
  assert.deepEqual(await l.idle.sweep(), [], 'counted from when the page went');
  // A call holds them on too.
  const call = require('../modules/realtime/call-log').begin({ kind: 'device', label: 'a watch' });
  at(t0 + 200 * MIN);
  assert.deepEqual(await l.idle.sweep(), [], 'kept on while a call is on');
  call.end('hung up');
  at(t0 + 200 * MIN + 31 * MIN);
  assert.deepEqual(await l.idle.sweep(), ['service:kokoro']);
  real();
});

test('stop with DOCA: on a clean stop, the ticked ones it manages; never on a version switch', async () => {
  const l = fresh();
  await H.api(null, 'POST', '/api/services/life', { stopWithDoca: true });
  await H.api(null, 'POST', '/api/services/life/service/vllm', { stopWithDoca: false });   // unticked
  startedByDoca(l, 'service:kokoro');
  startedByDoca(l, 'service:vllm');
  runs.add('service:whisper');   // started outside DOCA
  const pending = path.join(require('node:os').tmpdir(), `doca-pending-${process.pid}`);
  fs.writeFileSync(pending, 'v2 v1');
  let exited = null;
  assert.deepEqual(await l.shutdown.onSignal('SIGTERM', { exit: c => { exited = c; }, pending }), [], 'a switch going back is not DOCA stopping');
  assert.equal(exited, 0);
  fs.rmSync(pending, { force: true });
  assert.deepEqual(await l.shutdown.onSignal('SIGTERM', { exit: () => {}, pending }), ['service:kokoro']);
  assert.deepEqual([...runs].sort(), ['service:vllm', 'service:whisper']);
  assert.ok(lines().some(x => x.machine?.id === 'kokoro' && x.act === 'stop' && /DOCA stopped \(SIGTERM\)/.test(x.why)));
});

test('start when needed: the voice starts and the page is told; an outside one does not', async () => {
  const l = fresh();
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), voiceServices: { ttsUrl: 'http://127.0.0.1:8880', sttUrl: 'http://127.0.0.1:8000', ttsModel: 'kokoro' } });
  l.usage.started('service:kokoro');   // DOCA started it before; it was stopped since (on by default for those)
  const r = await H.api(null, 'POST', '/api/chat/synthesize', { text: 'Hello.' });
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.starting, true);
  assert.match(r.body.notice, /^Starting the voice \(Kokoro TTS\), a few seconds…$/);
  await new Promise(res => setImmediate(res));
  assert.deepEqual(started, ['service:kokoro']);
  assert.ok(runs.has('service:kokoro'));
  assert.ok(lines().some(x => x.machine?.id === 'kokoro' && x.act === 'start' && x.from === 'services' && /the voice/.test(x.why)));
  assert.equal((await l.demand.ensure('http://127.0.0.1:8880/v1')).state, 'ready');

  // A model server, waited for, with the notice a turn shows; a start that fails says so and the request goes on.
  l.usage.started('service:vllm');
  const told = [];
  assert.equal((await l.demand.ensure('http://127.0.0.1:8001/v1', { role: 'model', onStarting: t => told.push(t) })).state, 'started');
  assert.match(told[0], /Starting the model's server \(vLLM \(LLM\)\)/);
  l.usage.started('service:comfyui');
  failStart = 'no GPU';
  const failed = await l.demand.ensure('http://127.0.0.1:8188', { onStarting: t => told.push(t) });
  assert.equal(failed.state, 'failed');
  assert.match(failed.notice, /could not be started \(no GPU\) — going on without it/);
  assert.equal((await l.demand.ensure('http://127.0.0.1:8188')).state, 'failed', 'not tried again on every request');
  assert.equal(started.filter(k => k === 'service:comfyui').length, 1);

  // Never started by DOCA, not adopted: left alone, and the request goes on as before.
  assert.equal((await l.demand.ensure('http://127.0.0.1:8000/v1', { role: 'stt' })).state, 'off');
  assert.equal((await l.demand.ensure('https://api.example.com/v1')).state, 'off', 'not a service of this machine');
});

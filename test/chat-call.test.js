'use strict';

// Barge-in in a voice call (public/js/chat-call.js; docs/experiments/barge-in.md): with the flag on, speech while a
// turn works is recorded, and a sentence that comes back from the speech service after an interruption is dropped.
// The script runs in a sandbox with stand-ins for the audio APIs; a real call is the experiment's own measure.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function load() {
  let started = 0, resolveDecode;
  const sandbox = {
    console, setTimeout, clearTimeout, Math, Date, Uint8Array, performance,
    document: { getElementById: () => null },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    MediaRecorder: Object.assign(function MediaRecorder() { started++; this.state = 'recording'; this.start = () => {}; this.stop = () => {}; }, { isTypeSupported: () => true }),
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
    chatAppendMsg: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(`${['chat-call.js', 'chat-call-voice.js', 'chat-call-hold.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n')}
    ;globalThis.__ = { get: n => eval(n), set: (n, v) => eval(n + ' = v') };`, sandbox);
  const s = sandbox.__;
  s.set('_callPlayCtx', { decodeAudioData: () => new Promise(r => { resolveDecode = r; }), createBufferSource: () => ({ connect() {}, start() {}, stop() {} }), destination: {} });
  return { s, sandbox, started: () => started, decoded: buf => resolveDecode(buf || {}) };
}

const speaking = s => s.set('_callAnalyser', { frequencyBinCount: 8, getByteFrequencyData: d => d.fill(200) });

test('with barge-in on, speech while a turn works is recorded; off, it waits as before', () => {
  for (const [on, expected] of [[true, 1], [false, 0]]) {
    const { s, started } = load();
    s.set('_callActive', true); s.set('_callBargeIn', on); s.set('_callProcessing', 1); s.set('_callStream', {});
    s.set('_callStats', { at: Date.now(), bargeIns: 0, dropped: 0 });
    speaking(s);
    s.get('_callVadLoop')();
    assert.equal(started(), expected, `bargeIn ${on}`);
  }
});

test('talking over the voice pauses it; words stop it where the person stopped listening, noise lets it go on', async () => {
  for (const [said, stops] of [['Wait, stop.', true], ['', false]]) {
    const { s, sandbox } = load();
    const ctx = { state: 'running', currentTime: 10, suspend() { this.state = 'suspended'; return Promise.resolve(); }, resume() { this.state = 'running'; return Promise.resolve(); },
      decodeAudioData: async () => ({}), createBufferSource: () => ({ connect() {}, start() {}, stop() {} }), destination: {} };
    let stopped = 0, posted = null;
    sandbox.Blob = function Blob() {}; sandbox.FormData = function FormData() { this.append = () => {}; };
    sandbox.fetch = async () => ({ ok: true, json: async () => ({ text: said }) });
    sandbox.apiFetch = async (url, o) => { posted = [url, o.body]; return { cut: true }; };
    s.set('_callPlayCtx', ctx);
    s.set('_callActive', true); s.set('_callBargeIn', false); s.set('_callStream', {});
    s.set('_callStats', { at: Date.now(), bargeIns: 0, dropped: 0 });
    s.set('_callCurrentSrc', { stop() { stopped++; } });
    // Two sentences: the first heard to the end, the second half heard when the person spoke.
    s.set('_callHeard', [{ text: 'It will snow tomorrow.', start: 4, dur: 3 }, { text: 'Take the red coat and gloves.', start: 7, dur: 6 }]);
    speaking(s);
    let t = 1000; sandbox.performance = { now: () => t };
    vm.runInContext('performance = globalThis.performance', sandbox);
    s.get('_callVadLoop')(); t += 50; s.get('_callVadLoop')();
    assert.equal(ctx.state, 'running', 'a 50 ms sound does nothing');
    for (let i = 0; i < 8; i++) { t += 50; s.get('_callVadLoop')(); }
    assert.equal(ctx.state, 'suspended', 'a sustained one pauses the voice — it does not stop it');
    assert.equal(stopped, 0);
    await s.get('_callHoldDecide')({});
    if (stops) {
      assert.equal(stopped, 1);
      assert.equal(s.get('_callStats').bargeIns, 1);
      assert.equal(JSON.stringify(posted), JSON.stringify(['/api/chat/heard', { heard: 'It will snow tomorrow. Take the red' }]));
    } else {
      assert.equal(stopped, 0, 'no words: it goes on');
      assert.equal(posted, null);
    }
    assert.equal(ctx.state, 'running');
  }
});

test('with faceVoice on, the face speaks with the voice and listens to the person', () => {
  const { s, sandbox } = load();
  const seen = [];
  sandbox.faceCornerVoice = (state, level) => seen.push([state, Math.round(level * 100) / 100]);
  s.set('_callActive', true); s.set('_callFaceVoice', true); s.set('_callStream', {}); s.set('_callProcessing', 1);
  s.set('_callStats', { at: Date.now(), bargeIns: 0, dropped: 0 });
  s.set('_callOutAnalyser', { frequencyBinCount: 4, getByteFrequencyData: d => d.fill(40) });
  s.set('_callCurrentSrc', { stop() {} });
  s.set('_callAnalyser', { frequencyBinCount: 8, getByteFrequencyData: d => d.fill(0) });
  s.get('_callVadLoop')();
  assert.deepEqual(seen.at(-1), ['speaking', 0.5], 'the voice\'s level moves the mouth');
  s.set('_callCurrentSrc', null);
  speaking(s);
  s.get('_callVadLoop')();
  assert.equal(seen.at(-1)[0], 'listening');
});

test('a blip over the threshold is not sent; a word is', () => {
  for (const [ms, sent] of [[120, false], [600, true]]) {
    const { s, sandbox } = load();
    let processed = 0;
    s.set('_callActive', true); s.set('_callStream', {});
    s.set('_callProcessAudio', () => { processed++; });
    sandbox.Blob = function Blob() {};
    let t = 1000;
    sandbox.performance = { now: () => t };
    vm.runInContext('performance = globalThis.performance', sandbox);
    speaking(s);
    for (let i = 0; i <= ms / 20; i++) { s.get('_callVadLoop')(); t += 20; }
    const rec = s.get('_callRecorder');
    rec.ondataavailable({ data: { size: 10 } });
    rec.onstop();
    assert.equal(processed, sent ? 1 : 0, `${ms} ms of sound`);
  }
});

test('a speech service that fails says so once per call, not silently', async () => {
  const { s, sandbox } = load();
  const said = [];
  sandbox.chatAppendMsg = (_k, t) => said.push(t);
  sandbox.fetch = async () => ({ ok: false, status: 502, text: async () => 'kokoro down' });
  s.set('_callActive', true);
  await s.get('_callEnqueueSynth')('One.');
  await s.get('_callEnqueueSynth')('Two.');
  assert.equal(said.length, 1);
  assert.match(said[0], /could not be spoken.*502.*kokoro down/);
});


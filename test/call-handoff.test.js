'use strict';

// The microphone between a call, the wake word and the next call (2026-10-08, from the call log: a call opened six
// seconds after another heard a level of 0 for 54 s; Ambient's galaxy rose and fell at once; after a while no call
// reached the hub at all). The page's own scripts run in a sandbox with stand-ins for the audio APIs: the wake word
// resting lets go without throwing and hands its stream to the call, a call hands its own to whoever rests next, a
// microphone that gives pure silence is opened again once and then said, and Ambient's hold opens a call that listens
// until its quiet time.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['lib/mic.js', 'lib/voice-tags.js', 'face/assistant.js', 'chat-call.js', 'chat-call-report.js', 'chat-call-hear.js', 'chat-call-voice.js', 'chat-call-hold.js', 'chat-call-mic.js', 'wake-word.js', 'ambient.js'];

/** A track and a stream as getUserMedia gives them; `silent` streams give exact zeros. */
function mkStream(silent = false) {
  const track = { readyState: 'live', muted: false, enabled: true, stops: 0, stop() { this.readyState = 'ended'; this.stops++; } };
  return { silent, track, getTracks: () => [track], getAudioTracks: () => [track] };
}

function load({ quietMs = 12000 } = {}) {
  let t = 1000;
  const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {}, textContent: '', querySelector: () => null });
  const opened = [], said = [], timers = [];
  let current = null;   // the stream the call's analyser reads
  const ctx = () => ({
    state: 'running', sampleRate: 48000, currentTime: 0, destination: {},
    resume() { return Promise.resolve(); }, close() { return Promise.resolve(); }, suspend() { return Promise.resolve(); },
    createMediaStreamSource: s => { current = s; return { context: { sampleRate: 48000, destination: {}, createScriptProcessor: () => ({ connect() {}, disconnect() {} }) }, connect() {} }; },
    createAnalyser: () => ({ fftSize: 512, frequencyBinCount: 8, connect() {},
      getByteFrequencyData: d => d.fill(current?.silent ? 0 : 1),
      getFloatTimeDomainData: d => d.fill(current?.silent ? 0 : 0.0003) }),
    createScriptProcessor: () => ({ connect() {}, disconnect() {} }),
  });
  const sandbox = {
    console: { warn() {}, log() {} }, Math, Date, JSON, Uint8Array, Float32Array, Promise, Error, String, Number, Object, Array, Set, Map, AbortController, AbortSignal,
    setTimeout: (fn, ms) => { timers.push({ fn, at: t + (ms || 0) }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
    setInterval: () => 0, clearInterval() {},
    performance: { now: () => t },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: true }),
    AudioContext: function AudioContext() { return ctx(); },
    MediaRecorder: Object.assign(function MediaRecorder() { this.state = 'inactive'; this.start = () => {}; this.stop = () => {}; }, { isTypeSupported: () => true }),
    window: { isSecureContext: true },
    navigator: { userAgent: 'test', mediaDevices: { getUserMedia: async () => { const s = mkStream(sandbox.__silent); opened.push(s); return s; } } },
    location: { protocol: 'https:', host: 'hub.test' },
    document: { hidden: false, getElementById: el, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, createElement: el, fullscreenElement: null },
    fetch: async () => ({ ok: true, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(4) }),
    apiFetch: async url => (url === '/api/chat/call-status' ? { stt: true, tts: true } : url === '/api/chat/call-event' ? { call: 'call_test' } : {}),
    screenLoad: async () => ({ experiments: { wakeWord: true }, settings: { call: { listenWithFace: true, wakeWord: 'orbit', assistantIdleSec: quietMs / 1000 }, ambient: {} } }),
    screenPrefs: async () => ({ call: { wakeWord: 'orbit' } }),
    chatAppendMsg: (_k, text) => said.push(text),
    faceSpec: async () => ({}), faceMount: () => null, faceFeed: () => () => {}, FACE_STATES: {},
    __silent: false,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${FILES.map(f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n;\n')}
    ;globalThis.__ = { get: n => eval(n), set: (n, v) => eval(n + ' = v') };`, sandbox);
  const s = sandbox.__;
  const advance = async ms => { t += ms; for (const x of timers) if (x.fn && x.at <= t) { const fn = x.fn; x.fn = null; fn(); } await new Promise(r => setImmediate(r)); };
  return { s, sandbox, opened, said, advance, frame: () => s.get('_callVadLoop')(), now: () => t };
}

/** The wake word resting the way a screen without a trained model rests: `model` was `false` there until 2026-10-08. */
function resting(s) {
  const stream = mkStream();
  s.set('_wake', { stream, ctx: { close: () => Promise.resolve() }, an: {}, model: false, rec: null, raf: 0, word: 'orbit', wakeCtx() {} });
  return stream;
}

test('the wake word resting lets go without throwing, and the call takes its stream live — no second opening', async () => {
  const { s, opened, said } = load();
  const wakeStream = resting(s);
  const ok = await s.get('chatToggleCall')({ assistant: true });
  assert.equal(ok, true, `the call starts: ${said.join(' | ')}`);
  assert.equal(s.get('_callActive'), true);
  assert.equal(s.get('_wake'), null, 'the wake word let go');
  assert.equal(opened.length, 0, 'the microphone was not opened again');
  assert.equal(s.get('_callStream'), wakeStream, 'the call hears through the stream the wake word held');
  assert.equal(wakeStream.track.stops, 0);
});

test('a call that ends hands its stream to whoever opens the microphone next; nobody taking it, it is let go', async () => {
  const { s, opened, advance } = load();
  await s.get('chatToggleCall')();
  const callStream = s.get('_callStream');
  s.get('_callStop')('test');
  assert.equal(callStream.track.stops, 0, 'kept a moment for the next one');
  assert.equal(await s.get('micOpen')(s.get('MIC_SPEECH')), callStream, 'taken as it is');
  assert.equal(opened.length, 1, 'only the first call opened it');
  s.get('micHandOff')(callStream);
  await advance(1600);
  assert.equal(callStream.track.stops, 1, 'nobody took it: the microphone is given up');
});

test('a step that throws while a call opens says why and gives the call up — never "Checking services…" for good', async () => {
  const { s, sandbox, said } = load();
  sandbox.screenPrefs = async () => { throw new Error('boom'); };
  vm.runInContext('wakeWordPause = () => { throw new Error("the wake word could not let go"); }', sandbox);
  assert.equal(await s.get('chatToggleCall')(), false);
  assert.match(said.join('\n'), /The call did not start: the wake word could not let go/);
  assert.equal(s.get('_callStarting'), false);
  assert.equal(s.get('_callAudioCtx'), null);
});

test('a microphone that gives pure silence is opened again once, then the call says so; one that hears the room is left alone', async () => {
  const { s, sandbox, opened, said, advance, frame } = load();
  sandbox.__silent = true;
  await s.get('chatToggleCall')();
  frame(); await advance(4100); frame();
  await advance(10);
  assert.equal(opened.length, 2, 'opened again');
  assert.equal(opened[0].track.stops, 1, 'the silent one let go');
  await advance(4100); frame();
  assert.match(said.at(-1), /The microphone gives nothing — another app or a call may hold it/);

  const room = load();
  await room.s.get('chatToggleCall')();
  room.frame(); await room.advance(9000); room.frame();
  assert.equal(room.opened.length, 1);
  assert.ok(!room.said.some(x => /microphone gives nothing/.test(x)));
});

test('Ambient\'s hold opens a call that listens, with the wake word resting; it ends after its quiet time and the galaxy goes down', async () => {
  const { s, advance, now } = load({ quietMs: 12000 });
  s.set('AMB.on', true);
  resting(s);
  await s.get('ambientTalk')();
  assert.equal(s.get('_callActive'), true, 'the call is on');
  assert.equal(s.get('AMB.calling'), true, 'the galaxy rose');
  await s.get('_ambTick')();
  assert.equal(s.get('AMB.calling'), true, 'and stays up while the call listens');
  const t0 = now();
  await advance(11000); await s.get('_ambTick')();
  assert.equal(s.get('_callActive'), true, 'still listening before its quiet time');
  await advance(1500); await s.get('_ambTick')();
  assert.ok(now() - t0 >= 12000);
  assert.equal(s.get('_callActive'), false, 'quiet for its time: the call ends');
  await s.get('_ambTick')();
  assert.equal(s.get('AMB.calling'), false, 'and the galaxy goes down');
});

test('a sentence the voice cannot say is shown where the call is shown, when the chat is not on screen', async () => {
  const { s, sandbox } = load();
  await s.get('chatToggleCall')({ assistant: true });
  let shown = '';
  sandbox._assistantSay = x => { shown = x; };
  sandbox.assistantIsOpen = () => true;
  sandbox.fetch = async () => ({ ok: false, status: 502, text: async () => 'down' });
  await s.get('_callEnqueueSynth')('[calm] It is ten past eight.');
  assert.match(shown, /Not spoken \(speech service answered 502: down\): It is ten past eight\./);
});

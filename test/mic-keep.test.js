'use strict';

// The microphone switch beside the chats (public/js/lib/mic-keep.js, mic-keep-ui.js, chat-call-pause.js): off, a page in
// the background gives the microphone up; on, it may keep it; a phone call reported by DocaMobile pauses a call, and
// its end carries the call on. The scripts run in a sandbox with stand-ins for the audio APIs; a real phone is the check.
require('./helpers');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const JS = f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');

function load({ bridge = null } = {}) {
  const notes = [], saved = [], listeners = {};
  const el = () => ({ classList: { add() {}, remove() {} }, style: {} });
  const doc = { hidden: false, getElementById: el, querySelectorAll: () => [], addEventListener: (e, f) => { listeners[e] = f; }, removeEventListener: () => {} };
  // A live track, as a real one is: the hand-off (lib/mic.js micHandOff) keeps only a live stream for the next call.
  const track = () => ({ stopped: false, readyState: 'live', muted: false, enabled: true, stop() { this.stopped = true; this.readyState = 'ended'; } });
  const stream = () => ({ tracks: [track()], getTracks() { return this.tracks; }, getAudioTracks() { return this.tracks; } });
  const sandbox = {
    console, setTimeout, clearTimeout, Math, Date, Uint8Array, Float32Array, performance, JSON, Map, Promise,
    document: doc,
    window: { DocaDevice: bridge, addEventListener: (e, f) => { listeners[`w:${e}`] = f; } },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    MediaRecorder: Object.assign(function MediaRecorder() { this.state = 'recording'; this.start = () => {}; this.stop = () => { this.state = 'inactive'; }; }, { isTypeSupported: () => true }),
    fetch: async () => ({ ok: true }),
    chatAppendMsg: (_k, t) => notes.push(t),
    apiFetch: async () => ({}),
    appAlert: t => notes.push(t),
    screenLoad: async () => ({ settings: { call: { micAlways: sandbox.__on || false, silenceMs: 900 } } }),
    screenSave: async patch => { saved.push(patch); return {}; },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${['lib/mic.js', 'chat-call.js', 'chat-call-mic.js', 'chat-call-report.js', 'chat-call-hear.js', 'chat-call-voice.js', 'chat-call-hold.js', 'chat-call-pause.js', 'lib/mic-keep.js', 'mic-keep-ui.js'].map(JS).join('\n')}
    ;globalThis.__ = { get: n => eval(n), set: (n, v) => eval(n + ' = v') };`, sandbox);
  sandbox.__.set('micOpen', async () => stream());   // no getUserMedia here: a fresh live stream
  return { s: sandbox.__, sandbox, doc, notes, saved, listeners, track };
}

const ctx = () => { const c = { state: 'running', resume() { this.state = 'running'; return Promise.resolve(); }, suspend() { this.state = 'suspended'; return Promise.resolve(); },
  close: () => Promise.resolve(), createMediaStreamSource: () => ({ connect() {}, context: c }), createAnalyser: () => ({ connect() {}, frequencyBinCount: 8, getByteFrequencyData: d => d.fill(0) }),
  createScriptProcessor: () => ({ connect() {}, disconnect() {} }), destination: {}, sampleRate: 48000 }; return c; };

/** A call in progress, its microphone open. */
function inCall(s, track) {
  const stream = { t: track(), getTracks() { return [this.t]; }, getAudioTracks() { return [this.t]; } };
  s.set('_callActive', true); s.set('_callStream', stream); s.set('_callAudioCtx', ctx()); s.set('_callPlayCtx', ctx());
  s.set('_callAnalyser', {});
  return stream;
}

test('the plan: off and hidden releases; on keeps it; a phone call pauses; its end resumes when allowed', () => {
  const { s } = load();
  const plan = s.get('micKeepPlan');
  assert.equal(plan({ hidden: true, on: false, paused: '', held: 'call' }), 'release');
  assert.equal(plan({ hidden: true, on: false, paused: '', held: 'listening' }), 'release');
  assert.equal(plan({ hidden: true, on: false, paused: '', held: '' }), 'none', 'nothing held, nothing to do');
  assert.equal(plan({ hidden: true, on: true, paused: '', held: 'call' }), 'none', 'on: the call goes on in the background');
  assert.equal(plan({ hidden: false, on: false, paused: '', held: 'call' }), 'none');
  assert.equal(plan({ hidden: true, on: true, paused: 'phone-call', held: 'call' }), 'pause');
  assert.equal(plan({ hidden: false, on: false, paused: 'phone-call', held: 'recording' }), 'pause');
  assert.equal(plan({ hidden: true, on: true, paused: 'phone-call', held: 'paused' }), 'none', 'already paused');
  assert.equal(plan({ hidden: true, on: true, paused: '', held: 'paused' }), 'resume');
  assert.equal(plan({ hidden: true, on: false, paused: '', held: 'paused' }), 'release', 'off and hidden: a paused call ends rather than waits');
  assert.equal(plan({ hidden: false, on: false, paused: '', held: 'paused' }), 'resume', 'back on screen: the call goes on');
});

test('off: the page going to the background ends a call and gives the microphone up', async () => {
  const { s, doc, notes, track } = load();
  const stream = inCall(s, track);
  doc.hidden = true;
  await s.get('micKeepCheck')();
  assert.equal(s.get('_callActive'), false);
  assert.equal(stream.t.stopped, true, 'the microphone track is stopped');
  assert.ok(notes.some(n => /background/.test(n)), 'the chat says why the call ended');
});

test('a call the person ends hands its stream over (lib/mic.js); one ended for the background stops it at once', async () => {
  for (const [hidden, stoppedNow] of [[false, false], [true, true]]) {
    const { s, doc, track } = load();
    const stream = inCall(s, track);
    doc.hidden = hidden;
    if (hidden) await s.get('micKeepCheck')(); else s.get('_callStop')('the person ended the call');
    assert.equal(s.get('_callActive'), false);
    assert.equal(stream.t.stopped, stoppedNow, hidden ? 'background: no hand-off' : 'between calls: kept a moment for the next');
    s.get('micDrop')();
  }
});

test('on: the page in the background keeps the call and its microphone', async () => {
  const { s, doc, track } = load();
  s.set('_micKeep', { on: true, loaded: true, paused: '', app: null });
  const stream = inCall(s, track);
  doc.hidden = true;
  await s.get('micKeepCheck')();
  assert.equal(s.get('_callActive'), true);
  assert.equal(stream.t.stopped, false);
});

test('a phone call from the app pauses the call (microphone freed, voice held); its end opens the microphone again', async () => {
  const { s, doc, track } = load();
  s.set('_micKeep', { on: true, loaded: true, paused: '', app: null });
  const stream = inCall(s, track);
  doc.hidden = true;
  await s.get('micKeepFromApp')({ paused: 'phone-call' });
  assert.equal(s.get('_callActive'), true, 'still a call');
  assert.equal(stream.t.stopped, true, 'the phone call has the microphone');
  assert.equal(s.get('_callStream'), null);
  assert.ok(s.get('_callHold')?.paused, 'the voice waits');
  assert.equal(s.get('_callMicWatch'), null, 'the silence watch does not reopen a microphone released on purpose');
  assert.equal(s.get('_micKept'), null, 'nothing handed over: the phone call has the microphone');
  assert.equal(s.get('micHeldNow')(), 'paused');
  await s.get('micKeepFromApp')({ paused: '' });
  assert.ok(s.get('_callStream'), 'the microphone is open again');
  assert.equal(s.get('_callHold'), null);
  assert.equal(s.get('micHeldNow')(), 'call');
});

test('the app saying it went to the background releases only while the switch is off', async () => {
  for (const on of [false, true]) {
    const { s, track } = load();
    s.set('_micKeep', { on, loaded: true, paused: '', app: null });
    inCall(s, track);
    await s.get('micKeepFromApp')({ background: true });
    assert.equal(s.get('_callActive'), on, `switch ${on ? 'on' : 'off'}`);
  }
});

test('the switch saves this screen\'s call.micAlways and tells the app', async () => {
  const told = [];
  const { s, saved } = load({ bridge: { micState: () => '{"on":false}', micAlways: on => { told.push(on); return JSON.stringify({ on, service: on, paused: '' }); } } });
  await s.get('micKeepSet')(true);
  assert.equal(JSON.stringify(saved.at(-1)), JSON.stringify({ call: { micAlways: true, silenceMs: 900 } }), 'the other call fields kept');
  assert.deepEqual(told, [true]);
  assert.equal(s.get('micAlwaysOn')(), true);
});

test('the app\'s "Stop listening" turns the switch off here too; a bridge without a switch is not the app', async () => {
  const { s, saved } = load({ bridge: { micState: () => '{"on":true}', micAlways: on => JSON.stringify({ on }) } });
  s.set('_micKeep', { on: true, loaded: true, paused: '', app: null });
  await s.get('micKeepFromApp')({ on: false, service: false });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.get('micAlwaysOn')(), false);
  assert.equal(saved.at(-1).call.micAlways, false);
  const dream = load({ bridge: { micState: () => 'null', micAlways: () => 'null' } });
  assert.equal(dream.s.get('micKeepBridge')(), null);
});

test('the switch says what the microphone is doing and what "on" means here', () => {
  const { s } = load();
  const w = s.get('micKeepWords');
  assert.equal(w({ on: false, held: '', paused: '' }).dot, 'off');
  assert.equal(w({ on: true, held: 'listening', paused: '' }).dot, 'listening');
  assert.equal(w({ on: true, held: 'call', paused: '' }).dot, 'call');
  assert.match(w({ on: true, held: 'paused', paused: 'phone-call' }).title, /paused for a phone call/);
  assert.match(w({ on: true, held: '', paused: '', inApp: false }).title, /up to the browser/);
  assert.match(w({ on: true, held: '', paused: '', inApp: true }).title, /DOCA is listening/);
  assert.match(w({ on: false, held: '', paused: '' }).title, /closes as soon as the page is in the background/);
});

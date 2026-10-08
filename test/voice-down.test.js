'use strict';

// Voice with no speech service (deep test A, #9): the hub answers a voice note and a spoken answer with a 503 that says
// where to set one up, instead of a bare 500; a call that cannot start is said on the face, on Ambient's line and in
// the chat, and the call log keeps it as a call that did not start.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let closedPort;
before(async () => {
  // A port nothing listens on: taken, then let go.
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  closedPort = s.address().port;
  await new Promise(r => s.close(r));
  process.env.DOCA_STT_URL = process.env.DOCA_TTS_URL = `http://127.0.0.1:${closedPort}`;
  await H.start();
});
after(async () => { delete process.env.DOCA_STT_URL; delete process.env.DOCA_TTS_URL; await H.stop(); });

test('a voice note and a spoken answer with no speech service: a 503 that says where to set one up', async () => {
  const form = new FormData();
  form.append('audio', new Blob([Buffer.alloc(2000)], { type: 'audio/wav' }), 'note.wav');
  const heard = await H.api(null, 'POST', '/api/chat/transcribe', form);
  assert.equal(heard.status, 503, JSON.stringify(heard.body));
  assert.match(heard.body.error, /^No speech service: set one up in Settings → Voice\. \(speech-to-text at http:\/\/127\.0\.0\.1:\d+ does not answer\.\)/);
  assert.equal(heard.body.code, 'no_speech_service');
  const said = await H.api(null, 'POST', '/api/chat/synthesize', { text: 'Hello.' });
  assert.equal(said.status, 503, JSON.stringify(said.body));
  assert.match(said.body.error, /^No speech service: set one up in Settings → Voice\./);
});

test('a call that could not start reaches the call log', async () => {
  const r = await H.api(null, 'POST', '/api/chat/call-event', { stage: 'start', assistant: true, refused: 'No speech service: set one up in Settings → Voice.' });
  assert.equal(r.status, 200);
  const rec = require('../modules/realtime/call-log').get(r.body.call);
  assert.ok(rec, 'a record');
  const lines = require('../modules/realtime/call-log').lines().map(l => l.text).join('\n');
  assert.match(lines, /the call did not start: No speech service: set one up in Settings → Voice\./);
  assert.match(lines, /did not start/);
});

/** The page's call code in a sandbox, with no speech service behind it. */
function page({ face = false, ambient = false } = {}) {
  const said = { chat: [], face: [], ambient: [], posted: [] };
  const sandbox = {
    console, setTimeout, clearTimeout, Math, Date, Uint8Array, performance, navigator: { userAgent: 'test' },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    AudioContext: function AudioContext() { this.resume = async () => {}; this.close = async () => {}; },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    chatAppendMsg: (_role, text) => said.chat.push(text),
    apiFetch: async (url, opts) => {
      if (url === '/api/chat/call-status') return { stt: false, tts: false, sttUrl: 'http://127.0.0.1:8000', ttsUrl: 'http://127.0.0.1:8880' };
      said.posted.push([url, opts?.body]);
      return { call: 'c1' };
    },
    assistantIsOpen: () => face, _assistantSay: t => said.face.push(t),
    ambientIsOpen: () => ambient, ambientSay: t => said.ambient.push(t),
  };
  vm.createContext(sandbox);
  vm.runInContext(['lib/mic.js', 'chat-call.js', 'chat-call-report.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n'), sandbox);
  return { sandbox, said };
}

test('a call from the face with no speech service says why on the face, and is logged as not started', async () => {
  const { sandbox, said } = page({ face: true });
  const ok = await sandbox.chatToggleCall({ assistant: true });
  assert.ok(!ok);
  assert.match(said.face.at(-1) || '', /^No speech service: set one up in Settings → Voice\. \(speech-to-text at .* and text-to-speech at .* do not answer\.\)/);
  assert.match(said.chat.at(-1) || '', /^No speech service/);
  const refused = said.posted.find(([u, b]) => u === '/api/chat/call-event' && b.stage === 'start' && b.refused);
  assert.ok(refused, 'the call log hears of it');
  assert.equal(refused[1].assistant, true);
});

test('a call from Ambient with no speech service says why on Ambient\'s line', async () => {
  const { sandbox, said } = page({ ambient: true });
  await sandbox.chatToggleCall({ assistant: true });
  assert.match(said.ambient.at(-1) || '', /^No speech service: set one up in Settings → Voice\./);
  assert.equal(said.posted.find(([, b]) => b?.refused)?.[1].ambient, true);
});

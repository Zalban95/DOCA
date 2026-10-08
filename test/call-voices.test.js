'use strict';

/**
 * A voice per kind of call (modules/call-voices.js; asked 2026-10-08): the Quick call — the face, Ambient, a device's
 * call — and the Deep call — the chat's 🎙 — each speak in their own voice when one is chosen (this screen's, its
 * person's, the hive's), else in this screen's own voice, else the hive's, which is what every install does until
 * somebody chooses. The agent is told of tone tags only in a call whose voice understands them.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./helpers');   // first: it points the settings at a temporary folder

const heard = { hive: [], expressive: [] };
const stub = (who, voices) => http.createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
  if (req.url === '/v1/audio/voices') return res.end(JSON.stringify({ voices }));
  heard[who].push(JSON.parse(raw)); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(4800)); }); });
let kokoro, qwen, row, rowPort;

before(async () => {
  kokoro = stub('hive', ['af_heart', 'if_sara']); qwen = stub('expressive', ['ryan', 'serena']);
  await Promise.all([kokoro, qwen].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
  row = require('../modules/services').INFERENCE_SERVICES.find(s => s.id === 'qwentts');
  rowPort = row.port; row.port = qwen.address().port;   // the expressive voice's row, for this test: the stub
  await H.start();
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), voiceServices: { ttsUrl: `http://127.0.0.1:${kokoro.address().port}`, ttsModel: 'kokoro', ttsVoice: 'af_heart', ttsSpeed: 1 } });
});
after(async () => { row.port = rowPort; await H.stop(); await Promise.all([kokoro, qwen].map(s => new Promise(r => s.close(r)))); });

const say = async (call, text = '[whispers] Quiet now.') => {
  const before = { hive: heard.hive.length, expressive: heard.expressive.length };
  const r = await H.api(null, 'POST', '/api/chat/synthesize', { text, ...(call ? { call } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const who = heard.expressive.length > before.expressive ? 'expressive' : 'hive';
  return { who, sent: heard[who].at(-1) };
};
const prefs = patch => { const u = require('../modules/utils'); u.savePrefs({ ...u.loadPrefs(), ...patch }); };

test('nothing chosen: both kinds of call speak in the hive\'s voice, as before', async () => {
  await H.api(null, 'GET', '/api/screen');
  for (const call of ['quick', 'deep', null]) {
    const { who, sent } = await say(call);
    assert.equal(who, 'hive', String(call));
    assert.deepEqual([sent.voice, sent.input, sent.instructions], ['af_heart', 'Quiet now.', undefined]);
  }
});

test('the Quick call speaks in its own voice on this screen, the Deep call keeps the screen\'s', async () => {
  const set = await H.api(null, 'POST', '/api/screen/settings', { voice: { ttsVoice: 'if_sara', quick: { service: 'qwentts', voice: 'Ryan' } } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const q = await say('quick', '[whispers] Piano, dorme.');
  assert.deepEqual([q.who, q.sent.voice, q.sent.input], ['expressive', 'ryan', 'Piano, dorme.']);
  assert.match(q.sent.instructions, /Whisper/, 'its tags become words');
  const d = await say('deep');
  assert.deepEqual([d.who, d.sent.voice, d.sent.instructions], ['hive', 'if_sara', undefined], 'the Deep call: this screen\'s own voice');
  const plain = await say(null);
  assert.deepEqual([plain.who, plain.sent.voice], ['hive', 'if_sara'], 'not a call (a voice message): this screen\'s voice');

  // A kind that only sets its speed keeps the screen's service and voice.
  await H.api(null, 'POST', '/api/screen/settings', { voice: { ttsVoice: 'if_sara', deep: { speed: 1.3 } } });
  const s = await say('deep');
  assert.deepEqual([s.who, s.sent.voice, s.sent.speed], ['hive', 'if_sara', 1.3]);
  // The hive's own service named outright, with another of its voices.
  await H.api(null, 'POST', '/api/screen/settings', { voice: { engine: 'qwentts', deep: { service: 'hive', voice: 'af_heart' } } });
  const h = await say('deep');
  assert.deepEqual([h.who, h.sent.voice], ['hive', 'af_heart']);
  assert.equal((await say('quick')).who, 'expressive', 'no Quick voice: this screen\'s own (the expressive one here)');
  await H.api(null, 'POST', '/api/screen/settings', { voice: null });
});

test('fallbacks: the screen\'s slot, then its person\'s, then the hive\'s', async () => {
  prefs({ voice: { quick: { service: 'qwentts' } } });
  const hive = await say('quick');
  assert.deepEqual([hive.who, hive.sent.voice], ['expressive', 'serena'], 'the hive\'s Quick call: the service\'s own voice');
  assert.equal((await say('deep')).who, 'hive', 'the hive set no Deep call');

  require('../modules/screens').setPerson(H.owner.user.id, { voice: { quick: { service: 'hive', voice: 'if_sara' } } });
  const person = await say('quick');
  assert.deepEqual([person.who, person.sent.voice], ['hive', 'if_sara'], 'the person\'s over the hive\'s');

  await H.api(null, 'POST', '/api/screen/settings', { voice: { quick: { service: 'qwentts', voice: 'ryan' } } });
  assert.equal((await say('quick')).sent.voice, 'ryan', 'the screen\'s over its person\'s');
  await H.api(null, 'POST', '/api/screen/settings', { voice: null });
  require('../modules/screens').setPerson(H.owner.user.id, { voice: null });
  prefs({ voice: undefined });
});

test('tone tags are offered only in a call whose voice understands them', async () => {
  const chat = require('../modules/chat');
  const screen = (await H.api(null, 'GET', '/api/screen')).body;
  const req = { auth: { user: H.owner.user, session: { screen: screen.id } } };
  const panel = { name: 'The panel', formFactor: 'desktop' };
  assert.equal(chat.voiceClient(panel, 'assistant', req).voiceTags, undefined, 'the hive\'s voice (Kokoro) takes none');
  require('../modules/screens').set(screen.id, { voice: { quick: { service: 'qwentts' } } });
  const quick = chat.voiceClient(panel, 'assistant', req), deep = chat.voiceClient(panel, 'call', req);
  assert.deepEqual([quick.mode, quick.voiceTags], ['assistant', true], 'the Quick call speaks expressively: told of the tags');
  assert.deepEqual([deep.mode, deep.voiceTags], ['call', undefined], 'the Deep call does not: not told');
  assert.match(require('../modules/harness/turn/client').clientBlock(quick), /\[whispers\]/);
  require('../modules/screens').set(screen.id, { voice: null });
});

test('a device\'s call speaks in the Quick call voice of its screen, or the hive\'s', async () => {
  const devices = require('../modules/api-v1/devices');
  const voices = require('../modules/call-voices');
  const watch = devices.create({ name: 'a watch', scopes: ['interact', 'harness:chat'], caps: H.WATCH_CAPS, kind: 'device' }).device;
  devices.update(watch.id, { userId: H.owner.user.id });
  assert.deepEqual([voices.forDevice(watch.id).engine.id, voices.forDevice(watch.id).tags], ['', false], 'nothing chosen: the hive\'s');

  prefs({ voice: { quick: { service: 'qwentts' }, deep: { service: 'hive' } } });
  const pick = voices.forDevice(watch.id);
  assert.deepEqual([pick.engine.id, pick.tags, pick.from], ['qwentts', true, 'hive'], 'the hive\'s Quick call voice');
  require('../modules/screens').set(watch.id, { voice: { quick: { service: 'hive', voice: 'if_sara' } } });
  assert.deepEqual([voices.forDevice(watch.id).engine.id, voices.forDevice(watch.id).voice, voices.forDevice(watch.id).from], ['', 'if_sara', 'device']);
  require('../modules/screens').set(watch.id, { voice: null });

  // The hub's own call engine speaks it: the expressive voice, its tags as words, raw PCM for the radio.
  const p = require('../modules/realtime/pipeline').connect({ transcribe: async () => '', voice: voices.forDevice(watch.id) });
  const n = heard.expressive.length;
  const done = new Promise(r => p.on('turn', r));
  p.say('[excited] It is done.');
  await done; p.close();
  const sent = heard.expressive.at(-1);
  assert.equal(heard.expressive.length, n + 1);
  assert.deepEqual([sent.voice, sent.input, sent.response_format], ['serena', 'It is done.', 'pcm']);
  assert.match(sent.instructions, /Excited/);

  // A request body cannot say the hub speaks it: the marker is a symbol only realtime/index.js holds.
  const { HUB_SPOKEN } = require('../modules/api-v1/harness');
  assert.equal(typeof HUB_SPOKEN, 'symbol');
  assert.equal(JSON.parse(JSON.stringify({ [HUB_SPOKEN]: true }))[HUB_SPOKEN], undefined);
  prefs({ voice: undefined });
});

test('the panel\'s call asks for the Quick voice from the face and the Deep voice from the chat', async () => {
  const bodies = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Math, Date, Uint8Array, performance,
    document: { getElementById: () => null }, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    fetch: async (url, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }; },
    chatAppendMsg: () => {}, apiFetch: async () => ({}),
  };
  vm.createContext(sandbox);
  vm.runInContext(`${['lib/mic.js', 'chat-call.js', 'chat-call-report.js', 'chat-call-hear.js', 'chat-call-voice.js', 'chat-call-hold.js', 'chat-call-mic.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n')}
    ;globalThis.__ = { get: n => eval(n), set: (n, v) => eval(n + ' = v') };`, sandbox);
  const s = sandbox.__;
  s.set('_callPlayCtx', { state: 'running', decodeAudioData: async () => ({}), createBufferSource: () => ({ connect() {}, start() {}, stop() {} }), destination: {} });
  s.set('_callActive', true);
  for (const [assistant, call] of [[true, 'quick'], [false, 'deep']]) {
    s.set('_callAssistant', assistant);
    await s.get('_callEnqueueSynth')('Hello.');
    assert.equal(bodies.at(-1).call, call);
  }
});

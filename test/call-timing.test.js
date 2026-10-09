'use strict';

// A device's call, timed by its person (2026-10-09, from a watch): the pause that ends speech is the screen setting
// call.silenceMs (realtime/call-pause.js) rather than a fixed 900 ms; "too quiet" is said only after a long stretch and
// never while speech is being gathered, decided or answered; a voice that fails gives way to the hive's and says so; each
// answer is a line with the audio that actually left; and the call log survives a restart (DATA_DIR/calls).

const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const WebSocket = require('ws');
const { CONFIG_PATH } = require('../modules/paths');
const pipeline = require('../modules/realtime/pipeline');
const callLog = require('../modules/realtime/call-log');
const pause = require('../modules/realtime/call-pause');

let modelServer, voice, bad, watch;
const tone = (ms, amp = 6000) => { const b = Buffer.alloc(ms * 48); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(amp * Math.sin(i / 5)), i * 2); return b; };
const quiet = ms => tone(ms, 10);
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

before(async () => {
  modelServer = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The lights are on.' } }] })}\n\n`); res.end('data: [DONE]\n\n'); });
  });
  await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
  voice = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/v1/models') return res.end('{"data":[]}');
      if (req.url === '/v1/audio/transcriptions') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ text: 'Turn on the lights.' })); }
      if (req.url === '/v1/audio/speech') return res.end(Buffer.alloc(4800));
      res.statusCode = 404; res.end();
    });
  });
  await new Promise(r => voice.listen(0, '127.0.0.1', r));
  bad = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 500; res.end('engine down'); }); });
  await new Promise(r => bad.listen(0, '127.0.0.1', r));
  process.env.DOCA_STT_URL = process.env.DOCA_TTS_URL = `http://127.0.0.1:${voice.address().port}`;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  require('../modules/terminal').setup(H.server());
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
  watch = H.mkDevice('Wrist', 'watch', H.WATCH_CAPS);
});
after(async () => { delete process.env.DOCA_STT_URL; delete process.env.DOCA_TTS_URL; await H.stop(); modelServer.close(); voice.close(); bad.close(); });

function listen(opts) {
  const p = pipeline.connect({ synth: async () => Buffer.alloc(4800), ...opts });
  const ev = [];
  for (const t of ['notice', 'stt', 'utterance', 'user', 'tts', 'spoken', 'agent']) p.on(t, x => ev.push([t, x]));
  p.on('error', () => {});
  return { p, of: t => ev.filter(e => e[0] === t).map(e => e[1]) };
}

test('the pause comes from the screen setting: the device, its person, the hive, else a device\'s default; bounded', () => {
  const screens = require('../modules/screens');
  const { loadPrefs, savePrefs } = require('../modules/utils');
  const id = watch.device.id;
  assert.deepEqual(pause.forDevice(id), { silenceMs: pipeline.DEFAULT_SILENCE_MS, from: 'default' });
  assert.ok(pipeline.DEFAULT_SILENCE_MS > 900, 'longer than the 900 ms that let a pause start the turn');
  savePrefs({ ...loadPrefs(), call: { silenceMs: 2500 } });
  assert.deepEqual(pause.forDevice(id), { silenceMs: 2500, from: 'hive' });
  screens.set(id, { call: { silenceMs: 1800 } });
  assert.deepEqual(pause.forDevice(id), { silenceMs: 1800, from: 'device' });
  screens.set(id, { call: { silenceMs: 50000 } });
  assert.equal(pause.forDevice(id).silenceMs, pause.MAX_MS);
  screens.set(id, { call: null });
  const p = loadPrefs(); delete p.call; savePrefs(p);
  assert.equal(pause.forDevice('dev_nobody').from, 'default');
});

test('a pause shorter than the setting never cuts: speech that resumes inside it is the same request', async () => {
  const { p, of } = listen({ silenceMs: 1400, transcribe: async () => 'one request' });
  p.audio(Buffer.concat([quiet(300), tone(600), quiet(1000), tone(600), quiet(1500)]));
  await tick();
  assert.equal(of('utterance').length, 1);
  assert.equal(of('user').length, 1);
  p.audio(Buffer.concat([tone(600), quiet(1500), tone(600), quiet(1500)]));
  await tick();
  assert.equal(of('utterance').length, 3, 'a pause as long as the setting does end it');
  p.close();
});

test('"too quiet" is never counted while speech is being decided, nor exact zeros while the answer plays', async () => {
  let answer;
  const { p, of } = listen({ silenceMs: 300, transcribe: () => new Promise(r => { answer = r; }) });
  const murmur = ms => Buffer.concat(Array.from({ length: Math.round(ms / 900) }, () => Buffer.concat([tone(600, 60), quiet(300)])));
  p.audio(Buffer.concat([quiet(300), tone(600), quiet(400)]));   // an utterance, now with the transcriber
  p.audio(murmur(12000));
  await tick();
  assert.equal(of('notice').length, 0, 'deciding: not a microphone too far');
  answer('');
  await tick();
  p.close();

  const two = listen({ synth: async () => Buffer.alloc(24000 * 2 * 15) });   // a 15 s answer
  two.p.audio(quiet(200));
  two.p.say('A long answer.');
  await tick();
  two.p.audio(Buffer.alloc(48 * 12000));   // 12 s of exact zeros: a device that mutes its microphone while it plays
  await tick();
  assert.equal(two.of('notice').length, 0, 'zeros while the answer plays are not a muted microphone');
  two.p.close();

  const three = listen({});
  three.p.audio(quiet(200));
  three.p.audio(Buffer.alloc(48 * 10500));
  await tick();
  assert.deepEqual(three.of('notice').map(n => n.stage), ['audio'], 'zeros with nothing playing still are');
  three.p.close();
});

test('a call\'s voice that fails gives way to the hive\'s, told once and logged; each sentence and answer counted', async () => {
  const engine = { id: 'qwentts', label: 'Expressive voice', ttsUrl: `http://127.0.0.1:${bad.address().port}`, ttsModel: 'm', ttsVoice: '', ttsSpeed: 1, tags: null };
  const { p, of } = listen({ synth: undefined, voice: { engine, voice: '', speed: null } });
  p.say('First sentence. Second one.');
  await tick(400);
  assert.equal(of('agent').length, 2, 'both said, in the hive\'s voice');
  const fail = of('tts').filter(t => t.error);
  assert.equal(fail.length, 1); assert.equal(fail[0].fallback, true); assert.match(fail[0].error, /answered 500: engine down/);
  assert.deepEqual(of('notice').map(n => n.stage), ['tts']);
  assert.match(of('notice')[0].text, /Expressive voice.*hive's voice/);
  assert.deepEqual(of('spoken'), [{ sentences: 2, bytes: 9600, ms: 200, failed: 0, cut: false }]);
  p.close();
});

test('tts-engines: a speed past what the engines take is brought within 0.25–4, never sent to a 400', () => {
  const engines = require('../modules/tts-engines');
  const e = { ttsModel: 'm', ttsVoice: 'v', ttsSpeed: 1, tags: null };
  assert.equal(engines.body(e, 'Hi.', { speed: 10 }).speed, 4);
  assert.equal(engines.body(e, 'Hi.', { speed: 0.1 }).speed, 0.25);
  assert.equal(engines.body(e, 'Hi.', {}).speed, 1);
  assert.equal(engines.body(e, 'Hi.', { speed: 1.3 }).speed, 1.3);
});

test('/api/v1/call: the pause in use and each answer\'s audio are lines in the call\'s log', async () => {
  require('../modules/screens').set(watch.device.id, { call: { silenceMs: 600 } });
  const got = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${H.base.replace(/^http/, 'ws')}/api/v1/call`, { headers: { Authorization: `Bearer ${watch.token}` } });
    const g = { json: [], audio: 0 };
    const timer = setTimeout(() => { ws.close(); reject(new Error(JSON.stringify(g.json))); }, 15000);
    ws.on('message', (d, bin) => {
      if (bin) { g.audio += d.length; return; }
      const f = JSON.parse(d); g.json.push(f);
      if (f.type === 'ready') { ws.send(tone(800)); ws.send(quiet(800)); }   // 800 ms of quiet: over this device's 600 ms
      if (f.type === 'done') { clearTimeout(timer); ws.close(); resolve(g); }
    });
    ws.on('error', reject);
  });
  assert.ok(got.audio > 0);
  await tick(100);
  const lines = callLog._ring.filter(l => l.text.startsWith('Wrist')).map(l => l.text);
  assert.ok(lines.some(t => /pause that ends speech: 600 ms \(device\)/.test(t)), lines.join('\n'));
  assert.ok(lines.some(t => /answer spoken: 1 sentence\(s\), 0\.1 s of audio, 4800 bytes$/.test(t)), lines.join('\n'));
  assert.ok(!lines.some(t => /lights/i.test(t)), 'never the words');
  require('../modules/screens').set(watch.device.id, { call: null });
});

test('the call log is kept on disk, read back at start, and pruned after logs.callDays', () => {
  const store = require('../modules/store');
  const c = callLog.begin({ label: 'Disk test' });
  c.note('a stage worth keeping');
  c.end('stopped');
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(store.DATA_DIR, 'calls', `${today}.jsonl`);
  const kept = store.readJsonl(file).map(l => l.text);
  assert.ok(kept.some(t => t === 'Disk test · a stage worth keeping'));
  callLog._ring.length = 0;   // a restart
  callLog.reload();
  assert.ok(callLog._ring.some(l => l.text === 'Disk test · a stage worth keeping'), 'back after a restart');
  fs.writeFileSync(path.join(store.DATA_DIR, 'calls', '2020-01-01.jsonl'), '{}\n');
  assert.equal(callLog.prune(7), 1);
  assert.ok(fs.existsSync(file), 'today\'s stays');
  const keep = require('../modules/log-keep');
  const row = keep.usage().stores.find(s => s.id === 'calls-disk');
  assert.equal(row.where, 'disk'); assert.equal(row.settings[0].path, 'logs.callDays'); assert.equal(row.settings[0].value, 7);
  assert.ok(keep.EDITABLE.includes('logs.callDays'));
});

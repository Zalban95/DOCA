'use strict';

// A device's live call by the hive's own voice (modules/realtime/pipeline.js, /api/v1/call; docs/design/watch-call.md):
// the wire of /api/v1/realtime, with speech-to-text, a turn and text-to-speech behind it — stub voice services and the
// scripted model. What a watch reaches through its phone.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const WebSocket = require('ws');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');
const pipeline = require('../modules/realtime/pipeline');

let modelServer, voice, phone, script = [];
const heard = [];
const sse = text => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`); res.end('data: [DONE]\n\n'); };

/** 20 ms frames of a tone (speech) or near-silence (the room). */
const tone = (ms, amp = 6000) => { const b = Buffer.alloc(ms * 48); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(amp * Math.sin(i / 5)), i * 2); return b; };
const quiet = ms => tone(ms, 30);

before(async () => {
  modelServer = http.createServer((req, res) => { req.resume(); req.on('end', () => sse((script.shift() || { text: '(script exhausted)' }).text)(res)); });
  await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
  // One stub for both voice services: /v1/models answers, transcriptions hear "Turn on the lights.", speech is PCM.
  voice = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d));
    req.on('end', () => {
      if (req.url === '/v1/models') return res.end('{"data":[]}');
      if (req.url === '/v1/audio/transcriptions') { heard.push(Buffer.concat(chunks).length); res.setHeader('Content-Type', 'application/json'); return res.end('{"text":"Turn on the lights."}'); }
      if (req.url === '/v1/audio/speech') { const b = JSON.parse(Buffer.concat(chunks)); heard.push(b.response_format); return res.end(Buffer.alloc(4800)); }
      res.statusCode = 404; res.end();
    });
  });
  await new Promise(r => voice.listen(0, '127.0.0.1', r));
  process.env.DOCA_STT_URL = process.env.DOCA_TTS_URL = `http://127.0.0.1:${voice.address().port}`;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  require('../modules/terminal').setup(H.server());
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
  phone = H.mkDevice('Watch', 'watch', H.PHONE_CAPS);
});
after(async () => { delete process.env.DOCA_STT_URL; delete process.env.DOCA_TTS_URL; await H.stop(); modelServer.close(); voice.close(); });

test('an utterance is heard once, a blip is not, and an answer is spoken a sentence at a time', async () => {
  const seen = [], said = [];
  const p = pipeline.connect({ silenceMs: 200, transcribe: async () => 'Hello there', synth: async s => { said.push(s); return Buffer.alloc(9600); } });
  p.on('user', t => seen.push(['user', t])); p.on('tool', t => seen.push(['tool', t.args.request]));
  p.audio(Buffer.concat([quiet(400), tone(100), quiet(400)]));   // a click: not sent
  await new Promise(r => setImmediate(r));
  assert.deepEqual(seen, []);
  p.audio(Buffer.concat([tone(600), quiet(400)]));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(seen, [['user', 'Hello there'], ['tool', 'Hello there']]);
  let audio = 0, turn = false;
  p.on('audio', b => { audio += b.length; }); p.on('turn', () => { turn = true; });
  p.toolResult('p1', 'It is **on**. The [hall](http://x/y) too!');
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(said, ['It is on.', 'The hall too!'], 'no markdown read aloud, one request per sentence');
  assert.equal(audio, 19200); assert.ok(turn);
  p.close();
});

test('speech over the answer interrupts it and drops the rest', async () => {
  let release;
  const p = pipeline.connect({ silenceMs: 200, transcribe: async () => '', synth: s => s.startsWith('One') ? Promise.resolve(Buffer.alloc(96000)) : new Promise(r => { release = () => r(Buffer.alloc(4800)); }) });
  const ev = []; p.on('interrupted', () => ev.push('interrupted')); p.on('agent', t => ev.push(t.trim()));
  p.say('One long sentence. Two.');
  await new Promise(r => setTimeout(r, 10));
  p.audio(tone(60));
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ev.includes('interrupted'), false, 'a 60 ms click does not interrupt');
  p.audio(tone(400));
  release();
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(ev, ['One long sentence.', 'interrupted'], 'the second sentence is not spoken');
  p.close();
});

test('/api/v1/call: the hive\'s own voice when no realtime model is on — same wire, a turn per utterance', async () => {
  const st = await (await fetch(`${H.base}/api/v1/call`, { headers: { Authorization: `Bearer ${phone.token}` } })).json();
  assert.equal(st.engine, 'pipeline'); assert.equal(st.available, true); assert.equal(st.audio.rate, 24000);
  script = [{ text: 'Done. The lights are on.' }];
  heard.length = 0;
  const got = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${H.base.replace(/^http/, 'ws')}/api/v1/call`, { headers: { Authorization: `Bearer ${phone.token}` } });
    const g = { json: [], audio: 0 };
    const timer = setTimeout(() => { ws.close(); reject(new Error(JSON.stringify(g))); }, 15000);
    ws.on('message', (d, bin) => {
      if (bin) g.audio += d.length; else g.json.push(JSON.parse(d));
      if (g.json.at(-1)?.type === 'ready') { for (let i = 0; i < 10; i++) ws.send(tone(100)); ws.send(quiet(1600)); }
      if (g.json.some(x => x.type === 'done')) { g.busy = require('../modules/harness/drain').busy().map(t => t.kind); clearTimeout(timer); ws.close(); resolve(g); }
    });
    ws.on('error', reject);
  });
  assert.ok(got.busy.includes('call'), 'a call in progress holds a restart');
  assert.equal(got.json[0].type, 'ready'); assert.equal(got.json[0].protocol, 'pipeline'); assert.ok(got.json[0].sessionId);
  assert.ok(got.json.some(x => x.type === 'user' && x.text === 'Turn on the lights.'));
  assert.ok(got.json.some(x => x.type === 'working'));
  assert.deepEqual(got.json.filter(x => x.type === 'agent').map(x => x.text.trim()), ['Done.', 'The lights are on.']);
  assert.equal(got.audio, 9600, 'two sentences of PCM');
  assert.ok(heard.includes('pcm'), 'speech is asked for as raw PCM');
  assert.ok(heard[0] > 44 + 48000, 'the utterance reached speech-to-text as one WAV');
  const sid = got.json[0].sessionId;
  assert.ok(require('../modules/harness/memory').messages(sid).some(m => m.role === 'user' && m.content === 'Turn on the lights.'), 'a turn of the device\'s conversation');
});

test('an answer that is only "✓" is shown, not spoken', async () => {
  const said = [], ev = [];
  const p = pipeline.connect({ silenceMs: 200, transcribe: async () => '', synth: async s => { said.push(s); return Buffer.alloc(4800); } });
  p.on('agent', t => ev.push(t)); p.on('turn', () => ev.push('turn'));
  p.toolResult('p1', '✓');
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(said, []);
  assert.deepEqual(ev, ['✓', 'turn']);
  p.close();
});

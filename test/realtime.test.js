'use strict';

// Realtime voice (modules/realtime; TODO H8.3, an experiment): a live call relayed by the hub to a speech-to-speech
// service — stub servers for the OpenAI Realtime protocol and for Gemini Live, and the scripted model for the turns
// the voice hands to the hive through its one tool, `doca`.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const WebSocket = require('ws');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let modelServer, oai, gem, phone, viewer, script = [];
const oaiSeen = [], gemSeen = [];
const sse = text => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`); res.end('data: [DONE]\n\n'); };

// The OpenAI-protocol stub: hears audio, says what it heard, and asks doca once per utterance.
function openaiStub(ws, req) {
  oaiSeen.push({ type: 'connect', auth: req.headers.authorization, url: req.url });
  ws.on('message', raw => {
    const m = JSON.parse(raw); oaiSeen.push(m);
    if (m.type === 'input_audio_buffer.append') {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
      ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'How many containers?' }));
      ws.send(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: `c${oaiSeen.length}`, name: 'doca', arguments: JSON.stringify({ request: 'How many containers are running?' }) }));
    }
    if (m.type === 'response.create') {
      ws.send(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'Four.' }));
      ws.send(JSON.stringify({ type: 'response.output_audio.delta', delta: Buffer.alloc(480).toString('base64') }));
      ws.send(JSON.stringify({ type: 'response.done' }));
    }
  });
}

function geminiStub(ws, req) {
  gemSeen.push({ type: 'connect', url: req.url });
  ws.on('message', raw => {
    const m = JSON.parse(raw); gemSeen.push(m);
    if (m.setup) ws.send(JSON.stringify({ setupComplete: {} }));
    if (m.realtimeInput) {
      ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Hello there' } } }));
      ws.send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'g1', name: 'doca', args: { request: 'Say hello' } }] } }));
    }
    if (m.toolResponse) ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(960).toString('base64') } }] }, turnComplete: true } }));
  });
}

const stub = handler => new Promise(r => { const s = new WebSocket.WebSocketServer({ port: 0, host: '127.0.0.1' }); s.on('connection', handler); s.on('listening', () => r(s)); });

before(async () => {
  modelServer = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => { const next = script.shift() || { text: '(script exhausted)' }; setTimeout(() => sse(next.text)(res), next.delay || 0); });
  });
  await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
  oai = await stub(openaiStub);
  gem = await stub(geminiStub);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: {
    stub: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKey: 'k', models: ['stub-model'] },
    rtlocal: { baseUrl: `http://127.0.0.1:${oai.address().port}/v1`, apiKey: 'rt-key', models: [] } } } }));
  await H.start();
  // The socket router is attached where the server listens (server.js); the test server needs it too.
  require('../modules/terminal').setup(require('./helpers').server());
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
  phone = H.mkDevice('Phone', 'phone', H.PHONE_CAPS);
  viewer = H.mkDevice('Viewer', 'viewer', {});
});
after(async () => { await H.stop(); modelServer.close(); oai.close(); gem.close(); });

/** Open a call; collect what the hub says until `until` holds. */
function call(path, headers, until, send = ws => ws.send(Buffer.alloc(4800))) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(H.base.replace(/^http/, 'ws') + path, { headers });
    const got = { json: [], audio: 0 };
    const timer = setTimeout(() => { ws.close(); reject(new Error(`timed out: ${JSON.stringify(got)}`)); }, 15000);
    ws.on('message', (d, bin) => {
      if (bin) got.audio += d.length; else got.json.push(JSON.parse(d));
      if (got.json.at(-1)?.type === 'ready') send(ws);
      if (until(got)) { clearTimeout(timer); ws.close(); resolve(got); }
    });
    ws.on('unexpected-response', (_q, res) => { clearTimeout(timer); resolve({ status: res.statusCode }); });
    ws.on('error', e => { clearTimeout(timer); reject(e); });
  });
}
const cookie = () => ({ Cookie: H.owner.cookie });
const set = body => H.api(null, 'POST', '/api/realtime', body);

test('off until the experiment is on and a model is set; the owner chooses the service', async () => {
  const s = (await H.api(null, 'GET', '/api/realtime')).body;
  assert.equal(s.available, false);
  assert.deepEqual(s.audio, { format: 'pcm16', rate: 24000, channels: 1 });
  const got = await call('/ws/realtime', cookie(), g => g.json.some(x => x.type === 'error'));
  assert.match(got.json[0].message, /Realtime voice is off/);
  assert.equal((await set({ protocol: 'skype' })).status, 400);
  assert.equal((await set({ url: 'http://not-a-socket' })).status, 400);
  await H.api(null, 'POST', '/api/experiments/realtimeVoice', { on: true });
  const r = await set({ protocol: 'openai', provider: 'rtlocal', model: 'stub-rt', waitSec: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.available, true);
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'POST', '/api/realtime', { model: 'x' }, { Cookie: member.cookie })).status, 403, 'choosing the service is the owner\'s');
  assert.equal((await H.api(null, 'GET', '/api/realtime', undefined, { Cookie: member.cookie })).status, 200);
  assert.equal((await call('/ws/realtime', { Cookie: '' }, () => false)).status, 401);
});

test('OpenAI protocol: the key stays on the hub, the voice hands the request to the hive and says its answer', async () => {
  oaiSeen.length = 0;
  script = [{ text: 'Four containers are running.' }];
  const got = await call('/ws/realtime', cookie(), g => g.json.some(x => x.type === 'done'));
  assert.equal(oaiSeen[0].auth, 'Bearer rt-key', 'the provider key from Settings → API Keys, sent by the hub');
  assert.match(oaiSeen[0].url, /^\/v1\/realtime\?model=stub-rt$/);
  const upd = oaiSeen.find(m => m.type === 'session.update');
  assert.equal(upd.session.audio.input.format.rate, 24000);
  assert.deepEqual(upd.session.tools.map(t => t.name), ['doca'], 'one tool: the hive');
  assert.ok(oaiSeen.some(m => m.type === 'input_audio_buffer.append' && Buffer.from(m.audio, 'base64').length === 4800), 'the microphone relayed as is');
  const out = oaiSeen.find(m => m.item?.type === 'function_call_output');
  assert.equal(out.item.output, 'Four containers are running.');
  assert.ok(got.json.some(x => x.type === 'user' && /containers/.test(x.text)));
  assert.ok(got.json.some(x => x.type === 'working'));
  assert.ok(got.json.some(x => x.type === 'interrupted'), 'speech over an answer is the service\'s barge-in, passed on');
  assert.equal(got.audio, 480);
  const main = require('../modules/harness/memory').mainSession().id;
  assert.ok(require('../modules/harness/memory').messages(main).some(m => m.role === 'user' && m.content === 'How many containers are running?'), 'the request is a turn in the conversation');
});

test('work longer than waitSec carries on, and its answer is given to the voice when it finishes', async () => {
  oaiSeen.length = 0;
  script = [{ text: 'The backup finished: 3 GB.', delay: 4500 }];
  await call('/ws/realtime', cookie(), () => oaiSeen.some(m => m.item?.role === 'system'));
  const out = oaiSeen.find(m => m.item?.type === 'function_call_output');
  assert.match(out.item.output, /Still working on it in the background/);
  assert.match(oaiSeen.find(m => m.item?.role === 'system').item.content[0].text, /The backup finished: 3 GB/);
});

test('Gemini Live: setup, 16 kHz in, the tool answered by id and name', async () => {
  await set({ protocol: 'gemini', url: `ws://127.0.0.1:${gem.address().port}/live`, model: 'gemini-live-stub' });
  gemSeen.length = 0;
  script = [{ text: 'Hello!' }];
  const got = await call('/ws/realtime', cookie(), g => g.json.some(x => x.type === 'done'));
  assert.equal(gemSeen.find(m => m.setup).setup.model, 'models/gemini-live-stub');
  assert.equal(gemSeen.find(m => m.setup).setup.tools[0].functionDeclarations[0].name, 'doca');
  const audioIn = gemSeen.find(m => m.realtimeInput).realtimeInput.audio;
  assert.equal(audioIn.mimeType, 'audio/pcm;rate=16000');
  assert.equal(Buffer.from(audioIn.data, 'base64').length, 3200, '4800 bytes at 24 kHz are 3200 at 16 kHz');
  assert.deepEqual(gemSeen.find(m => m.toolResponse).toolResponse.functionResponses[0], { id: 'g1', name: 'doca', response: { result: 'Hello!' } });
  assert.equal(got.audio, 960);
});

test('the resampler keeps a steady signal steady', () => {
  const pcm = Buffer.alloc(600); for (let i = 0; i < 300; i++) pcm.writeInt16LE(1000, i * 2);
  const out = require('../modules/realtime/gemini').to16k(pcm);
  assert.equal(out.length, 400);
  for (let i = 0; i < 200; i++) assert.equal(out.readInt16LE(i * 2), 1000);
});

test('a paired device calls with its token, as its person; a token without harness:chat cannot', async () => {
  await set({ protocol: 'openai', url: '', provider: 'rtlocal', model: 'stub-rt' });
  const st = await fetch(`${H.base}/api/v1/realtime`, { headers: { Authorization: `Bearer ${phone.token}` } });
  assert.equal(st.status, 200);
  assert.equal((await st.json()).available, true);
  assert.equal((await fetch(`${H.base}/api/v1/realtime`, { headers: { Authorization: `Bearer ${viewer.token}` } })).status, 403);
  script = [{ text: 'Two.' }];
  const got = await call('/api/v1/realtime', { Authorization: `Bearer ${phone.token}` }, g => g.json.some(x => x.type === 'done'));
  assert.ok(got.json.find(x => x.type === 'ready').sessionId, 'a conversation of the device\'s own');
  assert.equal((await call('/api/v1/realtime', { Authorization: `Bearer ${viewer.token}` }, () => false)).status, 403);
  assert.equal((await call('/api/v1/realtime?access_token=nope', {}, () => false)).status, 401);
});

test('the measurement runs against whatever service is set, and prints its row', async () => {
  const lines = [], log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { assert.equal(await require('../bin/experiments/realtime-voice').measure(), 0); } finally { console.log = log; }
  assert.match(lines.at(-1), /\| openai \/ stub-rt \| \d of 5 routed right \| [\d.]+ s median to first audio \| 0 failed \|/);
});

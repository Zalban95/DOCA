'use strict';

// Every stage of a live call reports itself (asked 2026-10-08: "it fails silently"): the pipeline says what it dropped
// and why (modules/realtime/pipeline.js), the call sends a `notice` frame when a stage fails, and the hub keeps each
// stage in names and numbers (modules/realtime/call-log.js) — read by Hub → Logs (source `call`) and Chronicle. The
// panel's own call reports from the page and is logged from the hub's side too (modules/realtime/panel-call.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const WebSocket = require('ws');
const H = require('./helpers');
process.env.DOCA_CALL_IDLE_MS = '7500';   // a call with nothing said ends after this (realtime/index.js): here 7.5 s, not 5 min
const { CONFIG_PATH } = require('../modules/paths');
const pipeline = require('../modules/realtime/pipeline');
const callLog = require('../modules/realtime/call-log');

let modelServer, voice, watch, sttText = 'Turn on the lights.', modelDelay = 0;
const sse = text => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`); res.end('data: [DONE]\n\n'); };
const tone = (ms, amp = 6000) => { const b = Buffer.alloc(ms * 48); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(amp * Math.sin(i / 5)), i * 2); return b; };
const quiet = ms => tone(ms, 10);
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

before(async () => {
  modelServer = http.createServer((req, res) => { req.resume(); req.on('end', () => setTimeout(() => sse('Done.')(res), modelDelay)); });
  await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
  voice = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/v1/models') return res.end('{"data":[]}');
      if (req.url === '/v1/audio/transcriptions') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ text: sttText })); }
      if (req.url === '/v1/audio/speech') return res.end(Buffer.alloc(4800));
      res.statusCode = 404; res.end();
    });
  });
  await new Promise(r => voice.listen(0, '127.0.0.1', r));
  process.env.DOCA_STT_URL = process.env.DOCA_TTS_URL = `http://127.0.0.1:${voice.address().port}`;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  require('../modules/terminal').setup(H.server());
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
  watch = H.mkDevice('Wrist', 'watch', H.WATCH_CAPS);
});
after(async () => { delete process.env.DOCA_STT_URL; delete process.env.DOCA_TTS_URL; await H.stop(); modelServer.close(); voice.close(); });

/** The pipeline alone, with its events gathered. */
function listen(opts) {
  const p = pipeline.connect({ silenceMs: 200, synth: async () => Buffer.alloc(4800), ...opts });
  const ev = [];
  for (const t of ['notice', 'stt', 'dropped', 'utterance', 'user']) p.on(t, x => ev.push([t, x]));
  p.on('error', () => {});
  return { p, ev, of: t => ev.filter(e => e[0] === t).map(e => e[1]) };
}

test('a quiet wrist is heard: speech at -40 dBFS counts (the old floor of 400 dropped it without a word)', async () => {
  const { p, of } = listen({ transcribe: async () => 'Hello' });
  p.audio(Buffer.concat([quiet(400), tone(600, 300), quiet(400)]));   // RMS ≈ 212: under the old 400, over the new 90
  await tick();
  assert.deepEqual(of('user'), ['Hello']);
  assert.equal(of('utterance').length, 1);
  p.close();
});

test('sound too quiet to be speech is said after a long stretch, once — not two seconds in (2026-10-09)', async () => {
  const { p, of } = listen({ transcribe: async () => 'never' });
  const murmur = ms => Buffer.concat(Array.from({ length: Math.round(ms / 900) }, () => Buffer.concat([tone(600, 60), quiet(300)])));   // RMS ≈ 42 in bursts: over the room, under speech
  p.audio(Buffer.concat([quiet(400), murmur(3000)]));   // a breath, a rustle
  await tick();
  assert.equal(of('notice').length, 0, 'three seconds of it is not yet a microphone too far');
  p.audio(murmur(12000));
  await tick();
  assert.equal(of('user').length, 0);
  assert.deepEqual(of('notice').map(n => n.stage), ['audio']);
  p.audio(murmur(12000));
  await tick();
  assert.equal(of('notice').length, 1, 'once, until words come through');
  p.close();
});

test('no words, a silence phrase, and a transcriber that fails: each says so to the caller and in the log', async () => {
  for (const [transcribe, stt, said] of [
    [async () => '', { words: 0 }, /didn.t catch that/],
    [async () => ({ text: '', filtered: 'Thank you.' }), { filtered: 'Thank you.' }, /didn.t catch that/],
    [async () => { throw new Error('STT error 500'); }, { error: 'STT error 500' }, /transcriber did not answer/],
  ]) {
    const { p, of } = listen({ transcribe });
    p.audio(Buffer.concat([tone(600), quiet(400)]));
    await tick();
    assert.equal(of('user').length, 0);
    const got = of('stt')[0];
    for (const [k, v] of Object.entries(stt)) assert.equal(got[k], v, k);
    assert.match(of('notice')[0].text, said);
    assert.equal(of('notice')[0].stage, 'stt');
    p.close();
  }
  const blip = listen({ transcribe: async () => 'x' });
  blip.p.audio(Buffer.concat([tone(100), quiet(400)]));
  await tick();
  assert.match(blip.of('dropped')[0], /100 ms of speech/);
  blip.p.close();
});

test('a microphone that sends exact silence for ten seconds is said to be muted', async () => {
  const { p, of } = listen({ transcribe: async () => 'x' });
  p.audio(tone(200, 5));
  p.audio(Buffer.alloc(48 * 10200));
  await tick();
  assert.match(of('notice')[0]?.text || '', /only silence for a while/);
  p.close();
});

/** A device's call: frames gathered until `until` says enough. */
function call(send, until, ms = 12000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${H.base.replace(/^http/, 'ws')}/api/v1/call`, { headers: { Authorization: `Bearer ${watch.token}`, 'X-Doca-Client': 'DocaWear (via DocaMobile)' } });
    const got = [];
    const timer = setTimeout(() => { ws.close(); reject(new Error(JSON.stringify(got))); }, ms);
    ws.on('message', (d, bin) => {
      if (bin) return;
      got.push(JSON.parse(d));
      if (got.at(-1).type === 'ready') send(ws);
      if (until(got)) { clearTimeout(timer); ws.close(); resolve(got); }
    });
    ws.on('error', reject);
  });
}

test('/api/v1/call: a recording with no words sends a notice, and the call\'s log says each stage', async () => {
  sttText = '';
  const got = await call(ws => { ws.send(tone(600)); ws.send(quiet(1600)); }, g => g.some(f => f.type === 'notice'));
  sttText = 'Turn on the lights.';
  const n = got.find(f => f.type === 'notice');
  assert.equal(n.stage, 'stt'); assert.match(n.text, /didn.t catch that/);
  await tick(50);
  const lines = callLog._ring.filter(l => l.text.startsWith('Wrist — DocaWear (via DocaMobile)')).map(l => l.text);
  assert.ok(lines.some(t => /speech found: \d+ ms/.test(t)), lines.join('\n'));
  assert.ok(lines.some(t => /transcriber found no words/.test(t)));
  assert.ok(lines.some(t => /ended after .* audio frames, \d+ bytes, peak \d+/.test(t)), 'the close sums it up');
  assert.ok(!lines.some(t => /lights/i.test(t)), 'never the words');
});

test('/api/v1/call: no sound is said; nothing said ends the call (a watch that left its call screen held one for an hour)', { timeout: 20000 }, async () => {
  const got = await call(() => {}, g => g.some(f => f.type === 'closed'), 15000);
  const notices = got.filter(f => f.type === 'notice').map(f => f.text);
  assert.match(notices[0], /No sound is reaching the hub/);
  assert.match(notices[1], /Nothing was said for five minutes/);
  assert.equal(got.find(f => f.type === 'closed').reason, 'nothing was said for five minutes');
});

test('the panel\'s call: the page opens a record, its transcriptions and turns are logged from the hub\'s side, a hang-up mid-answer is named', async () => {
  const { call: id } = (await H.api(null, 'POST', '/api/chat/call-event', { stage: 'start', mobile: true, threshold: 15 })).body;
  assert.match(id, /^call_/);
  const member = await H.signIn('member');
  const other = await H.api(null, 'POST', '/api/chat/call-event', { stage: 'level', call: id, peak: 3 }, { Cookie: member.cookie });
  assert.equal(other.status, 404, 'another person cannot write into this call');
  await H.api(null, 'POST', '/api/chat/call-event', { stage: 'sent', call: id, ms: 2100, voicedMs: 900, peak: 60 });
  const form = new FormData();
  form.append('audio', new Blob([Buffer.alloc(2000)], { type: 'audio/wav' }), 'r.wav');
  form.append('call', id);
  sttText = 'Thank you.';
  const tr = await (await fetch(`${H.base}/api/chat/transcribe`, { method: 'POST', body: form, headers: { Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin' } })).json();
  sttText = 'Turn on the lights.';
  assert.equal(tr.text, ''); assert.equal(tr.screened, true);
  modelDelay = 1500;
  const ctrl = new AbortController();
  const res = await fetch(`${H.base}/api/chat`, { method: 'POST', signal: ctrl.signal, headers: { Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'what time is it', voice: 'call', call: id }) });
  await tick(300); ctrl.abort();   // the page hangs up on the answer, as the 2026-10-08 call did 689 ms in
  res.body?.cancel?.().catch(() => {});
  await tick(200);
  modelDelay = 0;
  await H.api(null, 'POST', '/api/chat/call-event', { stage: 'end', call: id, why: 'the person ended the call, while an answer was being made' });
  const lines = callLog._ring.filter(l => l.callId === id).map(l => `${l.level} ${l.text}`);
  const all = lines.join('\n');
  assert.match(all, /the page opened the microphone on a phone/);
  assert.match(all, /speech found: 2100 ms, 900 ms of it voiced/);
  assert.match(all, /transcriber heard only "Thank you\." .* a silence phrase/);
  assert.match(all, /turn started: 4 words asked/);
  assert.match(all, /turn cut: the page closed the answer's stream \d+ ms after it started/);
  assert.match(all, /ended after .*the person ended the call, while an answer was being made/);
  // Read back where a person looks: the Logs source and Chronicle.
  assert.ok((await H.api(null, 'GET', '/api/logs/sources')).body.sources.some(s => s.id === 'call' && s.available));
  const ch = (await H.api(null, 'GET', `/api/chronicle?source=call&q=${encodeURIComponent('turn cut')}`)).body;
  assert.ok(ch.rows.some(r => r.source === 'call' && /turn cut/.test(r.text)));
  const mine = (await H.api(null, 'GET', '/api/chronicle?source=call', undefined, { Cookie: member.cookie })).body;
  assert.ok(!mine.rows.some(r => r.text.includes('the panel — live call')), 'another person\'s call is not theirs to read');
  assert.ok((await H.api(null, 'GET', '/api/logs/keep')).body.stores.some(s => s.id === 'calls' && s.entries > 0));
});

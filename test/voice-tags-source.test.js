'use strict';

// A spoken answer's tone tags (modules/voice-tags.js) are the voice's, never words (2026-10-08: a watch showed
// "[calm] Perfect —"). The turn keeps them apart at the source: its text — stored, shown, sent to every device and
// chat — is clean, and each piece's `spoken` carries them for whatever speaks it. Also here: a call's voice follows a
// change made mid-call, and the subtitle credits a transcriber invents in room noise are not sent as words.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder

const { CONFIG_PATH } = require('../modules/paths');
const ANSWER = ['[calm] Perfect — ', 'it works. [whis', 'pers] Goodnight.'];
let model, voice, spokenWith = [];

before(async () => {
  model = http.createServer((req, res) => { req.resume(); req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const piece of ANSWER) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  }); });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  voice = http.createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
    if (req.url === '/v1/audio/speech') { spokenWith.push(JSON.parse(raw).voice); return res.end(Buffer.alloc(480)); }
    res.statusCode = 404; res.end();
  }); });
  await new Promise(r => voice.listen(0, '127.0.0.1', r));
  process.env.DOCA_TTS_URL = `http://127.0.0.1:${voice.address().port}`;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'k', models: ['m'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'm' });
});
after(async () => { delete process.env.DOCA_TTS_URL; await H.stop(); model.close(); voice.close(); });

test('a spoken turn keeps its tags apart: clean text and stored row, the tags only in each piece\'s `spoken`', async () => {
  const agent = require('../modules/harness/agent');
  const memory = require('../modules/harness/memory');
  const pieces = [];
  const r = await agent.turn({ message: 'test the voice', sessionId: memory.createSession('call', { activate: false }).id,
    client: { id: null, name: 'test', formFactor: 'desktop', mode: 'assistant' }, emit: e => { if (e.type === 'text') pieces.push(e); } });
  assert.equal(r.text, 'Perfect — it works. Goodnight.');
  assert.equal(pieces.map(p => p.text).join(''), r.text, 'what is shown is the same clean text, a tag split across pieces included');
  assert.equal(pieces.map(p => p.spoken).join(''), ANSWER.join(''), 'what is spoken keeps every tag');
  const rows = memory.messages(r.sessionId).filter(m => m.role === 'assistant');
  assert.equal(rows.at(-1).content, 'Perfect — it works. Goodnight.');
});

test('a typed turn is left as the model wrote it', async () => {
  const r = await require('../modules/harness/agent').turn({ message: 'hi', sessionId: require('../modules/harness/memory').createSession('typed', { activate: false }).id, emit: () => {} });
  assert.equal(r.text, ANSWER.join(''));
});

test('a watch\'s spoken turn reaches every device without tags; the panel\'s call stream carries them only as `spoken`', async () => {
  const watch = H.mkDevice('Wrist', 'watch', H.WATCH_CAPS);
  const phone = H.mkDevice('Pocket', 'phone', H.PHONE_CAPS);
  const onPhone = H.sse(phone.token); await onPhone.ready;
  const posted = await H.api(watch.token, 'POST', '/api/v1/harness/messages', { message: 'how is it?', voice: 'assistant' });
  assert.equal(posted.status, 202);
  const done = await onPhone.waitFor(e => e.type === 'agent.turn' && e.payload.turnId === posted.body.turnId && e.payload.state === 'done', 10000);
  assert.equal(done.payload.text, 'Perfect — it works. Goodnight.');
  onPhone.close();

  const res = await fetch(`${H.base}/api/chat`, { method: 'POST', headers: { Cookie: H.owner.cookie, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ message: 'and now?', voice: 'call' }) });
  const events = (await res.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6))).filter(e => e.type === 'text');
  assert.equal(events.map(e => e.text).join(''), 'Perfect — it works. Goodnight.');
  assert.equal(events.map(e => e.spoken).join(''), ANSWER.join(''));
});

test('a voice changed during a call is the voice of its next sentence: nothing is kept from before', async () => {
  const u = require('../modules/utils');
  spokenWith = [];
  u.savePrefs({ ...u.loadPrefs(), voiceServices: { ...(u.loadPrefs().voiceServices || {}), ttsVoice: 'am_first' } });
  await H.api(null, 'POST', '/api/chat/synthesize', { text: 'One.', call: 'deep' });
  u.savePrefs({ ...u.loadPrefs(), voiceServices: { ...u.loadPrefs().voiceServices, ttsVoice: 'am_second' } });
  await H.api(null, 'POST', '/api/chat/synthesize', { text: 'Two.', call: 'deep' });
  assert.deepEqual(spokenWith, ['am_first', 'am_second']);
});

test('the subtitle credits a transcriber invents in room noise are screened; words that only start alike are not', () => {
  const { isHallucination } = require('../modules/stt-filter');
  for (const t of ['КОНЕЦ', 'Субтитры сделал Someone', 'Sottotitoli creati dalla comunità Amara.org', 'Subtitles by the team', 'Продолжение следует...'])
    assert.equal(isHallucination(t), true, t);
  for (const t of ['Subtitles on, please', 'Fine.', 'Change the voice', 'The end of the street'])
    assert.equal(isHallucination(t), false, t);
});

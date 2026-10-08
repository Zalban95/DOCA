'use strict';

// The language a person speaks, for the transcriber and the answer (2026-10-08: run_798be61c7bd0 — a two-word
// question in a Live call came back from whisper as "Что это?" and was answered in Russian to a person who speaks
// English). The screen's `call.language` is told to the transcriber; without one, a short transcript in another
// language than the person's usual one is asked for again in theirs (modules/stt.js, call-language.js), the call log
// says which language it was, and a spoken turn is told to answer in their language and treat a lone foreign
// transcript as a mishearing (turn/client.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');
const lang = require('../modules/lang-guess');
const callLang = require('../modules/call-language');
const callLog = require('../modules/realtime/call-log');

let modelServer, stt, sttAsked = [], systems = [];
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

before(async () => {
  // A scripted model: it answers the lone Russian line in English only when its prompt says the person speaks English.
  modelServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      const system = String(j.messages?.find(m => m.role === 'system')?.content || '');
      // The person's own last words (the panel's readings ride on a user row of their own, in brackets).
      const last = String([...(j.messages || [])].reverse().find(m => m.role === 'user' && !/^\s*\[/.test(String(m.content)))?.content || '');
      systems.push(system);
      const foreign = lang.guess(last) === 'ru';
      const text = !foreign ? 'Sure.' : /They usually speak English/.test(system) && /do not answer it in that language/.test(system)
        ? 'Sorry, I did not catch that. Could you say it again?' : 'Это твой рабочий стол.';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
  // A transcriber that hears Russian in a noisy second unless it is told the language.
  stt = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/v1/models') return res.end('{"data":[]}');
      const raw = Buffer.concat(chunks).toString('latin1');
      const language = (/name="language"\r\n\r\n([a-z]{2})/.exec(raw) || [])[1] || null;
      sttAsked.push(language);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ text: language === 'en' ? 'What is this?' : language === 'it' ? 'Che cos\'è?' : 'Что это?' }));
    });
  });
  await new Promise(r => stt.listen(0, '127.0.0.1', r));
  process.env.DOCA_STT_URL = process.env.DOCA_TTS_URL = `http://127.0.0.1:${stt.address().port}`;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
  await H.api(null, 'GET', '/api/screen');   // this browser's screen record
});
after(async () => { delete process.env.DOCA_STT_URL; delete process.env.DOCA_TTS_URL; await H.stop(); modelServer.close(); stt.close(); });

const chat = async body => (await fetch(`${H.base}/api/chat`, { method: 'POST',
  headers: { Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).text();
const transcribe = async (call) => {
  const form = new FormData();
  form.append('audio', new Blob([Buffer.alloc(2000)], { type: 'audio/wav' }), 'r.wav');
  if (call) form.append('call', call);
  return (await fetch(`${H.base}/api/chat/transcribe`, { method: 'POST', body: form, headers: { Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin' } })).json();
};

test('a short text\'s language, by script and common words; unsure says null', () => {
  assert.equal(lang.guess('Что это?'), 'ru');
  assert.equal(lang.guess('Can you speak English? I asked what\'s the weather?'), 'en');
  assert.equal(lang.guess('Che tempo fa oggi a Pesaro?'), 'it');
  assert.equal(lang.guess('Okay'), null);
  assert.equal(lang.codeOf('English'), 'en');
});

test('the person\'s usual language is the one most of their messages were in', async () => {
  for (const m of ['What is the weather like today?', 'Can you check the lights in the kitchen?', 'What is my day like?', 'Thanks, that is all for now.'])
    await chat({ message: m });
  callLang.forget();
  assert.ok(ownerId(), 'the conversation is the owner\'s');
  assert.equal(callLang.usual(ownerId())?.code, 'en');
});

function ownerId() {
  const sid = require('../modules/harness/memory').mainSession().id;
  return require('../modules/harness/session-access').ownerOf(sid);
}

test('a short transcript in another language is asked for again in the person\'s, and the call log says so', async () => {
  callLang.forget();
  const { call } = (await H.api(null, 'POST', '/api/chat/call-event', { stage: 'start', assistant: true })).body;
  sttAsked = [];
  const tr = await transcribe(call);
  assert.deepEqual(sttAsked, [null, 'en'], 'whisper guessed first, then was told the usual language');
  assert.equal(tr.text, 'What is this?');
  assert.equal(tr.language, 'en');
  await tick();
  const line = callLog._ring.filter(l => l.callId === call).map(l => l.text).join('\n');
  assert.match(line, /transcribed 3 words in \d+ ms, in en \(first heard as ru, asked again in en\)/);
  await H.api(null, 'POST', '/api/chat/call-event', { stage: 'end', call, why: 'test' });
});

test('a screen that chose its language tells the transcriber, which then does not guess', async () => {
  const set = await H.api(null, 'POST', '/api/screen/settings', { call: { language: 'it' } });
  assert.equal(set.status, 200);
  sttAsked = [];
  const tr = await transcribe();
  assert.deepEqual(sttAsked, ['it']);
  assert.equal(tr.text, 'Che cos\'è?');
  await H.api(null, 'POST', '/api/screen/settings', { call: null });
});

test('a lone foreign transcript in a call is answered in the person\'s language, not in its own', async () => {
  callLang.forget();
  systems = [];
  await chat({ message: 'Что это?', voice: 'assistant' });
  const memory = require('../modules/harness/memory');
  const rows = memory.messages(memory.mainSession().id);
  const answer = [...rows].reverse().find(r => r.role === 'assistant' && r.content)?.content || '';
  assert.match(systems.at(-1), /They usually speak English: answer in English unless they have clearly switched/);
  assert.match(answer, /did not catch that/, 'answered in English, asking again');
});

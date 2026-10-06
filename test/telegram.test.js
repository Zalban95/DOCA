'use strict';

// Telegram as a channel (modules/channels/telegram): a stub Bot API on a local port and the scripted model, so
// no network and no key. A chat is linked by a code a signed-in person made; what it writes is a turn as that
// person, the answer comes back as a message, a question as buttons, a voice note through the STT.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let tgServer, modelServer, script = [];
const updates = [], sent = [];
let updateId = 1, msgId = 100;
const waiters = [];
const record = (method, body) => { sent.push({ method, body }); for (const w of [...waiters]) if (w.test({ method, body })) { waiters.splice(waiters.indexOf(w), 1); w.resolve({ method, body }); } };
const waitSent = (test, ms = 8000) => {
  const hit = sent.find(test);
  if (hit) { sent.splice(sent.indexOf(hit), 1); return Promise.resolve(hit); }
  return new Promise((resolve, reject) => {
    const w = { test, resolve: v => { sent.splice(sent.indexOf(v), 1); resolve(v); } };
    waiters.push(w);
    setTimeout(() => reject(new Error(`nothing sent matching in ${ms} ms; sent: ${JSON.stringify(sent.map(s => [s.method, s.body.text]))}`)), ms).unref();
  });
};
const userSays = (chat, message) => updates.push({ update_id: updateId++, message: { message_id: msgId++, chat: { id: chat, type: 'private', first_name: 'Sam' }, from: { id: chat, is_bot: false }, ...message } });
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  tgServer = http.createServer((req, res) => {
    let raw = [];
    req.on('data', d => raw.push(d));
    req.on('end', async () => {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url) || [];
      const file = /^\/file\/bot[^/]+\/(.+)$/.exec(req.url);
      if (file) { res.writeHead(200); return res.end(Buffer.from('OggS-fake-voice')); }
      if (m[1] !== 'TEST:TOKEN') { res.writeHead(401); return res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' })); }
      const ok = result => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
      const ct = req.headers['content-type'] || '';
      const body = ct.includes('json') ? JSON.parse(Buffer.concat(raw).toString() || '{}') : { multipart: true, bytes: Buffer.concat(raw).length };
      if (m[2] === 'getMe') return ok({ id: 42, is_bot: true, first_name: 'Doca', username: 'doca_test_bot' });
      if (m[2] === 'getUpdates') {
        const send = () => ok(updates.splice(0).filter(u => u.update_id >= (body.offset || 0)));
        if (updates.length) return send();
        return setTimeout(send, 60);
      }
      if (m[2] === 'getFile') return ok({ file_id: body.file_id, file_path: 'voice/file_1.oga' });
      record(m[2], body);
      return ok({ message_id: msgId++, chat: { id: body.chat_id } });
    });
  });
  await new Promise(r => tgServer.listen(0, '127.0.0.1', r));
  process.env.DOCA_TELEGRAM_API = `http://127.0.0.1:${tgServer.address().port}`;

  modelServer = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] })); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.stream === false) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })); }
      const next = script.shift() || { text: '(script exhausted)' };
      if (next.tool) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args || {}) } }] } }] }])(res);
      next.seen?.(body);
      return sse([{ choices: [{ delta: { content: next.text } }] }])(res);
    });
  });
  await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model', pollSec: 0 });
});

after(async () => {
  require('../modules/channels/telegram').stop();
  await H.stop();
  await new Promise(r => tgServer.close(r));
  await new Promise(r => modelServer.close(r));
});

test('a host switches the bot on; the token never reads back', async () => {
  const off = await H.api(null, 'GET', '/api/channels/telegram');
  assert.equal(off.body.running, false);
  const u = require('../modules/utils'); const p = u.loadPrefs(); p.channels = { telegram: { pollSec: 0 } }; u.savePrefs(p);
  const r = await H.api(null, 'POST', '/api/channels/telegram', { botToken: 'TEST:TOKEN', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.running, true);
  assert.equal(r.body.bot.username, 'doca_test_bot');
  const prefs = await H.api(null, 'GET', '/api/prefs');
  assert.ok(!JSON.stringify(prefs.body).includes('TEST:TOKEN'), 'masked like every secret');
  const member = await H.signIn('member', 'tg-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/channels/telegram', { enabled: false }, { Cookie: member.cookie })).status, 403);
});

test('a stranger gets instructions; a code links the chat to the person who made it; their message is a turn', async () => {
  userSays(7001, { text: 'hello?' });
  assert.match((await waitSent(s => s.method === 'sendMessage' && s.body.chat_id === 7001)).body.text, /Settings → Channels/);

  const link = await H.api(null, 'POST', '/api/channels/telegram/link');
  assert.match(link.body.code, /^[0-9A-F]{10}$/);
  assert.equal(link.body.link, `https://t.me/doca_test_bot?start=${link.body.code}`);
  userSays(7001, { text: `/start ${link.body.code}` });
  assert.match((await waitSent(s => s.method === 'sendMessage' && s.body.chat_id === 7001)).body.text, /^Linked to owner/);

  let prompt = '';
  script = [{ text: 'Twelve containers are running.', seen: b => { prompt = b.messages.find(m => m.role === 'system').content; } }];
  userSays(7001, { text: 'how many containers?' });
  assert.equal((await waitSent(s => s.method === 'sendMessage' && s.body.chat_id === 7001)).body.text, 'Twelve containers are running.');
  assert.match(prompt, /Telegram/, 'the agent is told it is a chat');
  const dev = require('../modules/api-v1/devices').list().find(d => d.kind === 'channel');
  assert.equal(require('../modules/api-v1/devices').get(dev.id).userId, H.owner.user.id, 'the chat speaks as the person who linked it');

  userSays(7001, { text: `/start ${link.body.code}` });
  assert.match((await waitSent(s => s.method === 'sendMessage' && s.body.chat_id === 7001)).body.text, /unknown or has expired/, 'a code works once');
});

test('a voice note is transcribed and answered as speech; the recording is attached', async () => {
  const chat = require('../modules/chat');
  const real = chat.transcribeAudio;
  chat.transcribeAudio = async () => 'what time is it';
  try {
    let user = '';
    script = [{ text: 'Ten past nine.', seen: b => { user = b.messages.filter(m => m.role === 'user').map(m => JSON.stringify(m.content)).join('\n'); } }];
    userSays(7001, { voice: { file_id: 'v1', file_unique_id: 'u1', mime_type: 'audio/ogg', duration: 2 } });
    assert.equal((await waitSent(s => s.method === 'sendMessage' && s.body.chat_id === 7001)).body.text, 'Ten past nine.');
    assert.match(String(user), /what time is it/);
    assert.match(String(user), /voice note/);
    assert.match(String(user), /file_1\.oga/, 'the recording rides along as an attachment');
  } finally { chat.transcribeAudio = real; }
});

test('a question from the agent arrives as buttons, and a press answers it', async () => {
  const dev = require('../modules/api-v1/devices').list().find(d => d.kind === 'channel');
  const asked = require('../modules/harness/reach').ask({ to: dev.id, question: 'Deploy now?', choices: ['Yes', 'No'], timeoutSec: 20 });
  const q = await waitSent(s => s.method === 'sendMessage' && s.body.reply_markup);
  assert.match(q.body.text, /Deploy now\?/);
  const yes = q.body.reply_markup.inline_keyboard.flat().find(b => b.text === 'Yes');
  updates.push({ update_id: updateId++, callback_query: { id: 'cb1', data: yes.callback_data, message: { message_id: 5, chat: { id: 7001 }, text: q.body.text, reply_markup: q.body.reply_markup } } });
  const answer = await asked;
  assert.match(JSON.stringify(answer), /Yes/);
  await waitSent(s => s.method === 'answerCallbackQuery');
});

test('in manual mode, a call from a Telegram turn is asked in that chat, and Approve there runs it', async () => {
  assert.equal((await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' })).status, 200);
  try {
    script = [{ tool: 'shell', args: { command: 'echo from-telegram' } }, { text: 'Done: from-telegram.' }];
    userSays(7001, { text: 'run the echo' });
    const q = await waitSent(s => s.method === 'sendMessage' && s.body.reply_markup);
    assert.match(q.body.text, /shell|echo/);
    const approve = q.body.reply_markup.inline_keyboard.flat().find(b => /^Approve$|Allow/i.test(b.text));
    assert.ok(approve, JSON.stringify(q.body.reply_markup));
    updates.push({ update_id: updateId++, callback_query: { id: 'cb2', data: approve.callback_data, message: { message_id: 6, chat: { id: 7001 }, text: q.body.text, reply_markup: q.body.reply_markup } } });
    assert.equal((await waitSent(s => s.method === 'sendMessage' && s.body.text === 'Done: from-telegram.', 15000)).body.chat_id, 7001);
  } finally { await H.api(null, 'POST', '/api/harness/approval', { mode: 'auto' }); }
});

test('unlinking revokes the chat\'s device and it is a stranger again', async () => {
  const chats = (await H.api(null, 'GET', '/api/channels/telegram')).body.chats;
  assert.equal(chats.length, 1);
  const member = await H.signIn('member', 'tg-member2@test.local');
  assert.equal((await H.api(null, 'DELETE', `/api/channels/telegram/chats/${chats[0].chatId}`, undefined, { Cookie: member.cookie })).status, 404, 'not theirs');
  assert.deepEqual((await H.api(null, 'GET', '/api/channels/telegram', undefined, { Cookie: member.cookie })).body.chats, [], 'a member sees only their own');
  assert.equal((await H.api(null, 'DELETE', `/api/channels/telegram/chats/${chats[0].chatId}`)).status, 200);
  assert.ok(require('../modules/api-v1/devices').get(chats[0].deviceId).revokedAt);
  await waitSent(s => s.method === 'sendMessage' && /unlinked/.test(s.body.text));
  userSays(7001, { text: 'still there?' });
  assert.match((await waitSent(s => s.method === 'sendMessage' && s.body.chat_id === 7001)).body.text, /Settings → Channels/);
});

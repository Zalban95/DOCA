'use strict';

// Matrix as a channel (modules/channels/matrix): a stub homeserver on a local port speaking the client-server API
// the channel uses, and the scripted model — no network and no account. A direct room is linked by a code a
// signed-in person made; what it writes is a turn as that person; a question is a numbered list answered by number.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

const ME = '@doca:hs.test', AL = '@al:hs.test';
let hs, modelServer, script = [], batch = 0;
const pending = { invite: {}, join: {} }, sent = [], waiters = [], members = { '!dm:hs.test': [ME, AL], '!group:hs.test': [ME, AL, '@bo:hs.test'] };
const left = [];
const record = s => { sent.push(s); for (const w of [...waiters]) if (w.test(s)) { waiters.splice(waiters.indexOf(w), 1); sent.splice(sent.indexOf(s), 1); w.resolve(s); } };
const waitSent = (test, ms = 8000) => {
  const hit = sent.find(test);
  if (hit) { sent.splice(sent.indexOf(hit), 1); return Promise.resolve(hit); }
  return new Promise((resolve, reject) => {
    waiters.push({ test, resolve });
    setTimeout(() => reject(new Error(`nothing sent matching in ${ms} ms; sent: ${JSON.stringify(sent.map(s => [s.room, s.body?.body]))}`)), ms).unref();
  });
};
const says = (room, content, sender = AL) => { (pending.join[room] ||= []).push({ type: 'm.room.message', sender, event_id: `$${Math.random()}`, content }); };
const text = (room, body) => says(room, { msgtype: 'm.text', body });
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  hs = http.createServer((req, res) => {
    const raw = [];
    req.on('data', d => raw.push(d));
    req.on('end', () => {
      const ok = (j, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.headers.authorization !== 'Bearer syt_test') return ok({ errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid access token' }, 401);
      const u = new URL(req.url, 'http://x');
      const p = decodeURIComponent(u.pathname);
      const body = (req.headers['content-type'] || '').includes('json') ? JSON.parse(Buffer.concat(raw).toString() || '{}') : Buffer.concat(raw);
      if (p.endsWith('/account/whoami')) return ok({ user_id: ME });
      if (p.endsWith('/sync')) {
        const send = () => {
          const rooms = { invite: Object.fromEntries(Object.keys(pending.invite).map(r => [r, { invite_state: { events: [] } }])),
            join: Object.fromEntries(Object.entries(pending.join).map(([r, evs]) => [r, { timeline: { events: evs } }])) };
          pending.invite = {}; pending.join = {};
          ok({ next_batch: `s${++batch}`, rooms });
        };
        if (!u.searchParams.get('since') || Object.keys(pending.invite).length || Object.keys(pending.join).length) return send();
        return setTimeout(send, 60);
      }
      let m;
      if ((m = /\/join\/(.+)$/.exec(p))) { record({ kind: 'join', room: m[1] }); return ok({ room_id: m[1] }); }
      if ((m = /\/rooms\/([^/]+)\/leave$/.exec(p))) { left.push(m[1]); return ok({}); }
      if ((m = /\/rooms\/([^/]+)\/joined_members$/.exec(p))) return ok({ joined: Object.fromEntries((members[m[1]] || [ME, AL]).map(x => [x, {}])) });
      if ((m = /\/rooms\/([^/]+)\/send\/m\.room\.message\//.exec(p))) { record({ kind: 'send', room: m[1], body }); return ok({ event_id: `$e${Math.random()}` }); }
      if (/\/typing\//.test(p)) return ok({});
      if (p.endsWith('/media/v3/upload')) { record({ kind: 'upload', bytes: body.length, name: u.searchParams.get('filename') }); return ok({ content_uri: 'mxc://hs.test/up1' }); }
      if (/\/media\/download\//.test(p)) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from('PNGBYTES')); }
      return ok({ errcode: 'M_UNRECOGNIZED', error: p }, 404);
    });
  });
  await new Promise(r => hs.listen(0, '127.0.0.1', r));

  modelServer = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] })); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.stream === false) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })); }
      const next = script.shift() || { text: '(script exhausted)' };
      next.seen?.(body);
      return sse([{ choices: [{ delta: { content: next.text } }] }])(res);
    });
  });
  await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
});

after(async () => {
  require('../modules/channels/matrix').stop();
  await H.stop();
  await new Promise(r => hs.close(r));
  await new Promise(r => modelServer.close(r));
});

const inDm = s => s.kind === 'send' && s.room === '!dm:hs.test';

test('a host connects the bot account; the token never reads back; history is not answered', async () => {
  text('!dm:hs.test', 'an old message from before DOCA');
  const u = require('../modules/utils'); const p = u.loadPrefs(); p.channels = { matrix: { pollSec: 0 } }; u.savePrefs(p);
  assert.equal((await H.api(null, 'POST', '/api/channels/matrix', { homeserver: 'not a url', accessToken: 'x' })).status, 400);
  const r = await H.api(null, 'POST', '/api/channels/matrix', { homeserver: `http://127.0.0.1:${hs.address().port}/`, accessToken: 'syt_test', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.running, true);
  assert.equal(r.body.bot.username, ME);
  assert.ok(!JSON.stringify((await H.api(null, 'GET', '/api/prefs')).body).includes('syt_test'), 'masked like every secret');
  const member = await H.signIn('member', 'mx-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/channels/matrix', { enabled: false }, { Cookie: member.cookie })).status, 403);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(sent.filter(inDm).length, 0, 'the first sync only learns where the rooms are');
});

test('an invitation is accepted; a stranger gets instructions; a code links the room; a message is a turn', async () => {
  pending.invite['!dm:hs.test'] = true;
  await waitSent(s => s.kind === 'join' && s.room === '!dm:hs.test');
  assert.match((await waitSent(inDm)).body.body, /Settings → Channels/);
  text('!dm:hs.test', 'hello?');
  assert.match((await waitSent(inDm)).body.body, /Link a Matrix chat/);

  const link = await H.api(null, 'POST', '/api/channels/matrix/link');
  assert.match(link.body.code, /^[0-9A-F]{10}$/);
  text('!dm:hs.test', `!link ${link.body.code}`);
  assert.match((await waitSent(inDm)).body.body, /^Linked to owner/);

  let prompt = '';
  script = [{ text: 'Nine containers are running.', seen: b => { prompt = b.messages.find(m => m.role === 'system').content; } }];
  text('!dm:hs.test', 'how many containers?');
  assert.equal((await waitSent(inDm)).body.body, 'Nine containers are running.');
  assert.match(prompt, /Matrix/, 'the agent is told it is a Matrix chat');
  const dev = require('../modules/api-v1/devices').list().find(d => d.kind === 'channel' && /Matrix/.test(d.name));
  assert.equal(require('../modules/api-v1/devices').get(dev.id).userId, H.owner.user.id);
});

test('a room with more than one person is left; an encrypted message gets how to chat unencrypted', async () => {
  pending.invite['!group:hs.test'] = true;
  assert.match((await waitSent(s => s.kind === 'send' && s.room === '!group:hs.test')).body.body, /direct chat only/);
  for (let i = 0; i < 40 && !left.includes('!group:hs.test'); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(left.includes('!group:hs.test'));
  (pending.join['!dm:hs.test'] ||= []).push({ type: 'm.room.encrypted', sender: AL, content: { algorithm: 'm.megolm.v1.aes-sha2' } });
  assert.match((await waitSent(inDm)).body.body, /end-to-end encrypted/);
});

test('a picture sent is an attachment; a picture shown is uploaded', async () => {
  let user = '';
  script = [{ text: 'A cat.', seen: b => { user = JSON.stringify(b.messages.filter(m => m.role === 'user')); } }];
  says('!dm:hs.test', { msgtype: 'm.image', body: 'cat.png', url: 'mxc://hs.test/cat', info: { mimetype: 'image/png' } });
  assert.equal((await waitSent(inDm)).body.body, 'A cat.');
  assert.match(user, /cat\.png/, 'the picture rides along as an attachment');

  const dev = require('../modules/api-v1/devices').list().find(d => d.kind === 'channel' && /Matrix/.test(d.name));
  const a = require('../modules/attachments').save(Buffer.from('PNG'), 'chart.png', { mime: 'image/png' });
  await require('../modules/channels/matrix/outbound').onEvent('!dm:hs.test', dev.id,
    { type: 'agent.turn', payload: { by: dev.id, state: 'done', text: 'Here.', images: [{ name: a.name, kind: 'image' }] } });
  assert.equal((await waitSent(inDm)).body.body, 'Here.', 'the text first, then the picture');
  await waitSent(s => s.kind === 'upload' && s.name === a.name);
  const img = await waitSent(s => inDm(s) && s.body.msgtype === 'm.image');
  assert.equal(img.body.url, 'mxc://hs.test/up1');
});

test('a question arrives numbered, and the number answers it', async () => {
  const dev = require('../modules/api-v1/devices').list().find(d => d.kind === 'channel' && /Matrix/.test(d.name));
  const asked = require('../modules/harness/reach').ask({ to: dev.id, question: 'Deploy now?', choices: ['Yes', 'No'], timeoutSec: 20 });
  const q = await waitSent(s => inDm(s) && /Deploy now\?/.test(s.body.body));
  assert.match(q.body.body, /1\. Yes\n2\. No/);
  text('!dm:hs.test', '2');
  assert.match(JSON.stringify(await asked), /No/);
  assert.equal((await waitSent(inDm)).body.body, '→ No');
  script = [{ text: 'Just a number.' }];
  text('!dm:hs.test', '1');
  assert.equal((await waitSent(inDm)).body.body, 'Just a number.', 'with nothing open a number is a message');
});

test('unlinking revokes the room\'s device and it is a stranger again', async () => {
  const chats = (await H.api(null, 'GET', '/api/channels/matrix')).body.chats;
  assert.equal(chats.length, 1);
  const member = await H.signIn('member', 'mx-member2@test.local');
  assert.equal((await H.api(null, 'DELETE', `/api/channels/matrix/chats/${encodeURIComponent(chats[0].chatId)}`, undefined, { Cookie: member.cookie })).status, 404);
  assert.equal((await H.api(null, 'DELETE', `/api/channels/matrix/chats/${encodeURIComponent(chats[0].chatId)}`)).status, 200);
  assert.ok(require('../modules/api-v1/devices').get(chats[0].deviceId).revokedAt);
  await waitSent(s => inDm(s) && /unlinked/.test(s.body.body));
  text('!dm:hs.test', 'still there?');
  assert.match((await waitSent(inDm)).body.body, /Link a Matrix chat/);
});

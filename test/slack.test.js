'use strict';

// Slack as a channel (modules/channels/slack): a stub Web API and a stub Socket Mode server on local ports, and
// the scripted model — no network and no workspace. A DM is linked by a code a signed-in person made; what it
// writes is a turn as that person; a question is Block Kit buttons answered through block_actions.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let api, wss, sock = null, modelServer, script = [], env = 1;
const sent = [], waiters = [], acks = new Set();
const record = s => { sent.push(s); for (const w of [...waiters]) if (w.test(s)) { waiters.splice(waiters.indexOf(w), 1); sent.splice(sent.indexOf(s), 1); w.resolve(s); } };
const waitSent = (test, ms = 8000) => {
  const hit = sent.find(test);
  if (hit) { sent.splice(sent.indexOf(hit), 1); return Promise.resolve(hit); }
  return new Promise((resolve, reject) => {
    waiters.push({ test, resolve });
    setTimeout(() => reject(new Error(`nothing sent matching in ${ms} ms; sent: ${JSON.stringify(sent.map(s => [s.method, s.body?.text]))}`)), ms).unref();
  });
};
const until = async (fn, ms = 5000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
const push = (type, payload) => { const id = `env${env++}`; sock.send(JSON.stringify({ envelope_id: id, type, payload })); return id; };
const dm = (text, extra = {}) => push('events_api', { event: { type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', text, ts: String(Date.now()), ...extra } });
const post = s => s.method === 'chat.postMessage' && s.body.channel === 'D1';
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', ws => { sock = ws; ws.on('message', d => acks.add(JSON.parse(String(d)).envelope_id)); ws.send(JSON.stringify({ type: 'hello' })); });
  await new Promise(r => wss.on('listening', r));
  api = http.createServer((req, res) => {
    const raw = [];
    req.on('data', d => raw.push(d));
    req.on('end', () => {
      const ok = j => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...j })); };
      const method = req.url.replace(/^\//, '').split('?')[0];
      if (method === 'upload-here') { record({ method, bytes: Buffer.concat(raw).length }); res.writeHead(200); return res.end('OK'); }
      if (method === 'files/cat.png') { res.writeHead(req.headers.authorization === 'Bearer xoxb-test' ? 200 : 403); return res.end('PNGBYTES'); }
      const tok = req.headers.authorization;
      if (method === 'apps.connections.open') return tok === 'Bearer xapp-test' ? ok({ url: `ws://127.0.0.1:${wss.address().port}` }) : ok({ ok: false, error: 'invalid_auth' });
      if (tok !== 'Bearer xoxb-test') { res.writeHead(200); return res.end(JSON.stringify({ ok: false, error: 'invalid_auth' })); }
      const body = (req.headers['content-type'] || '').includes('json') ? JSON.parse(Buffer.concat(raw).toString() || '{}') : Object.fromEntries(new URLSearchParams(Buffer.concat(raw).toString()));
      if (method === 'auth.test') return ok({ user_id: 'UBOT', team: 'Test team' });
      if (method === 'users.info') return ok({ user: { name: 'al', profile: { real_name: 'Al' } } });
      if (method === 'files.getUploadURLExternal') return ok({ upload_url: `http://127.0.0.1:${api.address().port}/upload-here`, file_id: 'F1' });
      record({ method, body });
      return ok({ ts: `${Date.now()}.0001`, channel: body.channel });
    });
  });
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  process.env.DOCA_SLACK_API = `http://127.0.0.1:${api.address().port}`;

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
  require('../modules/channels/slack').stop();
  await H.stop();
  await new Promise(r => api.close(r));
  await new Promise(r => wss.close(r));
  await new Promise(r => modelServer.close(r));
});

test('a host connects the app with both tokens; neither reads back; the socket opens', async () => {
  assert.equal((await H.api(null, 'POST', '/api/channels/slack', { appToken: 'xoxb-wrong' })).status, 400, 'the app token is the xapp- one');
  const r = await H.api(null, 'POST', '/api/channels/slack', { appToken: 'xapp-test', botToken: 'xoxb-test', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.running, true);
  assert.equal(r.body.bot.team, 'Test team');
  await until(() => sock);
  const prefs = JSON.stringify((await H.api(null, 'GET', '/api/prefs')).body);
  assert.ok(!prefs.includes('xapp-test') && !prefs.includes('xoxb-test'), 'masked like every secret');
  const member = await H.signIn('member', 'sl-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/channels/slack', { enabled: false }, { Cookie: member.cookie })).status, 403);
});

test('every envelope is acknowledged; a stranger gets instructions; a code links the DM; a message is a turn', async () => {
  const id = dm('hello?');
  assert.match((await waitSent(post)).body.text, /Link a Slack chat/);
  assert.ok(acks.has(id), 'acknowledged, as Socket Mode requires');

  push('events_api', { event: { type: 'message', channel_type: 'channel', channel: 'C1', user: 'U1', text: 'hey bot' } });
  const link = await H.api(null, 'POST', '/api/channels/slack/link');
  dm(`/link ${link.body.code}`);
  assert.match((await waitSent(post)).body.text, /^Linked to owner/);
  assert.ok(!sent.some(s => s.body?.channel === 'C1'), 'a shared channel gets nothing');

  let prompt = '';
  script = [{ text: 'Seven containers are running.', seen: b => { prompt = b.messages.find(m => m.role === 'system').content; } }];
  dm('how many containers?');
  const answer = await waitSent(post);
  assert.equal(answer.body.text, 'Seven containers are running.');
  assert.equal(answer.body.mrkdwn, false, 'shown as typed');
  assert.match(prompt, /Slack/);
  const devices = require('../modules/api-v1/devices');
  const dev = devices.list().find(d => d.kind === 'channel' && /Slack · Al/.test(d.name));
  assert.equal(devices.get(dev.id).userId, H.owner.user.id);
});

test('a file sent is fetched with the bot token and attached; a picture shown is uploaded', async () => {
  let user = '';
  script = [{ text: 'A cat.', seen: b => { user = JSON.stringify(b.messages.filter(m => m.role === 'user')); } }];
  dm('', { subtype: 'file_share', files: [{ name: 'cat.png', mimetype: 'image/png', url_private: `${process.env.DOCA_SLACK_API}/files/cat.png` }] });
  assert.equal((await waitSent(post)).body.text, 'A cat.');
  assert.match(user, /cat\.png/);

  const dev = require('../modules/api-v1/devices').list().find(d => d.kind === 'channel' && /Slack/.test(d.name));
  const a = require('../modules/attachments').save(Buffer.from('PNG'), 'chart.png', { mime: 'image/png' });
  await require('../modules/channels/slack/outbound').onEvent('D1', dev.id, { type: 'agent.turn', payload: { by: dev.id, state: 'done', images: [{ name: a.name, kind: 'image' }] } });
  await waitSent(s => s.method === 'upload-here' && s.bytes === 3);
  assert.equal((await waitSent(s => s.method === 'files.completeUploadExternal')).body.channel_id, 'D1');
});

test('a question arrives as buttons, and a press answers it', async () => {
  const dev = require('../modules/api-v1/devices').list().find(d => d.kind === 'channel' && /Slack/.test(d.name));
  const asked = require('../modules/harness/reach').ask({ to: dev.id, question: 'Deploy now?', choices: ['Yes', 'No'], timeoutSec: 20 });
  const q = await waitSent(s => post(s) && s.body.blocks);
  const yes = q.body.blocks[1].elements.find(e => e.text.text === 'Yes');
  push('interactive', { type: 'block_actions', channel: { id: 'D1' }, user: { id: 'U1' }, message: { ts: '1.1', text: q.body.text }, actions: [{ action_id: yes.action_id, text: yes.text }] });
  assert.match(JSON.stringify(await asked), /Yes/);
  assert.match((await waitSent(s => s.method === 'chat.update')).body.text, /→ Yes/);
});

test('a dropped socket is opened again', async () => {
  const old = sock;
  old.close();
  await until(() => sock !== old && sock.readyState === 1, 8000);
  const id = dm('/start');
  assert.match((await waitSent(post)).body.text, /^Linked to owner/);
  assert.ok(acks.has(id));
});

test('unlinking revokes the DM\'s device and it is a stranger again', async () => {
  const chats = (await H.api(null, 'GET', '/api/channels/slack')).body.chats;
  assert.equal(chats.length, 1);
  assert.equal((await H.api(null, 'DELETE', `/api/channels/slack/chats/${chats[0].chatId}`)).status, 200);
  assert.ok(require('../modules/api-v1/devices').get(chats[0].deviceId).revokedAt);
  await waitSent(s => post(s) && /unlinked/.test(s.body.text));
  dm('still there?');
  assert.match((await waitSent(post)).body.text, /Link a Slack chat/);
});

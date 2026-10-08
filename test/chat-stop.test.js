'use strict';

// Stop in the floating chat is the browser hanging up on /api/chat (lib/api.js sseStream). The turn must notice at
// once and drop the model request in flight — on a slow model the first token can be a minute away, and a Stop that
// waits for it looks dead (self-test round two, C1).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');

let server, hungUp = null, asked = 0;
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    asked++;
    req.on('data', () => {});
    res.on('close', () => { if (!res.writableEnded) hungUp = Date.now(); });
    setTimeout(() => { if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'late' } }] })); } }, 20000).unref();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { slow: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'slow', model: 'm', fallbackChain: [], summarizeAfter: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('hanging up on the floating chat ends the turn and its model request at once', async () => {
  const lifecycle = require('../modules/harness/turn/lifecycle');
  const main = require('../modules/harness/memory').mainSession().id;
  const ctrl = new AbortController();
  const res = await fetch(`${H.base}/api/chat`, { method: 'POST', signal: ctrl.signal,
    headers: { 'Content-Type': 'application/json', Cookie: H.owner.cookie, Origin: H.base }, body: JSON.stringify({ message: 'hello' }) });
  const reader = res.body.getReader();
  for (let i = 0; i < 100 && !asked; i++) await H.sleep(50);
  assert.equal(asked, 1, 'the model was asked');
  assert.equal(lifecycle.isRunning(main), true);
  const stoppedAt = Date.now();
  ctrl.abort();
  reader.cancel().catch(() => {});
  for (let i = 0; i < 60 && (lifecycle.isRunning(main) || !hungUp); i++) await H.sleep(50);
  assert.equal(lifecycle.isRunning(main), false, 'the turn ended');
  assert.ok(hungUp && hungUp - stoppedAt < 3000, `the request to the model was dropped (${hungUp ? hungUp - stoppedAt : 'never'} ms)`);
});

test('the stop route answers once the turn has ended, so the chat can say "Stopped"', async () => {
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('stop me', { activate: false });
  const turn = require('../modules/harness/agent').turn({ message: 'hi', sessionId: s.id }).catch(() => {});
  const lifecycle = require('../modules/harness/turn/lifecycle');
  for (let i = 0; i < 100 && !lifecycle.isRunning(s.id); i++) await H.sleep(20);
  const r = await H.api(null, 'POST', `/api/harness/sessions/${s.id}/stop`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { stopped: true, ended: true });
  await turn;
});

test('Stop in the floating chat says it was heard at once, then that it stopped', async () => {
  const vm = require('node:vm');
  const path = require('node:path');
  const btn = { style: {}, disabled: false, textContent: '■ Stop' };
  const notes = [];
  let release;
  const box = { appendChild: n => { n.isConnected = true; notes.push(n); return n; } };
  const ctx = {
    document: { getElementById: id => ({ 'chat-stop': btn, 'chat-messages': box })[id] || null, createElement: () => ({}) },
    _liveChatSession: 'ses_main',
    apiFetch: (url) => new Promise(r => { release = () => r({ stopped: true, ended: true }); }),
    AbortController, setTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat-stop.js'), 'utf8') + ';this.start = () => { chatTurn = new AbortController(); _chatBusy(true); return chatTurn; }; this.stop = chatStop; this.current = () => chatTurn;', ctx);
  const turn = ctx.start();
  const done = ctx.stop();
  assert.equal(btn.textContent, 'Stopping…', 'the button says it was heard');
  assert.equal(btn.disabled, true);
  assert.equal(notes[0].textContent, 'Stopping…');
  assert.equal(turn.signal.aborted, true, 'the stream is hung up at once');
  await H.sleep(5);
  release();
  await done;
  assert.equal(notes[0].textContent, 'Stopped.', 'the same line, under the conversation');
  assert.equal(notes[0].className, 'chat-msg system');
  assert.equal(ctx.current(), null);
  assert.equal(btn.style.display, 'none');
});

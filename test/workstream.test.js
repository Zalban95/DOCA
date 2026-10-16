'use strict';

/** The Workstream (modules/workstream): files edited with what changed, and each conversation's thinking and commands. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const ws = require('../modules/workstream');
const sentinel = require('../modules/workstream/sentinel');

test.before(() => H.start());
test.after(() => H.stop());

async function open() {
  const ctrl = new AbortController();
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: H.owner.cookie }, signal: ctrl.signal });
  const got = []; let buf = '', hello = null;
  const pump = (async () => { const r = res.body.getReader(); try { for (;;) { const { value, done } = await r.read(); if (done) return; buf += new TextDecoder().decode(value);
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); if (!l.startsWith('data: ')) continue; const c = JSON.parse(l.slice(6)); if (c.hello) hello = c; else got.push(c); } } } catch { /* closed */ } })();
  for (let i = 0; i < 100 && !hello; i++) await H.sleep(20);
  return { got, hello, close: async () => { ctrl.abort(); await pump; } };
}
// macOS's FSEvents stream starts asynchronously and reports in batches: a write the instant the watch is made can be
// missed, and a heard one can come a second later (TODO T1, a macOS CI failure for 2.289.0).
const SLOW_WATCH = process.platform !== 'linux';   // macOS' FSEvents and Windows' recursive watch start and report later
const until = async (fn, ms = SLOW_WATCH ? 12000 : 4000) => { for (const end = Date.now() + ms; Date.now() < end; await H.sleep(25)) if (fn()) return true; return false; };

test('while a page holds it, an edit in a project is heard with what it added and removed; letting go stops the sentinel', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').homedir(), '.doca-ws-test-'));
  try {
    fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'node_modules'));
    await H.api(null, 'POST', '/api/projects', { name: 'ws', root });
    const page = await open();
    const r = await H.api(null, 'POST', '/api/workstream/hold', { screen: page.hello.screen, on: true });
    assert.equal(r.body.sentinel.on, true);
    assert.ok(r.body.sentinel.roots.includes(path.resolve(root)));
    const file = path.join(root, 'src', 'app.js');
    // Let the recursive watch start before the first write: macOS' FSEvents stream, and Windows' (CI, 2026-10-13: the
    // first file written at once went unheard).
    if (SLOW_WATCH) await H.sleep(1500);
    fs.writeFileSync(file, 'one\ntwo\nthree\n');
    assert.ok(await until(() => page.got.some(c => c.topic === 'workstream' && c.what === 'file' && c.path === file)), 'a new file is heard');
    const first = page.got.find(c => c.what === 'file' && c.path === file);
    assert.equal(first.created, true); assert.equal(first.added, 4);
    fs.writeFileSync(file, 'one\nTWO\nthree\nfour\n');
    assert.ok(await until(() => page.got.filter(c => c.what === 'file' && c.path === file).length >= 2));
    const second = page.got.filter(c => c.what === 'file' && c.path === file)[1];
    assert.deepEqual([second.added, second.removed], [2, 1], '+2 −1');
    assert.ok(second.hunks[0].lines.some(l => l.op === '-' && l.line === 'two') && second.hunks[0].lines.some(l => l.op === '+' && l.line === 'TWO'));
    fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'noise');
    await H.sleep(500);
    assert.ok(!page.got.some(c => c.path?.includes('node_modules')), 'node_modules is never the work');
    await page.close();
    assert.ok(await until(() => !sentinel.status().on), 'the last page let go: nothing watched');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a file holding secrets is diffed masked on both sides: what was there before is never shown in clear', async () => {
  // Found live 2026-10-16: the copy taken when watching starts kept the settings file as it is, so its first change
  // showed every secret in clear as a removed line beside its masked self.
  const root = fs.mkdtempSync(path.join(require('node:os').homedir(), '.doca-ws-test-'));
  try {
    const env = path.join(root, '.env');
    fs.writeFileSync(env, 'API_TOKEN=supersecret-before-123\nPORT=1\n');
    await H.api(null, 'POST', '/api/projects', { name: 'ws-secret', root });
    const page = await open();
    await H.api(null, 'POST', '/api/workstream/hold', { screen: page.hello.screen, on: true });
    assert.ok(await until(() => sentinel.status().on));
    await H.sleep(SLOW_WATCH ? 1500 : 400);   // the start copy is taken
    fs.writeFileSync(env, 'API_TOKEN=supersecret-after-456\nPORT=2\n');
    assert.ok(await until(() => page.got.some(c => c.what === 'file' && c.path === env)), 'the change is heard');
    const all = JSON.stringify(page.got);
    assert.ok(!all.includes('supersecret-before-123') && !all.includes('supersecret-after-456'), 'no secret value, old or new, reaches the page');
    await page.close();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('activity: thinking gathered, commands as typed, results by their first line, no secret argument named', async () => {
  const s = require('../modules/harness/memory').createSession('Kitchen', { activate: false });
  for (const t of ['Let me ', 'check the ', 'lights.']) ws.onEvent({ sessionId: s.id, type: 'thinking', text: t });
  ws.onEvent({ sessionId: s.id, type: 'tool_call', name: 'shell', args: { command: 'ls -la' } });
  ws.onEvent({ sessionId: s.id, type: 'tool_call', name: 'http_fetch', args: { url: 'http://x/y', key: 'hyper3d' } });
  ws.onEvent({ sessionId: s.id, type: 'tool_call', name: 'mcp__x__thing', args: { token: 'abc', room: 'kitchen' } });
  ws.onEvent({ sessionId: s.id, type: 'tool_result', name: 'shell', result: '\ntotal 4\nfile' });
  await H.sleep(400);
  const a = (await H.api(null, 'GET', '/api/workstream')).body.activity.filter(x => x.sessionId === s.id);
  assert.deepEqual(a.map(x => [x.kind, x.text]), [['command', '$ ls -la'], ['command', 'http_fetch http://x/y'], ['command', 'mcp__x__thing(room)'], ['result', 'total 4'], ['thinking', 'Let me check the lights.']]);
  assert.equal(a[0].who, 'Kitchen');
  const member = await H.signIn('member', 'ws-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/workstream', undefined, { Cookie: member.cookie })).status, 403);
});

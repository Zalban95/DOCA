'use strict';

// Computers for agents (modules/computers, clients/computer): a Linux desktop in a container, reached as an MCP
// server. Needs Docker and the built image (doca/computer:1), so it is skipped where they are absent — CI included.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const H = require('./helpers');

let computers, ready = false, made = null;
before(async () => {
  await H.start();
  computers = require('../modules/computers');
  ready = await computers.imageReady();
});
after(async () => { if (made) await computers.remove(made.id).catch(() => {}); await H.stop(); });

test('a computer is made, its tools reach the agent, a screenshot comes back as an attachment', { timeout: 180000 }, async t => {
  if (!ready) return t.skip('no Docker image doca/computer:1 here');
  made = await computers.create({ name: 'test', purpose: 'the suite' });
  const tools = require('../modules/harness/tools');
  const prefix = `mcp__computer-${made.id}__`;
  const names = tools.schemas([]).map(s => s.function.name).filter(n => n.startsWith(prefix));
  assert.ok(names.includes(`${prefix}browser_snapshot`) && names.includes(`${prefix}record_start`), names.join(', '));
  assert.match(await tools.call(`${prefix}shell`, { command: 'whoami' }), /exit 0\nagent/);
  await tools.call(`${prefix}write_file`, { path: 'p.html', content: '<title>T</title><button onclick="document.title=\'clicked\'">Go</button>' });
  assert.match(await tools.call(`${prefix}browser_open`, { url: 'file:///home/agent/work/p.html' }), /"T"/);
  assert.match(await tools.call(`${prefix}browser_snapshot`, {}), /\[1\] button:submit "Go"/);
  await tools.call(`${prefix}browser_click`, { ref: 1 });
  assert.match(await tools.call(`${prefix}browser_snapshot`, {}), /title: clicked/);
  const shot = await tools.call(`${prefix}screenshot`, {});
  const file = shot.match(/saved as (\S+\.png)/)?.[1];
  assert.ok(file && fs.statSync(file).size > 1000, shot);
  const list = await computers.list();
  assert.equal(list.find(c => c.id === made.id).state, 'running');
  assert.ok(!JSON.stringify(list).includes(require('../modules/computers').get(made.id).token), 'the token never leaves');
});

test('what a computer serves on its page port opens for the person, and Live lists it (TODO H10.18)', { timeout: 60000 }, async t => {
  if (!ready || !made) return t.skip('no computer here');
  const tools = require('../modules/harness/tools');
  const prefix = `mcp__computer-${made.id}__`;
  await tools.call(`${prefix}write_file`, { path: 'site/index.html', content: '<h1>served from the computer</h1>' });
  await tools.call(`${prefix}shell`, { command: `cd ~/work/site && (nohup python3 -m http.server ${computers.SERVE} --bind 0.0.0.0 > ~/work/serve.log 2>&1 < /dev/null &)` });   // as the skill says
  const c = (await computers.detailed()).find(x => x.id === made.id);
  let pages = [];
  for (let i = 0; i < 40 && !pages.length; i++) { pages = await require('../modules/machines').computerPages([c]); if (!pages.length) await H.sleep(250); }
  assert.equal(pages[0]?.computer, made.id, 'Live lists the page');
  const p = require('../modules/canvas/previews').create({ computer: made.id });
  assert.match(await (await fetch(`http://127.0.0.1:${p.port}/`)).text(), /served from the computer/, 'the preview\'s port reaches it');
});

test('a specialist holds only the computer its mission was given', () => {
  const { disabledFor } = require('../modules/harness/turn/prompt');
  const p = require('../modules/harness/agent').params();
  const names = ['mcp__computer-aaaa__shell', 'mcp__computer-bbbb__shell'];
  const real = require('../modules/harness/tools').describe;
  require('../modules/harness/tools').describe = () => [...real(), ...names.map(name => ({ name }))];
  try {
    const off = disabledFor({ id: 'tester', kits: ['computer'], computer: 'aaaa' }, p);
    assert.ok(!off.includes('mcp__computer-aaaa__shell'));
    assert.ok(off.includes('mcp__computer-bbbb__shell'));
    assert.ok(disabledFor({ id: 'tester', kits: ['computer'] }, p).includes('mcp__computer-aaaa__shell'), 'none given: none held');
  } finally { require('../modules/harness/tools').describe = real; }
});

test('the Computers view says who works in each and what it produced; a stopped one has no screen', async () => {
  const store = require('../modules/store');
  const row = { id: 'c0ffee01', name: 'view', purpose: 'p', token: 'secret-token-x', vncPassword: 'pw', mcpPort: 1, vncPort: 2, createdAt: new Date().toISOString() };
  const before = store.readJson('computers', { computers: [] }).computers;
  store.writeJson('computers', { computers: [...before, row] });
  try {
    const m = { id: 'msn_view01', agentId: 'tester', label: 'Tester', state: 'running', task: 'try the installer' };
    const missions = require('../modules/agents/missions');
    const realGet = missions.get;
    missions.get = id => (id === m.id ? m : realGet(id));
    try {
      assert.equal(computers.lend(row.id, m.id), row.id);
      require('../modules/attachments').save(Buffer.from('fake'), 'computer-c0ffee01-demo.webm', { mime: 'video/webm', from: 'mcp:computer-c0ffee01' });
      const r = await H.api(null, 'GET', '/api/computers');
      const c = r.body.computers.find(x => x.id === row.id);
      assert.equal(c.mission.label, 'Tester');
      assert.match(c.mission.task, /installer/);
      assert.deepEqual(c.media.map(f => f.mime), ['video/webm']);
      assert.ok(!JSON.stringify(r.body).includes('secret-token-x'), 'the token never leaves');
    } finally { missions.get = realGet; }
    const s = await H.api(null, 'GET', `/api/computers/${row.id}/screen`);
    assert.equal(s.status, 502);
    assert.equal((await H.api(null, 'GET', '/api/computers/nope/screen')).status, 404);
  } finally { store.writeJson('computers', { computers: before }); }
});

test('while a person drives a computer, the agent\'s input waits; after the hand-back it is told to look again', async () => {
  const vnc = require('../modules/computers/vnc');
  const takeover = require('../modules/computers/takeover');
  const { EventEmitter } = require('node:events');
  const store = require('../modules/store');
  const before = store.readJson('computers', { computers: [] }).computers;
  store.writeJson('computers', { computers: [...before, { id: 'dd0000aa', name: 'drive', token: 't', vncPassword: 'p', mcpPort: 1, vncPort: 9, createdAt: new Date().toISOString() }] });
  try {
    const socket = Object.assign(new EventEmitter(), { end() {}, destroy() { this.emit('close'); }, write() {}, pipe() {} });
    vnc.upgrade({ url: '/ws/computer/dd0000aa?drive=1', headers: {} }, socket, null);
    assert.equal(vnc.driving('dd0000aa'), true);
    assert.match(takeover.before('mcp__computer-dd0000aa__desktop_click'), /a person is driving/);
    assert.equal(takeover.before('mcp__computer-dd0000aa__screenshot'), null, 'looking carries on');
    assert.equal(takeover.before('mcp__computer-dd0000aa__shell'), null);
    socket.emit('close');
    assert.equal(vnc.driving('dd0000aa'), false);
    assert.match(takeover.after('mcp__computer-dd0000aa__screenshot', 'ok'), /^\[A person drove this computer until .+ and handed it back/);
    assert.equal(takeover.after('mcp__computer-dd0000aa__screenshot', 'ok'), 'ok', 'said once');
    const watcher = Object.assign(new EventEmitter(), { end() {}, destroy() {}, write() {}, pipe() {} });
    vnc.upgrade({ url: '/ws/computer/dd0000aa', headers: {} }, watcher, null);
    assert.equal(vnc.driving('dd0000aa'), false, 'watching is not driving');
    watcher.emit('close');
  } finally { store.writeJson('computers', { computers: before }); }
});

test('files go into a computer and come out as attachments', { timeout: 120000 }, async t => {
  if (!ready) return t.skip('no Docker image doca/computer:1 here');
  const c = await computers.create({ name: 'files', purpose: 'the suite' });
  try {
    const a = require('../modules/attachments').save(Buffer.from('hello from the hub'), 'note.txt', { from: 'test' });
    const put = await computers.put(c.id, a.name, 'inbox/');
    assert.equal(put.path, `/home/agent/work/inbox/${a.name}`);
    const tools = require('../modules/harness/tools');
    assert.match(await tools.call(`mcp__computer-${c.id}__shell`, { command: `cat ${put.path} && echo made-here > /home/agent/work/out.txt` }), /hello from the hub/);
    const back = await computers.fetchFile(c.id, 'out.txt');
    assert.equal(fs.readFileSync(back.path, 'utf8').trim(), 'made-here');
    await assert.rejects(computers.put(c.id, a.name, '../../etc/x'), /inside the work folder/);
  } finally { await computers.remove(c.id); }
});

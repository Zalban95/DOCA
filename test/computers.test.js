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

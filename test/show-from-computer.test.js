'use strict';

/**
 * show_media { computer, path } copies a file out of the computer this conversation works in and shows it
 * (self-test 2026-10-08: a Tester could not show its own screenshot) — never out of another conversation's computer.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers'); // Isolated data, prefs and provider files.
const store = require('../modules/store');
const memory = require('../modules/harness/memory');
const computers = require('../modules/computers');
const tools = require('../modules/harness/tools');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let saved, realFetch, fetched = [], work, other, lentTo;
const row = (id, extra = {}) => ({ id, name: id, purpose: 'p', token: 't', vncPassword: 'pw', mcpPort: 1, vncPort: 2, createdAt: new Date().toISOString(), ...extra });

before(() => {
  work = memory.createSession('a work chat', { activate: false, kind: 'work' }).id;
  other = memory.createSession('another work chat', { activate: false, kind: 'work' }).id;
  lentTo = memory.createSession('Tester: x', { activate: false, kind: 'specialist', profile: { id: 'tester', computer: 'c0ffee22' } }).id;
  saved = store.readJson('computers', { computers: [] }).computers;
  store.writeJson('computers', { computers: [...saved, row('c0ffee21', { by: work }), row('c0ffee22'), row('c0ffee23', { by: other })] });
  // The docker cp, stood in for: what computer get keeps (an attachment from mcp:computer-<id>).
  realFetch = computers.fetchFile;
  computers.fetchFile = async (id, p) => { fetched.push([id, p]); return require('../modules/attachments').save(PNG, require('path').basename(p), { from: `mcp:computer-${id}` }); };
});
after(() => { computers.fetchFile = realFetch; store.writeJson('computers', { computers: saved }); });

const show = async (sessionId, args) => {
  const shown = [];
  const result = await tools.call('show_media', args, [], { sessionId, show: m => shown.push(m) });
  return { result: String(result), shown };
};

test('a work chat shows a screenshot from a computer it made', async () => {
  const r = await show(work, { computer: 'c0ffee21', path: 'shots/page.png', caption: 'the page' });
  assert.match(r.result, /Shown in the chat: page.*image/);
  assert.equal(r.shown[0].kind, 'image');
  assert.deepEqual(fetched.at(-1), ['c0ffee21', 'shots/page.png']);
});

test('a specialist shows one from the computer lent to its mission', async () => {
  const r = await show(lentTo, { computer: 'c0ffee22', path: '/home/agent/work/a.png' });
  assert.equal(r.shown.length, 1, r.result);
});

test('never from another conversation\'s computer, nor what a chat cannot show', async () => {
  const n = fetched.length;
  assert.match((await show(work, { computer: 'c0ffee23', path: 'x.png' })).result, /not one this conversation works in \(yours: c0ffee21\)/);
  assert.match((await show(lentTo, { computer: 'c0ffee21', path: 'x.png' })).result, /yours: c0ffee22/);
  assert.match((await show(memory.mainSession().id, { computer: 'c0ffee21', path: 'x.png' })).result, /it has none/, 'the Orchestrator works in none');
  assert.match((await show(work, { computer: 'c0ffee21', path: 'notes.bin' })).result, /not something a chat can show/);
  assert.equal(fetched.length, n, 'nothing was copied out for a refused call');
});

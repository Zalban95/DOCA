'use strict';

/**
 * Programmatic tool calls (harness/code-calls.js, experiment codeCalls): a script's tool calls each go through the
 * turn's own gates and are kept in a conversation of the script's own; it holds no key, cannot call itself, and stops at
 * its time limit. Absent while the experiment is off.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const run = (code, ctx, extra = {}) => require('../modules/harness/code-calls').run({ code, ...extra }, ctx);
function flag(on) {
  const u = require('../modules/utils'), p = u.loadPrefs();
  u.savePrefs({ ...p, developer: { ...(p.developer || {}), mode: on }, experiments: { ...(p.experiments || {}), codeCalls: on } });
}

test('off, it is absent; on, a script reads and writes through the gates, and its calls are kept', async () => {
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('Summaries').id;
  assert.match(await run('return 1', { sessionId: s }), /experiment that is off/);
  assert.ok(require('../modules/harness/turn/tool-shape').switches().some(x => x.name === 'run_code'), 'not offered while off');
  flag(true);
  assert.ok(!require('../modules/harness/turn/tool-shape').switches().some(x => x.name === 'run_code'));
  const dir = fs.mkdtempSync(path.join(H.tmp, 'cc-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha\n'); fs.writeFileSync(path.join(dir, 'b.txt'), 'beta\n');
  const out = await run(`
    const names = ['a.txt', 'b.txt'];
    const parts = [];
    for (const n of names) parts.push((await tools.read_file({ path: ${JSON.stringify(dir)} + '/' + n })).split('\\n').find(l => /alpha|beta/.test(l)));
    console.log('read', parts.length);
    await call('write_file', { path: ${JSON.stringify(dir)} + '/sum.txt', content: parts.join(',') });
    return { parts };`, { sessionId: s });
  assert.match(out, /^Script done: 3 tool calls \(read_file, write_file\)\./);
  assert.match(out, /Output:\nread 2/);
  assert.match(out, /Returned: \{[\s\S]*alpha/);
  assert.match(fs.readFileSync(path.join(dir, 'sum.txt'), 'utf8'), /alpha.*beta/);
  const child = /\((s_[a-z0-9]+)\)\.$/.exec(out)[1];
  assert.equal(memory.getSession(child).parentId, s, 'its conversation is under the agent\'s');
  assert.equal(memory.messages(child).filter(r => r.role === 'tool').length, 3, 'every call and result is in it');
});

test('the gates hold inside a script: a path outside the roots is refused, no key is held, no script inside a script', async () => {
  const s = require('../modules/harness/memory').createSession('Gates').id;
  // A call a person must answer (the settings file) waits for that answer inside a script too; one the rules refuse
  // outright — a path outside the allowed roots — is refused here as it would be outside.
  process.env.DOCA_TEST_SECRET_TOKEN = 'sk-test-should-not-reach';
  const out = await run(`
    const w = await tools.write_file({ path: '/etc/doca-script-test.txt', content: 'x' });
    let inner = 'none'; try { await tools.run_code({ code: 'return 1' }); } catch (e) { inner = e.message; }
    return { w: w.slice(0, 80), secret: process.env.DOCA_TEST_SECRET_TOKEN || null, inner };`, { sessionId: s });
  const value = JSON.parse(/Returned: ([\s\S]*?)\nIts calls/.exec(out)[1]);
  assert.match(value.w, /^(Error|Refused)/, 'refused as it would be outside a script');
  assert.equal(value.secret, null, 'a bare environment');
  assert.match(value.inner, /cannot run another script/);
  delete process.env.DOCA_TEST_SECRET_TOKEN;
});

test('a script that runs on past its time limit is stopped, saying how far it got', async () => {
  const s = require('../modules/harness/memory').createSession('Slow').id;
  const out = await run('await new Promise(r => setTimeout(r, 30000));', { sessionId: s }, { timeoutSec: 5 });
  assert.match(out, /^Error: the script stopped — stopped at its time limit \(5 s\)\. It made 0 tool calls\./);
  flag(false);
});

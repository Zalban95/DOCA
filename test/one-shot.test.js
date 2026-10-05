'use strict';

// The floating chat with another harness as the default (modules/harness/one-shot.js; TODO H11.1): each harness is
// asked the way it says it can be — its gateway, or its own one-question mode by argv — and one that has neither says
// so instead of a different agent answering. A fake CLI on PATH echoes the arguments it was given.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const bin = path.join(H.tmp, 'fake-bin');
const posix = process.platform !== 'win32';

before(async () => {
  fs.mkdirSync(bin, { recursive: true });
  if (posix) {
    fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env node\nprocess.stdout.write('args=' + JSON.stringify(process.argv.slice(2)) + ' cwd=' + process.cwd());\n`, { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  }
  await H.start();
});
after(() => H.stop());

const chat = async (message, headers = {}) => {
  const r = await fetch(`${H.base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie, ...headers }, body: JSON.stringify({ message }) });
  const events = (await r.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
  return { text: events.filter(e => e.type === 'text').map(e => e.text).join(''), err: events.filter(e => e.type === 'stderr').map(e => e.text).join(''), done: events.find(e => e.type === 'done') };
};

test('each known CLI says how it is asked one question; OpenClaw without its gateway and an unknown one have no road', () => {
  const shot = require('../modules/harness/one-shot'), catalog = require('../modules/harness/catalog');
  assert.deepEqual(shot.adapterFor(catalog.get('claude')), { kind: 'argv', cmd: 'claude', args: ['-p', '{message}'] });
  assert.deepEqual(shot.adapterFor(catalog.get('codex')).args, ['exec', '{message}']);
  assert.equal(shot.adapterFor(catalog.get('openclaw')), null);
  assert.match(shot.whyNot(catalog.get('openclaw')), /gateway\.http\.endpoints\.chatCompletions/);
  assert.equal(shot.adapterFor(catalog.get('aider')), null);
  assert.match(shot.whyNot(catalog.get('aider')), /Harness tab/);
});

test('the default CLI gets the message as one argument, never through a shell', { skip: !posix && 'a POSIX fake CLI' }, async () => {
  await H.api(null, 'POST', '/api/harness/default', { id: 'claude' });
  const status = (await H.api(null, 'GET', '/api/chat/status')).body;
  assert.equal(status.via, 'argv');
  assert.equal(status.chatEnabled, true);
  const msg = 'hi $(touch pwned) & `id`; echo "x"';
  const r = await chat(msg);
  assert.equal(r.done.code, 0, r.err);
  assert.equal(JSON.parse(/args=(.*) cwd=/.exec(r.text)[1]).join('|'), ['-p', msg].join('|'));
  assert.ok(!fs.existsSync(path.join(require('../modules/paths').WORKSPACE_DIR, 'pwned')));
});

test('someone else\'s agent on this machine is a host\'s to chat with', { skip: !posix && 'a POSIX fake CLI' }, async () => {
  const member = await H.signIn('member');
  const r = await chat('hello', { Cookie: member.cookie });
  assert.equal(r.done.code, 1);
  assert.match(r.err, /only a host can chat with it/);
});

test('a harness with no one-question mode says where it runs, rather than another agent answering', async () => {
  await H.api(null, 'POST', '/api/harness/default', { id: 'aider' });
  const r = await chat('hello');
  assert.equal(r.done.code, 1);
  assert.match(r.err, /Aider has no one-question mode/);
  assert.equal(r.text, '');
  await H.api(null, 'POST', '/api/harness/default', { id: 'doca' });
});

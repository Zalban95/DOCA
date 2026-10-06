'use strict';

/**
 * Every page live on every screen (TODO H10.5, modules/live): one stream of changes per page, each viewer hearing
 * only what they may open, and the folders a page shows watched while it shows them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const H = require('./helpers');
const live = require('../modules/live');
const watch = require('../modules/live/watch');
const memory = require('../modules/harness/memory');
const lifecycle = require('../modules/harness/turn/lifecycle');

test.before(() => H.start());
test.after(() => H.stop());

/** A page's stream: the changes it hears, until close(). */
async function open(cookie) {
  const ctrl = new AbortController();
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: cookie }, signal: ctrl.signal });
  const got = [];
  let buf = '', hello = null;
  const pump = (async () => {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += new TextDecoder().decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith('data: ')) continue;
          const c = JSON.parse(line.slice(6));
          if (c.hello) hello = c; else got.push(c);
        }
      }
    } catch { /* closed */ }
  })();
  for (let i = 0; i < 100 && !hello; i++) await H.sleep(20);
  return { status: res.status, got, hello, close: async () => { ctrl.abort(); await pump; } };
}

const until = async (fn, ms = 3000) => { for (const end = Date.now() + ms; Date.now() < end; await H.sleep(20)) if (fn()) return true; return false; };

test('a turn\'s changes reach every screen that may open the conversation, and no other', async () => {
  const member = await H.signIn('member', 'live-member@test.local');
  const access = require('../modules/harness/session-access');
  const theirs = memory.createSession('member live', { activate: false });
  const hosts = memory.createSession('host live', { activate: false });
  access.claim({ id: member.user.id, role: 'member' }, theirs.id);
  access.claim({ id: H.owner.user.id, role: 'owner' }, hosts.id);
  const a = await open(H.owner.cookie), m = await open(member.cookie);
  assert.equal(a.hello.host, true); assert.equal(m.hello.host, false);
  try {
    lifecycle.changed(hosts.id);
    live.onTurnEvent({ sessionId: hosts.id, type: 'text', text: 'Hel' });
    live.onTurnEvent({ sessionId: theirs.id, type: 'tool_call', name: 'shell' });
    live.onTurnEvent({ sessionId: theirs.id, type: 'tool_result', name: 'shell' });
    live.onTurnEvent({ sessionId: theirs.id, type: 'usage' });   // not a change anyone draws
    live.onTurnEvent({ sessionId: hosts.id, type: 'thinking', text: 'a' });
    live.onTurnEvent({ sessionId: hosts.id, type: 'thinking', text: 'b' });   // within two seconds: not said again
    assert.ok(await until(() => a.got.length >= 5 && m.got.length >= 2));
    await H.sleep(100);
    assert.deepEqual(a.got.map(c => [c.id === hosts.id ? 'host' : 'member', c.what]),
      [['host', 'started'], ['host', 'text'], ['member', 'tool'], ['member', 'row'], ['host', 'thinking']], 'a host hears every conversation');
    assert.equal(a.got[1].delta, 'Hel', 'the answer as it streams');
    assert.deepEqual(m.got.map(c => [c.id, c.what]), [[theirs.id, 'tool'], [theirs.id, 'row']], 'a member only their own');
  } finally { await a.close(); await m.close(); }
});

test('missions changes are heard with the conversation they belong to', async () => {
  const a = await open(H.owner.cookie);
  try {
    require('../modules/agents/missions').announce({ id: 'mis_x', sessionId: 'nope', state: 'running', label: 'x' });
    assert.ok(await until(() => a.got.some(c => c.topic === 'missions' && c.id === 'mis_x' && c.what === 'running')));
  } finally { await a.close(); }
});

test('a folder a page shows is watched while it shows it: a write there is heard, and the watch ends with the page', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'live-'));
  const other = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'live-other-'));
  const a = await open(H.owner.cookie);
  try {
    let r = await H.api(null, 'POST', '/api/live/watch', { screen: a.hello.screen, folders: [dir, 'relative/not/allowed'] });
    assert.deepEqual(r.body.watching, [dir], 'absolute folders only');
    assert.equal(watch.count(), 1);
    for (const n of ['one', 'two', 'three']) fs.writeFileSync(path.join(dir, 'a.txt'), n);
    fs.writeFileSync(path.join(other, 'b.txt'), 'two');   // a folder nobody shows
    assert.ok(await until(() => a.got.some(c => c.topic === 'files' && c.id === dir)), 'the change names the folder');
    await H.sleep(300);
    assert.equal(a.got.filter(c => c.topic === 'files').length, 1, 'three quick writes are one change; nothing from elsewhere');

    r = await H.api(null, 'POST', '/api/live/watch', { screen: 'not-a-screen', folders: [dir] });
    assert.equal(r.status, 404, 'only the page that opened the stream sets its folders');
    const member = await H.signIn('member', 'live-member2@test.local');
    r = await H.api(null, 'POST', '/api/live/watch', { screen: a.hello.screen, folders: [dir] }, { Cookie: member.cookie });
    assert.equal(r.status, 403, 'watching folders is a host\'s');
  } finally { await a.close(); }
  assert.ok(await until(() => watch.count() === 0), 'the page went away, and so did its watch');
});

test('watches are shared: a folder two pages show is watched once and outlives the first page to leave', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'live-shared-'));
  assert.deepEqual(watch.set('s1', [dir]), [dir]);
  assert.deepEqual(watch.set('s2', [dir]), [dir]);
  assert.equal(watch.count(), 1);
  watch.release('s1');
  assert.equal(watch.count(), 1);
  watch.release('s2');
  assert.equal(watch.count(), 0);
  assert.deepEqual(watch.set('s3', [path.join(dir, 'missing')]), [], 'a folder that is not there is not watched');
});

'use strict';

// The hive chat (modules/people, org/): people talking to each other in the database, by the same permission type as
// the rest — DMs and groups between people of different levels, refusals, an admin who cannot read a DM, channels made
// by admins, a level that messages only its team, the organisation tree placed by an admin alone, live delivery to the
// members' pages and devices, the device API, search, and @orchestrator answering as the writer's own agent while the
// agent never sees a conversation it was not brought into.

const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { CONFIG_PATH } = require('../modules/paths');

let model, asked = [];
let owner, member, other, viewer;
const as = (who, method, p, body) => H.api(null, method, p, body, { Cookie: who.cookie, 'X-Doca-Password': who.password });

before(async () => {
  model = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"stub-model"}]}'); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      asked.push(body.messages || []);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The build is green; ship it on Friday.' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
  owner = H.owner;
  member = await H.signIn('member', 'ada@test.local');
  other = await H.signIn('member', 'bo@test.local');
  viewer = await H.signIn('viewer', 'cy@test.local');
  const store = require('../modules/auth/store');
  store.updateUser(member.user.id, { name: 'Ada' });
  store.updateUser(other.user.id, { name: 'Bo' });
  store.updateUser(viewer.user.id, { name: 'Cy' });
});
after(async () => { await H.stop(); await new Promise(r => model.close(r)); });

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await H.sleep(50); }
};

test('a direct message reaches its two people, and nobody else reads it — an admin included', async () => {
  const dm = await as(member, 'POST', '/api/people/dm', { person: other.user.id });
  assert.equal(dm.status, 200, JSON.stringify(dm.body));
  assert.equal(dm.body.kind, 'dm');
  assert.equal(dm.body.title, 'Bo', 'a DM is titled by the other person');
  const again = await as(other, 'POST', '/api/people/dm', { person: member.user.id });
  assert.equal(again.body.id, dm.body.id, 'one direct conversation per pair');

  const sent = await as(member, 'POST', `/api/people/spaces/${dm.body.id}/messages`, { text: 'Hi **Bo**, the kiwi report is ready' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.seq, 1);
  const list = await as(other, 'GET', '/api/people');
  const row = list.body.spaces.find(s => s.id === dm.body.id);
  assert.equal(row.unread, 1);
  assert.match(row.last.text, /kiwi report/);
  const read = await as(other, 'GET', `/api/people/spaces/${dm.body.id}/messages`);
  assert.equal(read.body.messages[0].author.name, 'Ada');
  assert.equal((await as(other, 'POST', `/api/people/spaces/${dm.body.id}/read`, { seq: 1 })).body.readSeq, 1);
  assert.equal((await as(other, 'GET', '/api/people')).body.spaces.find(s => s.id === dm.body.id).unread, 0);

  // The owner holds every right there is, and still: a DM is its two people's.
  assert.equal((await as(owner, 'GET', `/api/people/spaces/${dm.body.id}`)).status, 404);
  assert.equal((await as(owner, 'GET', `/api/people/spaces/${dm.body.id}/messages`)).status, 404);
  assert.equal((await as(owner, 'POST', `/api/people/spaces/${dm.body.id}/messages`, { text: 'hello?' })).status, 404);
  assert.ok(!(await as(owner, 'GET', '/api/people')).body.spaces.some(s => s.id === dm.body.id));
  // Search finds only what the searcher may read.
  assert.equal((await as(member, 'GET', '/api/people/search?q=KIWI')).body.results.length, 1, 'case-insensitive');
  assert.equal((await as(owner, 'GET', '/api/people/search?q=kiwi')).body.results.length, 0);
  assert.equal((await as(member, 'GET', '/api/people/search?q=50%25_off')).body.results.length, 0, 'LIKE wildcards are words');
});

test('a group of three levels: the viewer reads it and writes nothing, and starts no conversation', async () => {
  const g = await as(owner, 'POST', '/api/people/spaces', { kind: 'group', name: 'Launch', members: [member.user.id, viewer.user.id] });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.members.length, 3);
  await as(owner, 'POST', `/api/people/spaces/${g.body.id}/messages`, { text: 'Kickoff at ten' });
  assert.equal((await as(viewer, 'GET', `/api/people/spaces/${g.body.id}/messages`)).body.messages.length, 1, 'a viewer reads where added');
  assert.equal((await as(viewer, 'POST', `/api/people/spaces/${g.body.id}/messages`, { text: 'me too' })).status, 403, 'and writes nothing');
  assert.equal((await as(viewer, 'POST', '/api/people/dm', { person: member.user.id })).status, 403);
  assert.equal((await as(other, 'GET', `/api/people/spaces/${g.body.id}`)).status, 404, 'not a member: absent');

  // Edit, react, reply, pin, delete as a tombstone.
  const m = await as(member, 'POST', `/api/people/spaces/${g.body.id}/messages`, { text: 'Can we move it @owner?' });
  assert.deepEqual(m.body.mentions, [owner.user.id], 'a mention by name');
  assert.equal((await as(owner, 'PATCH', `/api/people/messages/${m.body.id}`, { text: 'not mine' })).status, 403);
  assert.equal((await as(member, 'PATCH', `/api/people/messages/${m.body.id}`, { text: 'Can we move it to eleven?' })).body.editedAt !== null, true);
  const r = await as(owner, 'POST', `/api/people/messages/${m.body.id}/react`, { emoji: '👍' });
  assert.deepEqual(r.body.reactions, { '👍': [owner.user.id] });
  const reply = await as(owner, 'POST', `/api/people/spaces/${g.body.id}/messages`, { text: 'Eleven works', replyTo: m.body.id });
  const thread = await as(member, 'GET', `/api/people/spaces/${g.body.id}/messages?thread=${m.body.id}`);
  assert.deepEqual(thread.body.messages.map(x => x.id), [m.body.id, reply.body.id]);
  await as(member, 'POST', `/api/people/messages/${m.body.id}/pin`, {});
  assert.equal((await as(owner, 'GET', `/api/people/spaces/${g.body.id}`)).body.pins[0].messageId, m.body.id);
  const del = await as(member, 'DELETE', `/api/people/messages/${m.body.id}`);
  assert.ok(del.body.deletedAt);
  assert.equal(del.body.text, '');
  const after = (await as(owner, 'GET', `/api/people/spaces/${g.body.id}/messages`)).body.messages;
  assert.ok(after.find(x => x.id === m.body.id).deletedAt, 'its place stays');
});

test('channels: an organisation\'s made by an admin, joined by anyone it is for', async () => {
  assert.equal((await as(member, 'POST', '/api/people/spaces', { kind: 'channel', name: 'general' })).status, 403);
  const c = await as(owner, 'POST', '/api/people/spaces', { kind: 'channel', name: 'general', topic: 'Everyone' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const before = await as(other, 'GET', '/api/people');
  assert.ok(before.body.joinable.some(j => j.id === c.body.id), 'listed to join');
  assert.equal((await as(other, 'GET', `/api/people/spaces/${c.body.id}/messages`)).status, 200, 'browsable before joining');
  assert.equal((await as(other, 'POST', `/api/people/spaces/${c.body.id}/messages`, { text: 'hi' })).status, 404, 'written in after joining');
  assert.equal((await as(other, 'POST', `/api/people/spaces/${c.body.id}/join`)).status, 200);
  assert.equal((await as(other, 'POST', `/api/people/spaces/${c.body.id}/messages`, { text: 'hi all' })).status, 200);
  assert.equal((await as(other, 'POST', `/api/people/spaces/${c.body.id}/leave`)).status, 200);
});

test('the organisation tree is placed by an admin only, and a team-only level messages its team', async () => {
  assert.equal((await as(member, 'PATCH', `/api/org/people/${other.user.id}`, { managerId: member.user.id })).status, 403);
  const lvl = await as(owner, 'POST', '/api/auth/levels', { name: 'Team only', rights: ['read', 'chat'], people: 'team' });
  assert.equal(lvl.status, 200, JSON.stringify(lvl.body));
  const dee = await H.signIn(lvl.body.level.id, 'dee@test.local');
  require('../modules/auth/store').updateUser(dee.user.id, { name: 'Dee' });
  const refused = await as(dee, 'POST', '/api/people/dm', { person: member.user.id });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /own team/);

  const placed = await as(owner, 'PATCH', `/api/org/people/${dee.user.id}`, { managerId: member.user.id, team: 'Design', title: 'Illustrator' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  assert.equal(placed.body.manager.name, 'Ada');
  assert.equal((await as(dee, 'POST', '/api/people/dm', { person: member.user.id })).status, 200, 'their manager is their team');
  assert.equal((await as(dee, 'POST', '/api/people/dm', { person: other.user.id })).status, 403);
  assert.equal((await as(owner, 'PATCH', `/api/org/people/${member.user.id}`, { managerId: dee.user.id })).status, 400, 'no circles');

  const card = await as(other, 'GET', `/api/org/people/${member.user.id}`);
  assert.deepEqual(card.body.reports.map(r => r.name), ['Dee']);
  assert.equal(card.body.email, undefined, 'a colleague sees no email');
  assert.equal(card.body.editable, false);
  const tree = await as(other, 'GET', '/api/org');
  const ada = JSON.stringify(tree.body.tree);
  assert.match(ada, /"Dee"/);
  assert.equal(tree.body.may.place, 'none');
  assert.equal((await as(owner, 'GET', '/api/org')).body.may.place, 'anyone');
});

test('a message reaches its members\' open pages live, and nobody else\'s', async () => {
  const dm = (await as(member, 'POST', '/api/people/dm', { person: other.user.id })).body;
  const open = who => {
    const got = [], ctrl = new AbortController();
    const ready = fetch(`${H.base}/api/live/stream`, { headers: { Cookie: who.cookie }, signal: ctrl.signal }).then(async res => {
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, i); buf = buf.slice(i + 2); const d = f.split('\n').find(l => l.startsWith('data:')); if (d) got.push(JSON.parse(d.slice(5))); } } }
      catch { /* closed */ }
    });
    return { got, close: () => ctrl.abort(), ready };
  };
  const bo = open(other), boss = open(owner);
  await until(() => bo.got.some(g => g.hello) && boss.got.some(g => g.hello));
  await as(member, 'POST', `/api/people/spaces/${dm.id}/typing`);
  await as(member, 'POST', `/api/people/spaces/${dm.id}/messages`, { text: 'live one' });
  const hit = await until(() => bo.got.find(g => g.topic === 'chat' && g.what === 'new'));
  assert.equal(hit.message.text, 'live one');
  assert.equal(hit.to, undefined, 'the recipients list stays on the hub');
  assert.ok(bo.got.some(g => g.topic === 'chat' && g.what === 'typing' && g.by.name === 'Ada'));
  await H.sleep(150);
  assert.ok(!boss.got.some(g => g.topic === 'chat'), 'a host\'s page does not hear a DM it is not in');
  bo.close(); boss.close();
});

test('a device reads and writes as its person, and is told of a DM with a notice', async () => {
  const devices = require('../modules/api-v1/devices');
  const { device, token } = H.mkDevice('Bo phone', 'phone', H.PHONE_CAPS);
  devices.update(device.id, { userId: other.user.id, orgId: other.orgId });
  const s = H.sse(token);
  await s.ready;
  const dm = (await as(member, 'POST', '/api/people/dm', { person: other.user.id })).body;
  await as(member, 'POST', `/api/people/spaces/${dm.id}/messages`, { text: 'are you around?' });
  const ev = await s.waitFor(e => e.type === 'people.message' && e.payload.message.text === 'are you around?');
  assert.equal(ev.payload.notify, true);
  const alert = await s.waitFor(e => e.type === 'alert' && e.payload.ext?.people?.spaceId === dm.id);
  assert.match(alert.payload.title, /Ada/);

  const listed = await H.api(token, 'GET', '/api/v1/people');
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.ok(listed.body.spaces.some(x => x.id === dm.id));
  assert.ok(listed.body.people.some(p => p.name === 'Ada'));
  const w = await H.api(token, 'POST', `/api/v1/people/spaces/${dm.id}/messages`, { text: 'yes, from my phone' });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal(w.body.author.id, other.user.id, 'as its person');
  assert.equal((await H.api(token, 'POST', `/api/v1/people/spaces/${dm.id}/read`, { seq: w.body.seq })).body.readSeq, w.body.seq);
  assert.equal((await H.api(token, 'POST', `/api/v1/people/messages/${w.body.id}/react`, { emoji: '🎉' })).status, 200);
  const g = (await as(owner, 'POST', '/api/people/spaces', { kind: 'group', name: 'Ops', members: [member.user.id] })).body;
  assert.equal((await H.api(token, 'GET', `/api/v1/people/spaces/${g.id}/messages`)).status, 404, 'not its person\'s');
  s.close();

  const nobody = H.mkDevice('Old token', 'phone', H.PHONE_CAPS);
  const r = await H.api(nobody.token, 'GET', '/api/v1/people');
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'person_required');
  const watch = H.mkDevice('Viewer kiosk', 'viewer', H.PHONE_CAPS);
  assert.equal((await H.api(watch.token, 'GET', '/api/v1/people')).status, 403, 'harness:chat is the scope');
});

test('@orchestrator asks the writer\'s own agent, under their level, and its answer is posted labelled', async () => {
  const g = (await as(owner, 'POST', '/api/people/spaces', { kind: 'group', name: 'Release', members: [member.user.id, other.user.id] })).body;
  await as(other, 'POST', `/api/people/spaces/${g.id}/messages`, { text: 'Is the walrus build green?' });
  const secret = (await as(owner, 'POST', '/api/people/dm', { person: other.user.id })).body;
  await as(owner, 'POST', `/api/people/spaces/${secret.id}/messages`, { text: 'zebra-secret salary numbers' });
  asked = [];
  await as(member, 'POST', `/api/people/spaces/${g.id}/messages`, { text: '@orchestrator can we ship on Friday?' });
  const answer = await until(async () => (await as(other, 'GET', `/api/people/spaces/${g.id}/messages`)).body.messages.find(m => m.agent));
  assert.equal(answer.author.id, member.user.id, 'the writer\'s agent');
  assert.equal(answer.agent, 'orchestrator');
  assert.equal(answer.agentLabel, 'Ada\'s agent');
  assert.match(answer.text, /ship it on Friday/);

  const sent = JSON.stringify(asked.at(-1));
  assert.match(sent, /walrus build/, 'it read what the person brought in');
  assert.doesNotMatch(sent, /zebra-secret/, 'and nothing of a conversation it was not brought into');
  const memory = require('../modules/harness/memory');
  const bridge = memory.listSessions().sessions.find(s => s.peopleSpace === g.id);
  assert.equal(require('../modules/harness/session-access').ownerOf(bridge.id), member.user.id, 'a conversation of the writer\'s own');
  const run = await require('../modules/db').get('SELECT person_id FROM runs WHERE session_id = ? ORDER BY started_at DESC', [bridge.id]);
  assert.equal(run.person_id, member.user.id, 'the turn ran as the writer');
  const found = require('../modules/harness/recall').search('zebra-secret', { person: { id: owner.user.id, role: 'owner' } });
  assert.equal(found.length, 0, 'recall finds no people chat nobody brought in');
});

test('everyone sees their own Orchestrator in the floating chat', async () => {
  const mine = await as(other, 'GET', '/api/chat/history');
  assert.equal(mine.body.sessionId, null, 'none until they write');
  const sse = await fetch(`${H.base}/api/chat`, { method: 'POST', headers: { Cookie: other.cookie, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ message: 'hello from Bo' }) });
  await sse.text();
  const after = await as(other, 'GET', '/api/chat/history');
  const main = require('../modules/harness/memory').mainSession().id;
  assert.ok(after.body.sessionId && after.body.sessionId !== main, 'their own, not the hub\'s');
  assert.ok(after.body.messages.some(m => m.content === 'hello from Bo'));
  assert.ok(!(await as(owner, 'GET', '/api/chat/history')).body.messages.some(m => m.content === 'hello from Bo'));
  const list = await as(other, 'GET', '/api/people');
  assert.equal(list.body.agents[0].id, after.body.sessionId, 'first in their chat list');
});

test('the compliance export is the owner\'s alone, with the password, and audited', async () => {
  const admin = await H.signIn('admin', 'eve@test.local');
  assert.equal((await as(admin, 'POST', '/api/people/export')).status, 403);
  assert.equal((await H.api(null, 'POST', '/api/people/export', undefined, { 'X-Doca-Password': '' })).status, 401, 'the password is asked');
  const r = await as(owner, 'POST', '/api/people/export');
  assert.equal(r.status, 200);
  assert.ok(r.body.messages.length > 3);
  const audit = await require('../modules/auth/store').auditTail(5);
  assert.ok(audit.some(a => a.action === 'hive chat exported'));
  assert.equal(require('../modules/features').get('hive-chat').licence, 'people');
});

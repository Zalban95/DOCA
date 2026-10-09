'use strict';

/**
 * A new device waits until someone who may approve it says yes (the owner's decision of 2026-10-09; devices-approval/,
 * api-v1/pending.js, auth/approve-devices.js). A level's approveDevices: owner and admin anyone, member own, viewer none.
 */
const h = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PRESETS } = require('../modules/api-v1/scopes');

before(h.start);
after(() => { require('../modules/devices-approval')._reset(); return h.stop(); });   // no question left waiting on a device

const devices = () => require('../modules/api-v1/devices');
const as = who => (m, p, body) => h.api(null, m, p, body, { Cookie: who.cookie, 'X-Doca-Password': '' });

/** Pair through the panel as `who` (h.owner when null) and complete it as the device would; never approved here. */
async function pair(who, body, caps = h.PHONE_CAPS) {
  const start = who ? await as(who)('POST', '/api/devices/pair', body) : await h.api(null, 'POST', '/api/devices/pair', body);
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const done = await h.api(null, 'POST', '/api/v1/devices/pair/complete', { code: start.body.code, caps }, { Cookie: '' });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  return { start: start.body, ...done.body };
}

/** A custom level (SQLite only; null with PostgreSQL, where the test is skipped). */
function level(input) {
  try { return require('../modules/auth/levels').create(input, { actorLevel: 'owner' }); }
  catch (e) { if (e.status === 501) return null; throw e; }
}

test('the owner pairing from the panel is never held up: allowed as it pairs, with what the preset holds', async () => {
  const r = await pair(null, { name: 'Owner phone', preset: 'phone' });
  assert.equal(r.start.approval.state, 'approved', 'the pairing card says it will be allowed');
  assert.equal(r.approval.state, 'approved');
  const rec = devices().get(r.device.id);
  assert.equal(rec.approval.by.userId, h.owner.user.id);
  assert.equal(rec.approval.via, 'panel');
  assert.deepEqual(rec.scopes.slice().sort(), PRESETS.phone.slice().sort());
  assert.equal((await h.api(r.token, 'GET', '/api/v1/capabilities')).status, 200);
});

test('a pending device reads its own record and holds its stream, and every other route answers pending_approval', async () => {
  const mia = await h.signIn('member');
  const r = await pair(mia, { name: 'Mia phone', preset: 'phone' });
  assert.equal(r.start.approval.state, 'pending', 'the pairing card says it will wait');
  assert.ok(r.start.approval.askedOf.includes('member') && r.start.approval.askedOf.includes('owner'), 'her, and an approver of any device');
  assert.equal(r.approval.state, 'pending');
  assert.match(r.approval.message, /Waiting for approval by/);

  const me = await h.api(r.token, 'GET', '/api/v1/devices/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.approval.state, 'pending');
  assert.deepEqual(me.body.approval.askedOf.sort(), ['member', 'owner'].sort());
  assert.equal((await h.api(r.token, 'GET', `/api/v1/devices/${r.device.id}`)).status, 200, 'its own id too');
  assert.equal((await h.api(r.token, 'GET', '/api/v1/events')).status, 200, 'a poll of its events');
  assert.equal((await h.api(r.token, 'POST', '/api/v1/events/ack', { seq: 0 })).status, 200);

  for (const [m, p, body] of [['GET', '/api/v1/capabilities'], ['GET', '/api/v1/devices'], ['PATCH', '/api/v1/devices/me', { name: 'x' }],
    ['POST', '/api/v1/harness/messages', { message: 'hi' }], ['GET', '/api/v1/harness/sessions'], ['POST', '/api/v1/mcp/offer', { url: 'http://127.0.0.1:1/mcp' }],
    ['GET', '/api/v1/prompts'], ['GET', '/api/v1/commands'], ['POST', '/api/v1/devices/pair/start', { preset: 'watch' }], ['GET', '/api/v1/settings/effective'],
    ['POST', `/api/v1/devices/${r.device.id}/approve`]]) {
    const res = await h.api(r.token, m, p, body);
    assert.equal(res.status, 403, `${m} ${p}`);
    assert.equal(res.body.error.code, 'pending_approval', `${m} ${p}`);
    assert.match(res.body.error.message, /waits for approval/);
    assert.equal(res.body.error.approval.state, 'pending');
  }
  // A page opened with its token is not a way past it.
  const page = await h.api(null, 'GET', `/d/${r.device.id}/`, undefined, { Cookie: '', Authorization: `Bearer ${r.token}` });
  assert.ok(!String(page.headers.get('set-cookie') || '').includes(require('../modules/auth/credentials').COOKIE), 'no session opened with its token');
  // Nothing meant for its person is queued for it; its answer is.
  assert.equal(require('../modules/api-v1/bus').publish(r.device.id, 'alert', { title: 'private' }), null);
  assert.equal(require('../modules/harness/reach').resolveTargets('all').some(d => d.id === r.device.id), false, 'never asked or told anything');
  const stream = h.sse(r.token);
  await stream.ready;
  const ok = await as(mia)('POST', `/api/devices/${r.device.id}/approve`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const ev = await stream.waitFor('device.approved');
  assert.equal(ev.payload.by, 'member');
  assert.ok(!stream.events.some(e => e.type === 'alert'));
  stream.close();
  assert.equal((await h.api(r.token, 'GET', '/api/v1/capabilities')).status, 200, 'open now');
  const opened = await h.api(null, 'GET', `/d/${r.device.id}/`, undefined, { Cookie: '', Authorization: `Bearer ${r.token}` });
  assert.ok(String(opened.headers.get('set-cookie') || '').includes(require('../modules/auth/credentials').COOKIE), 'and now its page opens');
  assert.equal((await as(mia)('POST', `/api/devices/${r.device.id}/approve`, {})).status, 409, 'decided once');
});

test('a person approves their own from a device of theirs: asked there as a question, one tap', async () => {
  const mia = await h.signIn('member');
  const phone = await pair(mia, { name: 'Mia phone A', preset: 'phone' });
  assert.equal((await as(mia)('POST', `/api/devices/${phone.device.id}/approve`, {})).status, 200);
  const desk = await pair(mia, { name: 'Mia desk', preset: 'phone' }, { formFactor: 'desktop' });
  assert.equal(desk.approval.state, 'pending');
  let q = null;
  for (let i = 0; i < 50 && !q; i++) {
    q = ((await h.api(phone.token, 'GET', '/api/v1/prompts')).body.prompts || []).find(p => /Your new computer/.test(p.title));
    if (!q) await h.sleep(100);
  }
  assert.ok(q, 'the question reached her phone');
  assert.ok(q.choices.some(c => c.id === 'allow') && q.choices.some(c => c.id === 'refuse'));
  const sel = await h.api(phone.token, 'POST', `/api/v1/prompts/${q.id}/select`, { choiceId: 'allow', selectionId: require('crypto').randomUUID() });
  assert.ok(sel.status < 300, JSON.stringify(sel.body));
  for (let i = 0; i < 50 && devices().isPending(devices().get(desk.device.id)); i++) await h.sleep(100);
  const rec = devices().get(desk.device.id);
  assert.equal(rec.approval.state, 'approved');
  assert.equal(rec.approval.via, phone.device.id, 'answered from her phone');
  assert.ok(rec.scopes.includes('command:*'), 'her own approval keeps the preset; her level holds it back on every request');
  assert.deepEqual((await h.api(desk.token, 'GET', '/api/v1/commands')).body.commands, []);
  // A watch paired from her approved phone: the code went device to device, so it is allowed as it pairs.
  const start = await h.api(phone.token, 'POST', '/api/v1/devices/pair/start', { preset: 'watch', name: 'Mia watch' });
  const watch = await h.api(null, 'POST', '/api/v1/devices/pair/complete', { code: start.body.code, caps: h.WATCH_CAPS }, { Cookie: '' });
  assert.equal(watch.body.approval.state, 'approved');
  assert.equal(devices().get(watch.body.device.id).approval.via, phone.device.id);
  // The audit and Chronicle's hub lines say who allowed it, from where.
  await h.sleep(50);
  const audit = (await require('../modules/auth/store').auditTail(200)).find(e => e.action === 'device approved' && e.detail.startsWith(desk.device.id));
  assert.equal(audit.actorId, mia.user.id);
  assert.equal(audit.via, phone.device.id);
  const lines = require('../modules/activity').list ? await require('../modules/activity').list({}) : [];
  assert.ok(JSON.stringify(lines).includes('Mia desk approved by member from Mia phone A'));
});

test('an admin approves a member\'s device from the panel; another member cannot, and neither sees it waiting', async () => {
  const mia = await h.signIn('member'), leo = await h.signIn('member');
  const r = await pair(mia, { name: 'Mia tablet', preset: 'phone' }, { formFactor: 'tablet' });
  const forOwner = await h.api(null, 'GET', '/api/devices/pending');
  assert.ok(forOwner.body.devices.some(d => d.id === r.device.id && d.person.id === mia.user.id && d.from.network === 'this machine'));
  assert.ok(!(await as(leo)('GET', '/api/devices/pending')).body.devices.some(d => d.id === r.device.id));
  const no = await as(leo)('POST', `/api/devices/${r.device.id}/approve`, {});
  assert.equal(no.status, 403);
  assert.match(no.body.error, /someone else's/);
  const list = await h.api(null, 'GET', '/api/devices');
  assert.equal(list.body.devices.find(d => d.id === r.device.id).canDecide, true);
  const ok = await h.api(null, 'POST', `/api/devices/${r.device.id}/approve`, {});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.device.approval.by.userId, h.owner.user.id);
  assert.deepEqual(ok.body.device.scopes.slice().sort(), PRESETS.phone.slice().sort(), 'the owner holds all of it');
});

test('a level that approves none: its people wait for someone who may, and cannot approve their own', async t => {
  const l = level({ name: 'Guests', rights: ['read', 'chat'], reach: 'own-devices', approveDevices: 'none' });
  if (!l) return t.skip('custom levels need SQLite');
  assert.equal(require('../modules/auth/approve-devices').rungOf(l.id), 'none');
  const gus = await h.signIn(l.id);
  const r = await pair(gus, { name: 'Gus phone', preset: 'phone' });
  assert.ok(!r.start.approval.askedOf.includes(l.id), 'not asked of himself');
  const no = await as(gus)('POST', `/api/devices/${r.device.id}/approve`, {});
  assert.equal(no.status, 403);
  assert.match(no.body.error, /approves no device/);
  assert.equal((await h.api(null, 'POST', `/api/devices/${r.device.id}/approve`, {})).status, 200, 'the owner may');
});

test('the ceiling: a device holds at most what its approver and its person hold', async t => {
  const leads = level({ name: 'Leads', rights: ['read', 'chat', 'devices'], reach: 'own-devices', approveDevices: 'anyone' });
  if (!leads) return t.skip('custom levels need SQLite');
  const lea = await h.signIn(leads.id), mia = await h.signIn('member');
  const r = await pair(mia, { name: 'Mia phone C', preset: 'phone' });
  const ok = await as(lea)('POST', `/api/devices/${r.device.id}/approve`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const rec = devices().get(r.device.id);
  assert.ok(!rec.scopes.includes('command:*'), 'the approver holds no host, so neither does the device');
  assert.deepEqual(rec.approval.dropped, ['command:*']);
  assert.deepEqual(rec.scopes.slice().sort(), PRESETS.phone.filter(s => s !== 'command:*').sort());
  const ceil = require('../modules/api-v1/owner-ceiling').ceilingFor;
  assert.deepEqual(ceil(['*'], 'member').filter(s => /^(command|agent|packs)/.test(s)), [], 'the admin preset spread without the machine\'s');
  assert.deepEqual(ceil(['harness:chat', 'read:*'], 'viewer'), ['read:*'], 'no chat, no harness');
  assert.deepEqual(ceil(['command:*'], null), ['command:*'], 'no person: as it is');
  // A level never approves more than its maker.
  assert.throws(() => require('../modules/auth/levels').create({ name: 'Wide', rights: ['read', 'chat'], approveDevices: 'anyone' }, { actorLevel: 'member' }), /approves more devices|rights you do not hold/);
});

test('refusing revokes the token and tells the device first', async () => {
  const mia = await h.signIn('member');
  const r = await pair(mia, { name: 'Unknown phone', preset: 'phone' });
  const stream = h.sse(r.token);
  await stream.ready;
  const no = await h.api(null, 'POST', `/api/devices/${r.device.id}/refuse`, {});
  assert.equal(no.status, 200);
  assert.equal(no.body.device.approval.state, 'refused');
  const ev = await stream.waitFor('device.refused');
  assert.equal(ev.payload.by, 'owner');
  await stream.waitClosed();
  assert.equal((await h.api(r.token, 'GET', '/api/v1/devices/me')).status, 401);
  assert.ok(devices().get(r.device.id).revokedAt);
});

test('the sockets refuse a pending device', async () => {
  const mia = await h.signIn('member');
  const r = await pair(mia, { name: 'Socket phone', preset: 'phone' });
  const { WebSocket } = require('ws');
  for (const p of ['/api/v1/mcp/host', '/api/v1/realtime', '/api/v1/call']) {
    const code = await new Promise(resolve => {
      const ws = new WebSocket(`${h.base.replace('http', 'ws')}${p}`, { headers: { Authorization: `Bearer ${r.token}` } });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('open', () => { ws.close(); resolve(101); });
      ws.on('error', () => resolve(0));
    });
    assert.equal(code, 403, p);
  }
});

test('a linked chat of a member waits, says so in the chat, and is told when allowed', async () => {
  const mia = await h.signIn('member');
  const links = require('../modules/channels/links').forChannel('approvaltest');
  const said = [];
  const bind = require('../modules/channels/bind').binder({ label: 'Testchat', links, caps: { formFactor: 'phone', ext: { channel: 'testchat' } },
    onEvent: (addr, deviceId, env) => require('../modules/channels/deliver').onEvent({ say: async (_a, t) => said.push(t) }, addr, deviceId, env) });
  const ch = { label: 'Testchat', links, bind, say: async (_a, t) => said.push(t) };
  const converse = require('../modules/channels/converse');
  const { code } = links.newCode(mia.user.id);
  await converse.handle(ch, { addr: 'chat1', text: `/link ${code}`, from: { who: 'Mia' } });
  assert.match(said.at(-1), /waiting for approval/);
  const c = links.chat('chat1');
  assert.ok(devices().isPending(devices().get(c.deviceId)));
  await converse.handle(ch, { addr: 'chat1', text: 'hello' });
  assert.match(said.at(-1), /waits for approval/, 'nothing reaches the agent');
  assert.equal((await as(mia)('POST', `/api/devices/${c.deviceId}/approve`, {})).status, 200);
  for (let i = 0; i < 30 && !said.some(t => /allowed this chat/.test(t)); i++) await h.sleep(50);
  assert.ok(said.some(t => /member allowed this chat/.test(t)));
  bind.detachAll();
});

test('the question reaches the hosts\' open pages and the person\'s own, not another member\'s', async () => {
  const mia = await h.signIn('member'), leo = await h.signIn('member');
  const open = who => {
    const ctrl = new AbortController(); let text = '';
    const done = fetch(`${h.base}/api/live/stream`, { headers: { Cookie: who.cookie }, signal: ctrl.signal })
      .then(async res => { for await (const chunk of res.body) text += Buffer.from(chunk).toString(); }).catch(() => {});
    return { get text() { return text; }, close: () => { ctrl.abort(); return done; } };
  };
  const pages = [open(h.owner), open(mia), open(leo)];
  await h.sleep(200);
  const r = await pair(mia, { name: 'Mia e-reader', preset: 'phone' }, { formFactor: 'tablet' });
  await h.sleep(300);
  const heard = pages.map(p => p.text.includes(`"topic":"device"`) && p.text.includes(r.device.id));
  await Promise.all(pages.map(p => p.close()));
  assert.deepEqual(heard, [true, true, false], 'the owner and Mia hear it, Leo does not');
});

test('devices paired before approval existed are approved by the migration, and never asked', async () => {
  const old = devices().create({ name: 'old phone', scopes: PRESETS.phone, caps: h.PHONE_CAPS });
  delete devices().get(old.device.id).approval;
  assert.equal(devices().isPending(devices().get(old.device.id)), false, 'no approval reads as approved');
  const m = require('../modules/migrations').MIGRATIONS.find(x => x.id === '2.344-devices-approved');
  const { ran } = require('../modules/migrations').run({}, [m]);
  assert.equal(ran[0].changed.length, 1);
  assert.equal(devices().get(old.device.id).approval.state, 'approved');
  assert.equal(devices().get(old.device.id).approval.via, 'migration');
  assert.equal((await h.api(old.token, 'GET', '/api/v1/capabilities')).status, 200);
});

test('built-in levels: owner and admin approve anyone, member their own, viewer none', () => {
  const { rungOf } = require('../modules/auth/approve-devices');
  assert.deepEqual(['owner', 'admin', 'member', 'viewer'].map(rungOf), ['anyone', 'anyone', 'own', 'none']);
});

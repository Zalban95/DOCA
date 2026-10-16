'use strict';

/**
 * Important changes, said and logged (modules/important/; asked 2026-10-16): a guarded change made through its route
 * is exactly one mechanical record — the activity log with `important`, the audit, a red `note` row in the person's own
 * main conversation that no model is sent, and the live feed's `important` topic heard by them and a host only — with
 * secret values never shown. An ordinary setting makes none.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const important = () => require('../modules/activity').list({ limit: 500 }).filter(l => l.important);
const settle = () => new Promise(r => setTimeout(r, 200));   // the record is written after the answer

function listen(who) {
  const ctrl = new AbortController(); let text = '';
  const done = fetch(`${H.base}/api/live/stream`, { headers: { Cookie: who.cookie }, signal: ctrl.signal })
    .then(async res => { for await (const chunk of res.body) text += Buffer.from(chunk).toString(); }).catch(() => {});
  return { get text() { return text; }, close: () => { ctrl.abort(); return done; } };
}

const ownMain = who => require('../modules/harness/own-main').of({ id: who.user.id, orgId: who.orgId, role: who.role });

test('a guarded setting changed with the password: one record, a red row for the person, heard by them and a host only', async () => {
  const main = ownMain(H.owner);   // the floating chat's conversation exists, as it does once the panel opened
  const member = await H.signIn('member');
  const pages = [listen(H.owner), listen(member)];
  await H.sleep(200);
  const before = important().length;
  const r = await H.api(null, 'POST', '/api/prefs', { harness: { approval: { mode: 'manual' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const recs = important();
  assert.equal(recs.length, before + 1, 'exactly one record');
  const rec = recs[0];
  assert.match(rec.what, /^Approval mode: .+ → manual$/);
  assert.equal(rec.person.id, H.owner.user.id);
  assert.match(rec.why, /^the panel/);
  const rows = require('../modules/harness/memory').messages(main).filter(m => m.role === 'note');
  assert.equal(rows.length, 1);
  assert.match(rows[0].content, /^⚠ Changed: Approval mode: .+ → manual$/);
  assert.equal(rows[0].from.formFactor, 'hub', 'DOCA\'s own note');
  const sent = require('../modules/harness/turn/messages').toApiMessages(require('../modules/harness/memory').messages(main), { sessionId: main });
  assert.ok(!sent.some(m => /Changed:/.test(String(m.content || ''))), 'never sent to a model');
  const heard = pages.map(p => p.text.includes('"topic":"important"') && p.text.includes('Approval mode'));
  await Promise.all(pages.map(p => p.close()));
  assert.deepEqual(heard, [true, false], 'the person who changed it hears it, another member does not');
  const tail = await require('../modules/auth/store').auditTail(30);
  assert.ok(tail.some(e => e.action === 'important change' && /Approval mode/.test(e.detail)), 'in the audit trail');
  const hist = await H.api(null, 'GET', '/api/chat/history');
  assert.ok(hist.body.messages.some(m => m.role === 'note' && m.important), 'the floating chat draws it on reload');
  await H.api(null, 'POST', '/api/prefs', { harness: { approval: { mode: 'auto' } } });
  await settle();
});

test('an ordinary setting, or a guarded one left as it was, makes no record', async () => {
  const before = important().length;
  let r = await H.api(null, 'POST', '/api/prefs', { theme: 'light' });
  assert.equal(r.status, 200);
  r = await H.api(null, 'POST', '/api/prefs', { harness: { approval: { mode: 'auto' } } });
  assert.equal(r.status, 200);
  await settle();
  assert.equal(important().length, before);
});

test('a secret-shaped value under a guarded path is said changed, never shown', async () => {
  const before = important().length;
  const r = await H.api(null, 'POST', '/api/prefs', { network: { relayToken: 'sekret-value-9f3' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const recs = important();
  assert.equal(recs.length, before + 1);
  assert.match(recs[0].what, /Network relayToken: changed \(a secret, not shown\)/);
  const dir = require('../modules/activity').dir();
  for (const f of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes('sekret-value-9f3'), 'not in the activity log');
  const main = ownMain(H.owner);
  assert.ok(!JSON.stringify(require('../modules/harness/memory').messages(main)).includes('sekret-value-9f3'), 'not in the transcript');
  const words = require('../modules/important/words');
  assert.equal(words.line({ path: 'sharing.apiKey', from: 'a', to: 'b' }), 'Sharing with the project apiKey: changed (a secret, not shown)');
  assert.equal(words.show({ token: 'x', on: true }), '{"token":"••••••••","on":true}');
});

test('accounts and levels through their routes: what they were and what they are, in words', async () => {
  const member = await H.signIn('member');
  let r = await H.api(null, 'PATCH', `/api/auth/users/${member.user.id}`, { level: 'viewer' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  assert.match(important()[0].what, /^Account member: level member → viewer$/);
  r = await H.api(null, 'POST', '/api/auth/levels', { name: 'Testers', rights: ['read', 'chat'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  assert.match(important()[0].what, /^Level made: Testers/);
  const c = await H.api(null, 'GET', '/api/chronicle?source=hub&state=important');
  assert.ok(c.body.rows.length >= 2 && c.body.rows.every(x => x.important), 'Chronicle filters them');
});

test('a refused change (wrong password) makes no record', async () => {
  const before = important().length;
  const r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'unattended', confirm: true }, { 'X-Doca-Password': 'wrong' });
  assert.equal(r.status, 403);
  require('../modules/auth/routes')._failures.clear();
  await settle();
  assert.equal(important().length, before);
});

test('a device call of the person hears it as a notice frame, stage important; another person\'s does not', () => {
  const calls = require('../modules/realtime/calls');
  const got = [];
  const end1 = calls.open('s-imp-1', { person: { id: 'p1' }, deviceId: 'd1', notice() {}, frame: f => got.push(['d1', f]) });
  const end2 = calls.open('s-imp-2', { person: { id: 'p2' }, deviceId: 'd2', notice() {}, frame: f => got.push(['d2', f]) });
  assert.equal(calls.important('p1', '⚠ Changed: Approval mode: auto → manual'), 1);
  end1(); end2();
  assert.deepEqual(got, [['d1', { type: 'notice', stage: 'important', text: '⚠ Changed: Approval mode: auto → manual' }]]);
});

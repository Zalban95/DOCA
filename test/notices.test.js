'use strict';

/**
 * A notice reaches someone who can see it (deep test B1, 2026-10-08): a reminder "fired" on a doca-client — which
 * holds `interact` and draws nothing — and its record said "Reminded on desk-client" while the person, at the panel,
 * saw nothing. Now only a device that can show it is a target, the panel's own notices reach the person's pages,
 * and the record names exactly who got it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const H = require('./helpers');
const devices = require('../modules/api-v1/devices');
const bus = require('../modules/api-v1/bus');
const tools = require('../modules/harness/tools');
const schedules = require('../modules/schedules');

test.before(() => H.start());
test.after(() => H.stop());

const CLIENT_CAPS = { formFactor: 'desktop', input: { text: true }, exec: ['shell'], ext: { client: 'doca-client', os: 'linux' } };
const alerts = d => bus.drain(d.id, 0).events.filter(e => e.type === 'alert');

/** A page of `cookie`'s person: the `notice` changes it hears on the live feed. */
async function page(cookie) {
  const ctrl = new AbortController();
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: cookie }, signal: ctrl.signal });
  const got = [];
  let buf = '';
  (async () => {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += new TextDecoder().decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (line.startsWith('data: ')) { const c = JSON.parse(line.slice(6)); if (c.topic === 'notice') got.push(c); }
        }
      }
    } catch { /* closed */ }
  })();
  await H.sleep(150);
  return { got, close: () => ctrl.abort() };
}

const until = async (pred, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await H.sleep(30); } return false; };

test('a reminder skips a doca-client, shows on the person\'s pages, and its record says so', async () => {
  const member = await H.signIn('member', 'notice-a@test.local');
  const other = await H.signIn('member', 'notice-b@test.local');
  const client = H.mkDevice('desk-client', 'phone', CLIENT_CAPS).device;
  devices.update(client.id, { userId: member.user.id });
  const mine = await page(member.cookie), theirs = await page(other.cookie);
  try {
    const out = await tools.call('remind', { text: 'Stretch your legs', in: 1 }, [], { user: { ...member.user, role: 'member' } });
    assert.match(out, /on the panel only \(No device of theirs could show it: desk-client \(a doca-client/, out);
    const r = schedules.listFor({ ...member.user, role: 'member' }).find(x => x.kind === 'reminder' && x.text === 'Stretch your legs');
    await schedules.runNow(r.id);
    const last = schedules.get(r.id).last;
    assert.equal(last.ok, true);
    assert.doesNotMatch(last.summary, /Sent to desk-client/, 'a client that draws nothing is never named as reached');
    assert.match(last.summary, /^Sent to the panel \(on 1 open page\)\. No device of theirs could show it: desk-client \(a doca-client/, last.summary);
    assert.equal(alerts(client).length, 0, 'nothing published to a client that ignores alerts');
    assert.ok(await until(() => mine.got.some(c => c.what === 'new' && c.notice.text === 'Stretch your legs')), 'drawn on their page');
    assert.equal(theirs.got.length, 0, 'nobody else\'s page');
    const listed = (await H.api(null, 'GET', '/api/notices', undefined, { Cookie: member.cookie })).body.notices;
    assert.equal(listed[0].text, 'Stretch your legs', 'kept for a page opened later');
    const seen = await H.api(null, 'POST', `/api/notices/${listed[0].id}/seen`, {}, { Cookie: member.cookie });
    assert.equal(seen.status, 200);
    assert.equal((await H.api(null, 'GET', '/api/notices', undefined, { Cookie: member.cookie })).body.notices.length, 0);
    assert.equal((await H.api(null, 'POST', `/api/notices/${listed[0].id}/seen`, {}, { Cookie: other.cookie })).status, 404, 'not another person\'s to dismiss');
  } finally { mine.close(); theirs.close(); }
});

test('a phone that shows it gets the reminder too, and is the one named', async () => {
  const member = await H.signIn('member', 'notice-c@test.local');
  const phone = H.mkDevice('Pixel', 'phone', H.PHONE_CAPS).device;
  devices.update(phone.id, { userId: member.user.id });
  const s = schedules.create({ kind: 'reminder', text: 'Water the plants', at: new Date(Date.now() + 60e3).toISOString() }, { person: { id: member.user.id, role: 'member' }, madeBy: 'agent' });
  await schedules.runNow(s.id);
  assert.match(schedules.get(s.id).last.summary, /^Sent to Pixel \(.+\) and the panel \(no page open/);
  assert.equal(alerts(phone).length, 1);
});

test('tell_device falls back to the panel and ask_device asks at the panel when only a doca-client is theirs', async () => {
  const member = await H.signIn('member', 'notice-d@test.local');
  const client = H.mkDevice('their-client', 'phone', CLIENT_CAPS).device;
  devices.update(client.id, { userId: member.user.id });
  const ctx = { user: { ...member.user, role: 'member' } };
  const told = await tools.call('tell_device', { title: 'Build finished' }, [], ctx);
  assert.match(told, /^Sent to the panel .*No device of theirs could show it: their-client \(a doca-client/, told);
  assert.equal(alerts(client).length, 0);

  const reach = require('../modules/harness/reach');
  const asked = tools.call('ask_device', { question: 'Ship it?', choices: ['Yes', 'No'], timeoutSec: 10 }, [], ctx);
  assert.ok(await until(() => reach.openQuestions().some(q => q.question === 'Ship it?')), 'open at the panel');
  reach.answerAtPanel(reach.openQuestions().find(q => q.question === 'Ship it?').id, { choiceId: 'c1' });
  const out = await asked;
  assert.match(out, /the person at the panel .*answered: "Yes".*asked at the panel only/, out);
  assert.equal(bus.drain(client.id, 0).events.filter(e => e.type === 'prompt.new').length, 0, 'no question to a client that cannot show it');
});

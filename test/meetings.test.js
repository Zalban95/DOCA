'use strict';

/**
 * Meetings (modules/meetings): a meeting's life and who may be in it, the pages' messages relayed only to the page
 * they are for, invitations as iCalendar (RFC 5545) and into a person's own Google or Microsoft calendar (stubs),
 * taking control only after the sharer's two consents and stopping at once when revoked, and the audit lines.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let alice, bob, eve, viewer;

/** A page's live stream, as the browser opens it: its screen id, and every change it hears. */
async function page(who) {
  const ctrl = new AbortController();
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: who.cookie }, signal: ctrl.signal });
  const reader = res.body.getReader(), dec = new TextDecoder();
  const heard = [];
  let buf = '', screen = null;
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          const c = JSON.parse(line.slice(6));
          if (c.hello) screen = c.screen; else heard.push(c);
        }
      }
    } catch { /* closed */ }
  })();
  for (let t = 0; !screen && t < 100; t++) await H.sleep(30);
  const wait = async (pred, ms = 3000) => {
    for (let t = 0; t < ms; t += 30) { const hit = heard.find(pred); if (hit) return hit; await H.sleep(30); }
    return null;
  };
  return { screen, heard, wait, close: () => ctrl.abort() };
}

const as = (who, method, p, body) => H.api(null, method, p, body, { Cookie: who.cookie, 'X-Doca-Password': '' });

before(async () => {
  await H.start();
  alice = await H.signIn('member', 'alice@test.local');
  bob = await H.signIn('member', 'bob@test.local');
  eve = await H.signIn('member', 'eve@test.local');
  viewer = await H.signIn('viewer', 'vic@test.local');
});
after(() => H.stop());

test('a call: its people join, a stranger and a viewer do not, and the room says who is in it', async () => {
  const made = await as(alice, 'POST', '/api/meetings', { now: true, people: [bob.user.id], title: 'Quick sync' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const m = made.body.meeting;
  assert.match(m.id, /^m[0-9a-f]{12}$/);
  assert.equal(m.state, 'open');
  assert.match(m.link, new RegExp(`/meet/${m.id}$`));
  assert.equal((await as(eve, 'GET', `/api/meetings/${m.id}`)).status, 404, 'a stranger is told it is not there');
  assert.equal((await as(viewer, 'GET', `/api/meetings/${m.id}`)).status, 403, 'a viewer cannot chat, so cannot meet');
  assert.equal((await as(bob, 'GET', `/api/meetings/${m.id}`)).status, 200);
  assert.equal((await H.api(null, 'GET', `/api/meetings/${m.id}`, undefined, { Cookie: H.owner.cookie })).status, 404, 'an admin does not barge into a call');

  const pa = await page(alice), pb = await page(bob), pe = await page(eve);
  try {
    const ja = await as(alice, 'POST', `/api/meetings/${m.id}/join`, { screen: pa.screen, media: { audio: true, video: true } });
    assert.equal(ja.status, 200, JSON.stringify(ja.body));
    assert.deepEqual(ja.body.iceServers, [], 'host candidates only by default');
    assert.equal((await as(eve, 'POST', `/api/meetings/${m.id}/join`, { screen: pe.screen })).status, 404);
    assert.equal((await as(bob, 'POST', `/api/meetings/${m.id}/join`, { screen: pa.screen })).status, 409, 'a page acts only through its own stream');
    const jb = await as(bob, 'POST', `/api/meetings/${m.id}/join`, { screen: pb.screen });
    assert.equal(jb.body.room.peers.length, 2);
    assert.ok(await pa.wait(c => c.topic === 'meeting' && c.what === 'joined' && c.peer === pb.screen), 'alice hears bob join');
    assert.equal(pe.heard.filter(c => c.topic === 'meeting' && c.what !== 'ring').length, 0, 'eve hears nothing of the room');

    // Signalling: to one page only.
    const sig = await as(bob, 'POST', `/api/meetings/${m.id}/signal`, { screen: pb.screen, to: pa.screen, data: { description: { type: 'offer', sdp: 'v=0' } } });
    assert.equal(sig.status, 200);
    const got = await pa.wait(c => c.what === 'signal');
    assert.equal(got.from, pb.screen); assert.equal(got.data.description.type, 'offer');
    await H.sleep(150);
    assert.ok(!pb.heard.some(c => c.what === 'signal'), 'the sender does not hear its own offer');
    assert.ok(!pe.heard.some(c => c.what === 'signal'));

    // Chat in the room.
    await as(alice, 'POST', `/api/meetings/${m.id}/say`, { screen: pa.screen, text: 'hello' });
    assert.equal((await pb.wait(c => c.what === 'said')).line.text, 'hello');

    // Leaving, and the last page leaving empties the room.
    await as(bob, 'POST', `/api/meetings/${m.id}/leave`, { screen: pb.screen });
    assert.ok(await pa.wait(c => c.what === 'left' && c.peer === pb.screen));
  } finally { pa.close(); pb.close(); pe.close(); }
  await H.sleep(200);
  assert.equal(require('../modules/meetings/rooms').get(m.id), null, 'a closed page leaves the room');
});

test('a room holds at most meetings.maxPeople pages, and says why', async () => {
  const m = (await as(alice, 'POST', '/api/meetings', { now: true, people: [bob.user.id] })).body.meeting;
  require('../modules/utils').savePrefs({ ...require('../modules/utils').loadPrefs(), meetings: { maxPeople: 2 } });
  const pages = [await page(alice), await page(alice), await page(bob)];
  try {
    assert.equal((await as(alice, 'POST', `/api/meetings/${m.id}/join`, { screen: pages[0].screen })).status, 200);
    assert.equal((await as(alice, 'POST', `/api/meetings/${m.id}/join`, { screen: pages[1].screen })).status, 200);
    const full = await as(bob, 'POST', `/api/meetings/${m.id}/join`, { screen: pages[2].screen });
    assert.equal(full.status, 409); assert.match(full.body.error, /full.*maxPeople/s);
  } finally { pages.forEach(p => p.close()); require('../modules/utils').savePrefs({ ...require('../modules/utils').loadPrefs(), meetings: {} }); }
});

test('an iCalendar invitation is RFC 5545: CRLF, folded, UTC times, SEQUENCE, and a CANCEL for the same UID', () => {
  const ics = require('../modules/meetings/ics');
  const long = `Planning — ${'é'.repeat(80)}`;
  const text = ics.build({ uid: 'm0123456789ab', seq: 2, start: '2026-10-12T13:00:00.000Z', end: '2026-10-12T13:30:00.000Z', title: long,
    description: 'Agenda; one, two', url: 'https://hub.example:4242/meet/m0123456789ab', organizer: { name: 'Alice', email: 'alice@test.local' },
    attendees: [{ name: 'Bob', email: 'bob@test.local' }, { name: 'No mail' }], tz: 'Europe/Rome', now: new Date('2026-10-09T10:00:00Z') });
  assert.ok(text.endsWith('\r\n') && !/[^\r]\n/.test(text), 'every line ends in CRLF');
  for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `folded at 75 octets: ${line}`);
  const unfolded = text.replace(/\r\n /g, '');
  for (const want of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DOCA//Meetings//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT', 'UID:m0123456789ab@doca.local',
    'SEQUENCE:2', 'DTSTAMP:20261009T100000Z', 'DTSTART:20261012T130000Z', 'DTEND:20261012T133000Z', 'STATUS:CONFIRMED',
    'ORGANIZER;CN="Alice":mailto:alice@test.local', 'ATTENDEE;CN="Bob";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:bob@test.local',
    'LOCATION:https://hub.example:4242/meet/m0123456789ab', 'X-WR-TIMEZONE:Europe/Rome', 'TRIGGER:-PT5M', 'END:VEVENT', 'END:VCALENDAR'])
    assert.ok(unfolded.includes(want), `has ${want}`);
  assert.ok(unfolded.includes('Agenda\\; one\\, two'), 'text is escaped');
  assert.ok(unfolded.includes(`SUMMARY:${long}`), 'a folded line unfolds to the whole title, no letter split');
  assert.ok(!unfolded.includes('No mail'), 'a person with no address is not an attendee');
  const cancel = ics.build({ method: 'CANCEL', uid: 'm0123456789ab', seq: 3, start: '2026-10-12T13:00:00Z', end: '2026-10-12T13:30:00Z', title: 'x' }).replace(/\r\n /g, '');
  for (const want of ['METHOD:CANCEL', 'STATUS:CANCELLED', 'SEQUENCE:3', 'UID:m0123456789ab@doca.local']) assert.ok(cancel.includes(want), want);
  assert.ok(!cancel.includes('VALARM'));
});

test('a scheduled meeting goes into each person\'s own calendar: Google for one, Microsoft for another, a notice for the third', async () => {
  const calls = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'DELETE') { res.statusCode = 204; return res.end(); }
      res.end(JSON.stringify({ id: req.url.includes('/me/events') ? 'graph-evt-1' : 'g-evt-1' }));
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${stub.address().port}`;
  process.env.DOCA_GOOGLE_API = base; process.env.DOCA_GRAPH_API = base;
  const cal = require('../modules/meetings/calendars');
  cal._put(alice.user.id, { provider: 'google', accessToken: 'tok-alice', account: 'alice@gmail.example', connectedAt: new Date().toISOString() });
  cal._put(bob.user.id, { provider: 'microsoft', accessToken: 'tok-bob', account: 'bob@outlook.example', connectedAt: new Date().toISOString() });
  try {
    const r = await as(alice, 'POST', '/api/meetings', { title: 'Planning', start: '2026-12-01T15:00:00+01:00', minutes: 45, people: [bob.user.id, eve.user.id], note: 'Q4' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = r.body.meeting;
    assert.equal(m.state, 'scheduled');
    assert.equal(m.startsAt, '2026-12-01T14:00:00.000Z');
    const g = calls.find(c => c.url === '/calendar/v3/calendars/primary/events' && c.method === 'POST');
    assert.ok(g, 'the organizer\'s own Google calendar has it');
    assert.equal(g.auth, 'Bearer tok-alice');
    assert.equal(g.body.summary, 'Planning'); assert.equal(g.body.location, m.link); assert.equal(g.body.start.dateTime, '2026-12-01T14:00:00.000Z');
    const ms = calls.find(c => c.url === '/v1.0/me/events' && c.method === 'POST');
    assert.ok(ms, 'Bob\'s own Microsoft calendar has it');
    assert.equal(ms.auth, 'Bearer tok-bob');
    assert.equal(ms.body.subject, 'Planning'); assert.equal(ms.body.start.dateTime, '2026-12-01T14:00:00.000'); assert.equal(ms.body.start.timeZone, 'UTC');
    assert.equal(ms.body.location.displayName, m.link);
    const people = (await as(alice, 'GET', `/api/meetings/${m.id}`)).body.meeting.people;
    assert.equal(people.find(p => p.personId === bob.user.id).via, 'microsoft');
    assert.equal(people.find(p => p.personId === eve.user.id).via, 'notice', 'no calendar, no mail: a notice with "add to calendar"');
    const notes = require('../modules/notices').list({ id: eve.user.id }, false);
    assert.ok(notes.some(n => /Planning/.test(n.title) && n.text.includes('/invite.ics')), 'eve is told, with the .ics link');

    // Moved: the same events are changed; cancelled: removed.
    calls.length = 0;
    await as(alice, 'PATCH', `/api/meetings/${m.id}`, { start: '2026-12-01T16:00:00+01:00' });
    assert.ok(calls.some(c => c.method === 'PATCH' && c.url.endsWith('/events/g-evt-1')), 'Google event updated');
    assert.ok(calls.some(c => c.method === 'PATCH' && c.url.endsWith('/me/events/graph-evt-1')), 'Graph event updated');
    const ics = await as(eve, 'GET', `/api/meetings/${m.id}/invite.ics`);
    assert.match(ics.body, /SEQUENCE:1/); assert.match(ics.body, /DTSTART:20261201T150000Z/);
    calls.length = 0;
    await as(alice, 'POST', `/api/meetings/${m.id}/cancel`);
    assert.ok(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/events/g-evt-1')));
    assert.ok(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/me/events/graph-evt-1')));
    assert.equal((await as(bob, 'GET', `/api/meetings/${m.id}`)).status, 404);
  } finally { cal._put(alice.user.id, null); cal._put(bob.user.id, null); delete process.env.DOCA_GOOGLE_API; delete process.env.DOCA_GRAPH_API; stub.close(); }
});

test('someone outside the hive gets an iCalendar invitation by mail, through the mail channel\'s SMTP', async () => {
  const got = [];
  const smtp = require('node:net').createServer(sock => {
    let data = false, buf = '';
    sock.write('220 stub\r\n');
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; sock.write('250 queued\r\n'); } else got[got.length - 1].body += `${line}\n`; continue; }
        if (/^EHLO/.test(line)) sock.write('250 stub\r\n');
        else if (/^MAIL FROM/.test(line)) { got.push({ from: line, body: '' }); sock.write('250 ok\r\n'); }
        else if (/^RCPT TO/.test(line)) { got[got.length - 1].to = line; sock.write('250 ok\r\n'); }
        else if (line === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (/^AUTH/.test(line)) sock.write('235 ok\r\n');
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  const utils = require('../modules/utils');
  utils.savePrefs({ ...utils.loadPrefs(), channels: { mail: { imapHost: '127.0.0.1', smtpHost: '127.0.0.1', smtpPort: smtp.address().port, tls: false, user: 'hive@example.org' } } });
  try {
    const r = await as(alice, 'POST', '/api/meetings', { title: 'Vendor call', start: '2026-12-02T09:00:00Z', emails: ['guest@example.com'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const guest = r.body.meeting.people.find(p => p.who === 'mail:guest@example.com');
    assert.equal(guest.via, 'mail', JSON.stringify(guest)); assert.equal(guest.status, 'invited by mail');
    assert.equal(got.length, 1); assert.match(got[0].to, /guest@example.com/);
    assert.match(got[0].body, /Content-Type: text\/calendar; charset=utf-8; method=REQUEST/);
    assert.match(got[0].body, /filename="invite.ics"/);
    const parts = [...got[0].body.matchAll(/Content-Transfer-Encoding: base64\n\n([A-Za-z0-9+/=\n]+?)\n--/g)].map(x => Buffer.from(x[1].replace(/\n/g, ''), 'base64').toString());
    const cal = parts.find(t => t.startsWith('BEGIN:VCALENDAR'));
    assert.ok(cal, 'the calendar is in the mail');
    assert.match(cal, /METHOD:REQUEST/); assert.match(cal, /ATTENDEE;CN="guest"/); assert.match(cal, /DTSTART:20261202T090000Z/);
    await as(alice, 'POST', `/api/meetings/${r.body.meeting.id}/cancel`);
    assert.equal(got.length, 2, 'the cancellation reaches the same address');
    assert.match(got[1].body, /method=CANCEL/);
  } finally { utils.savePrefs({ ...utils.loadPrefs(), channels: {} }); smtp.close(); }
  assert.equal(require('../modules/meetings/invite-mail').ready(), false);
});

test('take control: refused from a plain browser share, only after both consents, and stopped at once when revoked', async () => {
  const devices = require('../modules/api-v1/devices');
  const made = devices.create({ name: 'Alice desk', scopes: ['mcp:self'], caps: {}, kind: 'device' });
  devices.update(made.device.id, { userId: alice.user.id, orgId: alice.orgId });
  const dev = made.device.id;
  const inputs = [];
  const registry = require('../modules/mcp/registry'), dc = require('../modules/devices-control');
  const orig = { forDevice: registry.forDevice, client: registry.client, state: dc.state };
  let lend = false;
  registry.forDevice = id => (id === dev && lend ? { id: 'srv-desk' } : orig.forDevice(id));
  registry.client = id => (id === 'srv-desk' ? { state: 'running', tools: [{ name: 'input_click' }, { name: 'input_move' }, { name: 'input_type' }, { name: 'input_keys' }],
    callTool: async (name, args) => { inputs.push({ name, args }); return 'ok'; } } : orig.client(id));
  dc.state = id => (id === dev && lend ? { ...orig.state(id), usable: ['input', 'screen'] } : orig.state(id));
  const m = (await as(alice, 'POST', '/api/meetings', { now: true, people: [bob.user.id], title: 'Help me' })).body.meeting;
  const pa = await page(alice), pb = await page(bob);
  try {
    await as(alice, 'POST', `/api/meetings/${m.id}/join`, { screen: pa.screen });
    await as(bob, 'POST', `/api/meetings/${m.id}/join`, { screen: pb.screen });
    const noShare = await as(alice, 'POST', `/api/meetings/${m.id}/control/offer`, { screen: pa.screen, to: bob.user.id });
    assert.equal(noShare.status, 409, 'control is of a screen being shared');
    await as(alice, 'POST', `/api/meetings/${m.id}/share`, { screen: pa.screen, on: true, streamId: 's1', width: 1920, height: 1080, surface: 'monitor' });
    assert.ok(await pb.wait(c => c.what === 'shared' && c.sharing?.width === 1920));
    const plain = await as(alice, 'POST', `/api/meetings/${m.id}/control/offer`, { screen: pa.screen, to: bob.user.id });
    assert.equal(plain.status, 403); assert.match(plain.body.error, /plain browser/, 'no DOCA client lending input: pixels only');

    lend = true;
    assert.deepEqual((await as(alice, 'GET', '/api/meetings/devices')).body.devices, [{ id: dev, name: 'Alice desk' }]);
    const asked = await as(bob, 'POST', `/api/meetings/${m.id}/control/request`, { screen: pb.screen, to: pa.screen });
    assert.equal(asked.status, 200);
    assert.ok(await pa.wait(c => c.what === 'control-request' && c.to === pa.screen), 'the sharer is asked');
    assert.equal((await as(bob, 'POST', `/api/meetings/${m.id}/control/offer`, { screen: pb.screen, to: alice.user.id })).status, 409, 'nobody offers what they do not share');

    const off = await as(alice, 'POST', `/api/meetings/${m.id}/control/offer`, { screen: pa.screen, to: bob.user.id, device: dev });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    const grant = off.body.grant.id;
    assert.match(off.body.confirm, /Esc three times/);
    const early = await as(bob, 'POST', `/api/meetings/${m.id}/control/input`, { screen: pb.screen, grant, kind: 'click', fx: 0.5, fy: 0.5 });
    assert.equal(early.status, 403, 'one consent is not enough');
    assert.equal((await as(bob, 'POST', `/api/meetings/${m.id}/control/confirm`, { screen: pb.screen, grant })).status, 404, 'only the sharer confirms');
    assert.equal((await as(alice, 'POST', `/api/meetings/${m.id}/control/confirm`, { screen: pa.screen, grant })).status, 200);
    assert.ok(await pb.wait(c => c.what === 'control' && c.grant.state === 'active'));
    assert.equal(require('../modules/meetings/control').driving(dev), true);

    const click = await as(bob, 'POST', `/api/meetings/${m.id}/control/input`, { screen: pb.screen, grant, kind: 'click', fx: 0.5, fy: 0.25 });
    assert.equal(click.status, 200);
    await as(bob, 'POST', `/api/meetings/${m.id}/control/input`, { screen: pb.screen, grant, kind: 'type', text: 'secret words' });
    await H.sleep(100);
    assert.deepEqual(inputs[0], { name: 'input_click', args: { x: 960, y: 270 } }, 'the share\'s fraction, in the machine\'s pixels');
    assert.equal(inputs[1].name, 'input_type');
    const label = await pa.wait(c => c.what === 'pointer');
    assert.equal(label.by, 'member'); assert.equal(label.fx, 0.5);
    assert.equal((await as(eve, 'POST', `/api/meetings/${m.id}/control/input`, { screen: pb.screen, grant, kind: 'click' })).status, 404, 'a stranger cannot reach the room at all');

    // The agent's own input on that machine waits while a person controls it.
    assert.match(String(require('../modules/meetings/control').driving(dev)), /true/);

    // Revoked by the sharer: the next input is refused, nothing more reaches the machine.
    await as(alice, 'POST', `/api/meetings/${m.id}/control/revoke`, { screen: pa.screen });
    const n = inputs.length;
    assert.equal((await as(bob, 'POST', `/api/meetings/${m.id}/control/input`, { screen: pb.screen, grant, kind: 'click', fx: 0.1, fy: 0.1 })).status, 403);
    await H.sleep(100);
    assert.equal(inputs.length, n);
    assert.equal(require('../modules/meetings/control').driving(dev), false);

    // A new grant ends when the share stops.
    const g2 = (await as(alice, 'POST', `/api/meetings/${m.id}/control/offer`, { screen: pa.screen, to: bob.user.id, device: dev })).body.grant.id;
    await as(alice, 'POST', `/api/meetings/${m.id}/control/confirm`, { screen: pa.screen, grant: g2 });
    await as(alice, 'POST', `/api/meetings/${m.id}/share`, { screen: pa.screen, on: false });
    assert.equal((await as(bob, 'POST', `/api/meetings/${m.id}/control/input`, { screen: pb.screen, grant: g2, kind: 'click', fx: 0.1, fy: 0.1 })).status, 403);

    // Every step was written down: who, whose machine — never what was typed.
    await H.sleep(300);
    const lines = require('../modules/activity').list({ limit: 200 }).filter(l => l.from === 'meetings').map(l => l.what);
    for (const want of [/started sharing/, /asked to control/, /offered member control of Alice desk/, /let member control Alice desk/, /control of Alice desk ended/, /stopped sharing/])
      assert.ok(lines.some(l => want.test(l)), `activity: ${want}`);
    assert.ok(!lines.some(l => l.includes('secret words')), 'what was typed is never written');
    const audit = await require('../modules/auth/store').auditTail(300);
    for (const a of ['meeting.share.start', 'meeting.control.offered', 'meeting.control.granted', 'meeting.control.ended', 'meeting.share.stop'])
      assert.ok(audit.some(e => e.action === a), `audit: ${a}`);
    assert.ok(!JSON.stringify(audit).includes('secret words'));
  } finally {
    pa.close(); pb.close();
    Object.assign(registry, { forDevice: orig.forDevice, client: orig.client }); dc.state = orig.state;
  }
});

test('a level that reaches only what agents create cannot take control of a colleague\'s machine', () => {
  const access = require('../modules/meetings/access');
  const reach = require('../modules/auth/reach');
  const orig = reach.rungOf;
  reach.rungOf = level => (level?.id === 'member' ? 'create' : orig(level));
  try {
    assert.match(access.controlRefusal({ id: 'a', orgId: 'o', role: 'member', name: 'C' }, { id: 'b', orgId: 'o', role: 'admin' }), /reaches only what agents create/);
    assert.match(access.controlRefusal({ id: 'a', orgId: 'o', role: 'member' }, { id: 'b', orgId: 'other', role: 'member' }), /one organisation/);
    assert.equal(access.controlRefusal({ id: 'a', orgId: 'o', role: 'admin' }, { id: 'b', orgId: 'o', role: 'admin' }), null);
  } finally { reach.rungOf = orig; }
});

test('the agent proposes a meeting; nobody is invited until its person confirms', async () => {
  const tools = require('../modules/harness/tools');
  const person = { id: alice.user.id, name: 'alice', orgId: alice.orgId, role: 'member' };
  const out = await tools.call('meeting', { action: 'propose', title: 'Design review', start: '2026-12-03T10:00', people: ['member'] }, [], { user: person });
  assert.match(out, /more than one|not found/, 'two people share a name: the agent is told to say which');
  const said = await tools.call('meeting', { action: 'propose', title: 'Design review', start: '2026-12-03T10:00', people: ['bob@test.local'] }, [], { user: person });
  assert.match(said, /waits for their Confirm/);
  const id = /id (m[0-9a-f]{12})/.exec(said)[1];
  const m = (await as(alice, 'GET', `/api/meetings/${id}`)).body.meeting;
  assert.equal(m.state, 'proposed');
  assert.equal(m.people.find(p => p.role !== 'organizer').status, 'proposed', 'not invited yet');
  assert.ok(!require('../modules/notices').list({ id: bob.user.id }, false).some(n => /Design review/.test(n.title)), 'bob has heard nothing');
  const ok = await as(alice, 'POST', `/api/meetings/${id}/confirm`);
  assert.equal(ok.body.meeting.state, 'scheduled');
  assert.ok(require('../modules/notices').list({ id: bob.user.id }, false).some(n => /Design review/.test(n.title)), 'confirmed: bob is invited');
  assert.ok(require('../modules/agents/registry').NEVER.includes('meeting'), 'a mission does not book its person\'s time');
});

test('five minutes before, its people are reminded once on their pages and devices', async () => {
  const start = new Date(Date.now() + 4 * 60000).toISOString();
  const m = (await as(alice, 'POST', '/api/meetings', { title: 'Standup', start, people: [bob.user.id] })).body.meeting;
  const done = await require('../modules/meetings/remind').tick();
  assert.ok(done.includes(m.id));
  assert.ok(require('../modules/notices').list({ id: bob.user.id }, false).some(n => /In [34] min: Standup/.test(n.title)));
  assert.ok(!(await require('../modules/meetings/remind').tick()).includes(m.id), 'once');
});

test('a device lists its person\'s meetings with their links', async () => {
  const made = require('../modules/api-v1/devices').create({ name: 'Bob phone', scopes: ['harness:chat'], caps: H.PHONE_CAPS, kind: 'device' });
  require('../modules/api-v1/devices').update(made.device.id, { userId: bob.user.id, orgId: bob.orgId });
  const r = await H.api(made.token, 'GET', '/api/v1/meetings');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.meetings.length >= 1);
  for (const m of r.body.meetings) { assert.match(m.link, /\/meet\/m[0-9a-f]{12}$/); assert.ok(Array.isArray(m.people)); }
});

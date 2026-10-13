'use strict';

// Meeting notes (meetings/notes.js; docs/design/meeting-notes.md): asked of everyone; only who says yes is transcribed,
// a "Not me" is final; each person's shorthand written up from the transcript; the record kept for the meeting's people.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

let alice, bob, eve, firstMeeting, stt, sttHeard = 0, sttText = 'We move the launch to the thirtieth.';
async function page(who) {
  const ctrl = new AbortController();
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: who.cookie }, signal: ctrl.signal });
  const reader = res.body.getReader(), dec = new TextDecoder(), heard = [];
  let buf = '', screen = null;
  (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data: ')); buf = buf.slice(i + 2);
      if (line) { const c = JSON.parse(line.slice(6)); if (c.hello) screen = c.screen; else heard.push(c); } } } } catch { /* closed */ } })();
  for (let t = 0; !screen && t < 100; t++) await H.sleep(30);
  const wait = async (pred, ms = 3000) => { for (let t = 0; t < ms; t += 30) { const hit = heard.find(pred); if (hit) return hit; await H.sleep(30); } return null; };
  return { screen, heard, wait, close: () => ctrl.abort() };
}
const as = (who, method, p, body) => H.api(null, method, p, body, { Cookie: who.cookie, 'X-Doca-Password': '' });
const utter = (who, id, screen) => { const fd = new FormData(); fd.append('audio', new Blob([Buffer.alloc(4000, 1)], { type: 'audio/webm' }), 'u.webm'); fd.append('screen', screen);
  return as(who, 'POST', `/api/meetings/${id}/notes/heard`, fd); };

test.before(async () => {
  await H.start();
  alice = await H.signIn('member', 'alice@test.local'); bob = await H.signIn('member', 'bob@test.local'); eve = await H.signIn('member', 'eve@test.local');
  stt = http.createServer((req, res) => { req.resume(); req.on('end', () => { sttHeard++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: sttText })); }); });
  await new Promise(r => stt.listen(0, '127.0.0.1', r));
  const u = require('../modules/utils'); u.savePrefs({ ...u.loadPrefs(), voiceServices: { sttUrl: `http://127.0.0.1:${stt.address().port}`, sttModel: 'stub' } });
});
test.after(async () => { stt.close(); await H.stop(); });

test('asked of everyone; only a yes is transcribed; written up; the record kept for the meeting\'s people', async () => {
  const m = (await as(alice, 'POST', '/api/meetings', { now: true, people: [bob.user.id], title: 'Launch sync' })).body.meeting;
  firstMeeting = m.id;
  const pa = await page(alice), pb = await page(bob);
  await as(alice, 'POST', `/api/meetings/${m.id}/join`, { screen: pa.screen });
  await as(bob, 'POST', `/api/meetings/${m.id}/join`, { screen: pb.screen });

  const s = await as(alice, 'POST', `/api/meetings/${m.id}/notes/start`, { screen: pa.screen });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.consent, 'yes', 'who starts agrees for themselves');
  assert.ok(await pb.wait(c => c.topic === 'meeting' && c.what === 'notes' && c.on), 'Bob\'s page is asked');
  assert.equal((await as(eve, 'POST', `/api/meetings/${m.id}/notes/consent`, { answer: 'yes' })).status, 404, 'a stranger has no say');

  // Bob says Not me: nothing of his is transcribed, and his no stays a no.
  assert.equal((await as(bob, 'POST', `/api/meetings/${m.id}/notes/consent`, { answer: 'no' })).body.consent, 'no');
  const before = sttHeard;
  assert.equal((await utter(bob, m.id, pb.screen)).status, 403);
  assert.equal(sttHeard, before, 'his audio never reached the transcriber');
  assert.equal((await as(bob, 'POST', `/api/meetings/${m.id}/notes/consent`, { answer: 'yes' })).body.consent, 'no', 'a no is final for this meeting');

  // Alice is heard, under her name.
  const h = await utter(alice, m.id, pa.screen);
  assert.equal(h.status, 200, JSON.stringify(h.body));
  assert.equal(h.body.line.name, 'member');
  assert.ok(await pb.wait(c => c.what === 'notes-line'), 'the line reaches the room');
  assert.equal((await as(alice, 'POST', `/api/meetings/${m.id}/notes/stop`, { screen: pa.screen })).status, 200);
  assert.equal((await as(alice, 'POST', `/api/meetings/${m.id}/notes/start`, { screen: pa.screen })).body.on, true, 'started again');
  assert.equal((await as(bob, 'POST', `/api/meetings/${m.id}/notes/stop`, { screen: pb.screen })).status, 403, 'stopped by who started them');

  // Shorthand written up from the transcript by the person's model.
  const transport = require('../modules/harness/turn/transport'), ask = transport.ask;
  let asked = null;
  transport.ask = async a => { asked = a; return '1. The launch moves to the thirtieth.'; };
  try {
    await as(alice, 'POST', `/api/meetings/${m.id}/notes/mine`, { text: 'launch → 30th?' });
    const w = await as(alice, 'POST', `/api/meetings/${m.id}/notes/write`, {});
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.deepEqual(w.body.written, [{ line: 'launch → 30th?', text: 'The launch moves to the thirtieth.', written: true }]);
    assert.match(asked.user, /We move the launch to the thirtieth/);
    assert.equal(asked.person.id, alice.user.id, 'the person\'s own model');
  } finally { transport.ask = ask; }

  await as(alice, 'POST', `/api/meetings/${m.id}/say`, { screen: pa.screen, text: 'Agreed.' });
  await as(alice, 'POST', `/api/meetings/${m.id}/end`, {});
  for (let t = 0; t < 50 && (await as(alice, 'GET', `/api/meetings/${m.id}/notes/record`)).status !== 200; t++) await H.sleep(50);
  const rec = await as(alice, 'GET', `/api/meetings/${m.id}/notes/record`);
  assert.equal(rec.status, 200, JSON.stringify(rec.body));
  assert.match(rec.body.markdown, /# Launch sync — notes/);
  assert.match(rec.body.markdown, /1 agreed to be noted; nobody else was transcribed/);
  assert.match(rec.body.markdown, /We move the launch to the thirtieth/);
  assert.match(rec.body.markdown, /Written up from the transcript \(by the model\)/);
  assert.match(rec.body.markdown, /Agreed\./, 'the chat is kept with it');
  assert.equal((await as(eve, 'GET', `/api/meetings/${m.id}/notes/record`)).status, 404, 'only its people read it');
  pa.close(); pb.close();
});

test('a question said aloud is answered on the asker\'s page alone, from their earlier meetings\' notes', async () => {
  const m = (await as(alice, 'POST', '/api/meetings', { now: true, people: [bob.user.id], title: 'Follow-up' })).body.meeting;
  const pa = await page(alice), pb = await page(bob);
  await as(alice, 'POST', `/api/meetings/${m.id}/join`, { screen: pa.screen });
  await as(bob, 'POST', `/api/meetings/${m.id}/join`, { screen: pb.screen });
  await as(alice, 'POST', `/api/meetings/${m.id}/notes/start`, { screen: pa.screen });
  sttText = 'When is the launch now?';
  assert.equal((await utter(alice, m.id, pa.screen)).status, 200);
  const got = await pa.wait(c => c.what === 'notes-answer', 4000);
  assert.ok(got, 'Alice is answered');
  assert.equal(got.card.question, 'When is the launch now?');
  assert.ok(got.card.sources.some(x => x.kind === 'meeting' && x.title === 'Launch sync' && /launch to the thirtieth/.test(x.text)), JSON.stringify(got.card));
  await H.sleep(300);
  assert.ok(!pb.heard.some(c => c.what === 'notes-answer'), 'Bob\'s page hears nothing of it');
  const q = require('../modules/meetings/notes-answers');
  assert.ok(q.isQuestion('Dove facciamo la cena?') && q.isQuestion('Wann ist der Termin') && !q.isQuestion('We move the launch.'));
  pa.close(); pb.close();
});

test('the agent\'s recall finds and reads the notes of the person\'s meetings, and no one else\'s', async () => {
  const tools = require('../modules/harness/tools');
  const found = await tools.call('recall_conversations', { query: 'launch thirtieth' }, [], { user: { id: alice.user.id, role: 'member' } });
  assert.match(found, /Meetings' notes:[\s\S]*Launch sync — id m[0-9a-f]{12}/);
  const read = await tools.call('recall_conversations', { action: 'read', id: firstMeeting }, [], { user: { id: alice.user.id, role: 'member' } });
  assert.match(read, /# Launch sync — notes/);
  const eveRead = await tools.call('recall_conversations', { action: 'read', id: firstMeeting }, [], { user: { id: eve.user.id, role: 'member' } });
  assert.match(eveRead, /no meeting .* of this person's/);
});

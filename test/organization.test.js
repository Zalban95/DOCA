'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const memory = require('../modules/harness/memory');
const org = require('../modules/harness/organization');
const tools = require('../modules/harness/tools');
const agent = require('../modules/harness/agent');
before(() => H.start());
after(() => H.stop());

test('reports travel up all levels, survive reads and acknowledge only the shown snapshot', () => {
  const main = memory.mainSession(), work = org.create({ title: 'Build' });
  const specialist = memory.createSession('Check', { activate: false, kind: 'specialist', parentId: work.id,
    profile: { id: 'check', tools: ['memory_search'] } });
  const first = org.report(specialist.id, 'user intervention', 'Use the revised scope', 'owner');
  assert.ok(org.notices(work.id).some(n => n.id === first.id));
  assert.ok(org.notices(main.id).some(n => n.id === first.id));
  const shown = org.notices(work.id);
  const second = org.report(specialist.id, 'turn completed', 'Verified scope');
  org.acknowledge(work.id, shown);
  assert.deepEqual(org.notices(work.id).map(n => n.id), [second.id]);
  assert.ok(org.notices(main.id).some(n => n.id === first.id), 'each superior acknowledges independently');
});

test('only the Orchestrator creates leaders and specialists cannot delegate through the generic tool', async () => {
  const main = memory.mainSession(), work = org.create({ title: 'Team' });
  const specialist = memory.createSession('Narrow', { kind: 'specialist', parentId: work.id });
  await assert.rejects(org.tool({ action: 'create' }, { sessionId: work.id }), /Only the Orchestrator/);
  await assert.rejects(org.tool({ action: 'send', sessionId: main.id, message: 'Do more' }, { sessionId: specialist.id }), /outside.*reporting line/);
  await assert.rejects(org.tool({ action: 'send', sessionId: specialist.id, message: 'again' }, { sessionId: specialist.id }), /cannot delegate/);
  assert.match(await tools.call('work_plan', { action: 'draft', sessionId: main.id, title: 'Override', steps: ['x'] }, [],
    { sessionId: specialist.id }), /only your own plan/);
});

test('a conversation reads only what it manages, and the inventory is the same line', async () => {
  const main = memory.mainSession();
  const leader = org.create({ title: 'Alpha leader' });
  const other = org.create({ title: 'Beta leader' });
  const mine = memory.createSession('Mine', { activate: false, kind: 'specialist', parentId: leader.id });
  const theirs = memory.createSession('Theirs', { activate: false, kind: 'specialist', parentId: other.id });
  memory.updateSession(other.id, { brief: 'SECRET_BRIEF_OF_ANOTHER_BRANCH' });
  memory.append(theirs.id, { role: 'user', content: 'PRIVATE_OTHER_BRANCH_TRANSCRIPT' });
  memory.append(mine.id, { role: 'user', content: 'the errand' });

  // The specialist held `work_chats` and `list` handed it the Orchestrator's id,
  // so a transcript came back with no check at all.
  await assert.rejects(org.tool({ action: 'read', sessionId: main.id, transcript: true }, { sessionId: mine.id }),
    /outside.*reporting line/);
  await assert.rejects(org.tool({ action: 'read', sessionId: theirs.id, transcript: true }, { sessionId: mine.id }),
    /outside.*reporting line/);
  await assert.rejects(org.tool({ action: 'read', sessionId: other.id }, { sessionId: leader.id }),
    /outside.*reporting line/, 'a leader does not read a sibling branch');

  // A leader still reads its own line in full, which is what the tool is for.
  const own = await org.tool({ action: 'read', sessionId: mine.id, transcript: true }, { sessionId: leader.id });
  assert.equal(own.id, mine.id);
  assert.equal(own.messages.length, 1);
  const self = await org.tool({ action: 'read', transcript: true }, { sessionId: mine.id });
  assert.equal(self.id, mine.id, 'and a conversation always reads itself');

  const asSpecialist = await org.tool({ action: 'list', limit: 100 }, { sessionId: mine.id });
  assert.deepEqual(asSpecialist.sessions.map(s => s.id), [mine.id], 'a specialist sees itself');
  assert.doesNotMatch(JSON.stringify(asSpecialist), /SECRET_BRIEF_OF_ANOTHER_BRANCH|PRIVATE_OTHER_BRANCH_TRANSCRIPT/);

  const asLeader = await org.tool({ action: 'list', limit: 100 }, { sessionId: leader.id });
  assert.deepEqual(asLeader.sessions.map(s => s.id).sort(), [leader.id, mine.id].sort(), 'a leader sees its own line');

  const asMain = await org.tool({ action: 'list', limit: 100 }, { sessionId: main.id });
  assert.equal(asMain.sessions.length, org.list({ limit: 100 }).sessions.length,
    'the Orchestrator still sees everything');
  assert.equal(asMain.main, main.id, 'and every level is still told which conversation is the Orchestrator');
});

test('reports stay bounded: read history is trimmed, unread is never', () => {
  const main = memory.mainSession(), work = org.create({ title: 'Noisy' });
  const read = [], at = new Date().toISOString();
  for (let i = 0; i < 80; i++) read.push({ id: 'r' + i, from: work.id, type: 'report', text: 't' + i, at, readAt: at });
  // `legacy` is what an index written before this existed holds: a report that
  // was never marked read, because nothing marked reads when it was written.
  const legacy = { id: 'legacy', from: work.id, type: 'report', text: 'old', at };
  const unread = { id: 'unread', from: work.id, type: 'report', text: 'waiting', at };
  memory.updateSession(main.id, { reports: [legacy, unread, ...read] });

  const note = org.report(work.id, 'report', 'another');

  const after = memory.getSession(main.id).reports;
  assert.equal(after.filter(n => n.readAt).length, 50, 'the read history is bounded');
  assert.deepEqual(after.filter(n => !n.readAt).map(n => n.id), ['legacy', 'unread', note.id],
    'nothing that is still waiting to be read is dropped, and the order is preserved');
  assert.ok(after.some(n => n.id === 'r79') && !after.some(n => n.id === 'r0'),
    'it is the old read reports that go, not the recent ones');
});

test('acknowledging bounds the array too, and keeps the most recent', () => {
  const work = org.create({ title: 'Ack' }), at = new Date().toISOString();
  memory.updateSession(work.id, { reports: Array.from({ length: 85 }, (_, i) =>
    ({ id: 'a' + i, from: work.id, type: 'report', text: 't' + i, at })) });
  org.acknowledge(work.id, org.notices(work.id));
  const after = memory.getSession(work.id).reports;
  assert.equal(after.length, 50);
  assert.deepEqual(after.map(n => n.id), Array.from({ length: 50 }, (_, i) => 'a' + (i + 35)));
  assert.equal(org.notices(work.id).length, 0, 'and acknowledging still clears the unread count');
});

test('one report is one index write, however many superiors it reaches', t => {
  const docs = require('../modules/db/docs');   // where the index is written since 2.111.0
  const work = org.create({ title: 'Fan-out' });
  const specialist = memory.createSession('Deep', { kind: 'specialist', parentId: work.id });
  const real = docs.setDoc, writes = [];
  docs.setDoc = (key, doc) => { if (key === 'harness/sessions') writes.push(JSON.parse(JSON.stringify(doc))); return real(key, doc); };
  t.after(() => { docs.setDoc = real; });

  const note = org.report(specialist.id, 'report', 'two superiors above me');

  assert.equal(writes.length, 1, 'one read-modify-write for the whole fan-out');
  for (const id of [work.id, memory.mainSession().id])
    assert.ok(writes[0].sessions.find(s => s.id === id).reports.some(n => n.id === note.id),
      'and every superior still gets it');
});

test('plan decisions require a user and the revision actually reviewed', async () => {
  const work = org.create({ title: 'Plan' });
  const draft = org.plan(work.id, { action: 'draft', title: 'Release', steps: ['Verify', 'Publish'] });
  assert.equal(draft.revision, 1);
  org.plan(work.id, { action: 'propose' });
  assert.throws(() => org.plan(work.id, { action: 'approve', revision: 1 }), /Only the user/);
  const url = `/api/harness/sessions/${work.id}/plan`;
  assert.equal((await H.api(null, 'POST', url, { action: 'approve', revision: 1 }, { 'Sec-Fetch-Site': '' })).status, 403);
  const headers = { 'Sec-Fetch-Site': 'same-origin' };
  assert.equal((await H.api(null, 'POST', url, { action: 'approve', revision: 1 }, headers)).body.plan.state, 'approved');
  assert.equal(agent.isRunning(work.id), false, 'approval never starts execution');
  org.plan(work.id, { action: 'progress', step: 1, state: 'done' });
  assert.equal(org.plan(work.id).state, 'approved', 'progress preserves the approved scope');
  assert.equal(org.plan(work.id).progress[1], 'done');
  org.plan(work.id, { action: 'draft', title: 'Changed release', steps: ['Check again'] });
  org.plan(work.id, { action: 'propose' });
  assert.equal((await H.api(null, 'POST', url, { action: 'approve', revision: 1 }, headers)).status, 409);
  assert.equal(org.plan(work.id).state, 'proposed');
});

test('archive and recall preserve transcript, plans and specialist permissions', () => {
  const work = org.create({ title: 'Keep this' });
  const profile = { id: 'archivist', label: 'Archivist', tools: ['memory_search'], memory: false };
  const specialist = memory.createSession('Read', { kind: 'specialist', parentId: work.id, profile });
  memory.append(specialist.id, { role: 'assistant', content: 'Evidence retained' });
  org.plan(specialist.id, { action: 'draft', title: 'Check', steps: ['Find evidence'] });
  org.archive(specialist.id);
  assert.ok(!org.list({ limit: 100 }).sessions.some(s => s.id === specialist.id));
  assert.ok(org.list({ all: true, limit: 100 }).sessions.some(s => s.id === specialist.id));
  org.archive(specialist.id, false);
  assert.equal(memory.messages(specialist.id)[0].content, 'Evidence retained');
  assert.deepEqual(org.profileFor(org.session(specialist.id)), profile);
  assert.equal(org.plan(specialist.id).title, 'Check');
  assert.throws(() => org.archive(memory.mainSession().id), /Orchestrator stays available/);
});

test('resetting main retains ownership and unread reports; an old main is not restored as a second one', () => {
  const old = memory.mainSession(), work = org.create({ title: 'Still owned' });
  const notice = org.report(work.id, 'report', 'Waiting on a decision');
  const next = memory.resetMain();
  assert.equal(org.session(work.id).parentId, next.id);
  assert.ok(org.notices(next.id).some(n => n.id === notice.id));
  // Deep test B, C9: it came back as a work chat named "Orchestrator". It stays put away, as what it was, and says why.
  assert.throws(() => org.archive(old.id, false), /earlier Orchestrator\. There is one Orchestrator at a time.*Show archived chats/);
  assert.equal(org.session(old.id).kind, 'orchestrator');
  assert.ok(memory.getSession(old.id).archivedAt);
  assert.equal(memory.mainSession().id, next.id);
});

test('old records get reporting parents and interrupted work reads as paused', () => {
  const s = memory.createSession('Legacy');
  memory.updateSession(s.id, { kind: undefined, state: 'running' });
  const row = org.session(s.id);
  assert.equal(row.kind, 'work');
  assert.equal(row.parentId, memory.mainSession().id);
  assert.equal(row.state, 'paused');
  const missing = memory.createSession('Missing profile', { kind: 'specialist' });
  assert.deepEqual(org.profileFor(org.session(missing.id)).tools, [], 'a lost specialist profile cannot grant general tools');
});

test('leaders can wait for their specialist without tying up the Orchestrator', async t => {
  const missions = require('../modules/agents/missions');
  const store = require('../modules/store');
  const old = store.readJson('agents/missions', { missions: [] });
  t.after(() => store.writeJson('agents/missions', old));
  const work = org.create({ title: 'Waiting leader' });
  const s = memory.createSession('Worker', { kind: 'specialist', parentId: work.id });
  store.writeJson('agents/missions', { missions: [{ id: 'msn_wait', sessionId: s.id, by: work.id, state: 'running', steps: 1 }] });
  const waiting = tools.call('agent_results', { mission: 'msn_wait', wait: true }, [], { sessionId: work.id });
  assert.match(await tools.call('agent_results', { mission: 'msn_wait', wait: true }, [],
    { sessionId: memory.mainSession().id }), /Orchestrator should remain available/);
  missions.patch('msn_wait', { state: 'done', result: 'Verified result' });
  assert.match(await waiting, /Verified result/);
  missions.patch('msn_wait', { state: 'running' });
  const ctrl = new AbortController();
  const cancelled = tools.call('agent_results', { mission: 'msn_wait', wait: true }, [], { sessionId: work.id, signal: ctrl.signal });
  ctrl.abort();
  assert.match(await cancelled, /abort/i);
});

test('the main prompt stays bounded while all conversations remain addressable', () => {
  const main = memory.mainSession();
  for (let i = 0; i < 35; i++) {
    const s = org.create({ title: 'Project ' + i });
    memory.append(s.id, { role: 'user', content: 'PRIVATE_FULL_TRANSCRIPT_' + i });
    memory.updateSession(s.id, { brief: 'x'.repeat(2000) });
  }
  const block = org.block(main.id, org.notices(main.id).slice(0, 10));
  assert.ok(block.length < 7500);
  assert.doesNotMatch(block, /PRIVATE_FULL_TRANSCRIPT/);
  const a = org.list({ limit: 10 }), b = org.list({ offset: 10, limit: 10 });
  assert.equal(a.sessions.length, 10);
  assert.ok(a.total > 35);
  assert.ok(!a.sessions.some(s => b.sessions.some(t => s.id === t.id)));
});

test('a mission is its dispatcher\'s and its superiors\': a sibling leader cannot read or resume it (H-17)', async t => {
  const store = require('../modules/store');
  const old = store.readJson('agents/missions', { missions: [] });
  t.after(() => store.writeJson('agents/missions', old));
  const mine = org.create({ title: 'Owner leader' }), other = org.create({ title: 'Sibling leader' });
  const s = memory.createSession('Specialist', { kind: 'specialist', parentId: mine.id });
  store.writeJson('agents/missions', { missions: [
    { id: 'msn_own', sessionId: s.id, by: mine.id, state: 'done', steps: 2, label: 'Own', result: 'The secret result' },
    { id: 'msn_paused', sessionId: s.id, by: mine.id, state: 'paused', steps: 1, label: 'Paused' },
  ] });
  assert.match(await tools.call('agent_results', { mission: 'msn_own' }, [], { sessionId: mine.id }), /The secret result/);
  assert.match(await tools.call('agent_results', { mission: 'msn_own' }, [], { sessionId: memory.mainSession().id }), /The secret result/, 'the Orchestrator is above it');
  const refused = await tools.call('agent_results', { mission: 'msn_own' }, [], { sessionId: other.id });
  assert.match(refused, /outside your reporting line/);
  assert.doesNotMatch(refused, /secret/);
  assert.doesNotMatch(await tools.call('agent_results', {}, [], { sessionId: other.id }), /msn_own/, 'nor listed to it');
  assert.match(await tools.call('agent_resume', { mission: 'msn_paused', continue: false }, [], { sessionId: other.id }), /outside your reporting line/);
  assert.equal(store.readJson('agents/missions').missions.find(m => m.id === 'msn_paused').state, 'paused', 'untouched');
});

test('a proposed plan is put in front of the person as a document, and only they can decide it', async () => {
  const work = org.create({ title: 'Plan me' });
  await tools.call('work_plan', { action: 'draft', title: 'Move the box', steps: ['Lift', 'Carry', 'Drop'], note: 'Gently.' }, [],
    { sessionId: work.id });
  const shown = [];
  const result = JSON.parse(await tools.call('work_plan', { action: 'propose' }, [], { sessionId: work.id, show: m => shown.push(m) }));
  assert.equal(result.state, 'proposed');
  assert.match(result.shown, /Do not start the work until they approve/, 'the agent is told to wait, not to carry on');

  assert.equal(shown.length, 1);
  const [doc] = shown;
  assert.equal(doc.kind, 'doc', 'the road every client already knows: a window on the panel, a choice on a phone, nothing on a watch');
  assert.deepEqual({ sessionId: doc.plan.sessionId, revision: doc.plan.revision }, { sessionId: work.id, revision: 1 });
  assert.match(doc.caption, /Move the box.*revision 1.*waiting for your decision/);
  const text = require('node:fs').readFileSync(require('../modules/attachments').resolve(doc.name)[0].path, 'utf8');
  assert.match(text, /^# Move the box\n[\s\S]*1\. Lift\n2\. Carry\n3\. Drop\n[\s\S]*## Notes\n\nGently\./);
  assert.match(text, /Approving starts the work/);

  // The agent cannot decide it; the window's buttons can.
  assert.throws(() => org.plan(work.id, { action: 'approve', revision: 1 }), /Only the user/);
  const r = await H.api(null, 'POST', `/api/harness/sessions/${work.id}/plan`, { action: 'approve', revision: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.plan.state, 'approved');
  // Approve is the go-ahead (2026-10-04): the work starts in the conversation that proposed it.
  assert.deepEqual(r.body.started, { started: true });
  assert.equal(memory.getSession(work.id).job.state, 'working', 'a work chat gets a fresh job');
  await new Promise(res => setTimeout(res, 50));
  assert.ok(['failed', 'running', 'idle'].includes(memory.getSession(work.id).state), 'a turn was started (no model here, so it fails fast)');
  const again = await H.api(null, 'POST', `/api/harness/sessions/${work.id}/plan`, { action: 'reject', revision: 1 });
  assert.match(again.body.error, /changed/, 'a stale window gets a sentence, not a second decision');

  // Draft and progress show nothing: only a proposal asks a person anything.
  const quiet = [];
  await tools.call('work_plan', { action: 'progress', step: 1, state: 'done' }, [], { sessionId: work.id, show: m => quiet.push(m) });
  assert.equal(quiet.length, 0);
});

test('approving does not interrupt a conversation busy with its own turn: the approval waits in its inbox', () => {
  const work = org.create({ title: 'Busy' });
  const { running } = require('../modules/harness/turn/lifecycle');
  const inbox = require('../modules/harness/inbox');
  running.set(work.id, new AbortController());
  try {
    const r = org.carryOut(work.id, { revision: 1, title: 'X' }, { name: 'Dashboard console', kind: 'dashboard' });
    assert.equal(r.started, false);
    assert.equal(r.queued, true);
    assert.match(inbox.waiting(work.id)[0].message, /Approved revision 1/);
  } finally { running.delete(work.id); inbox.take(work.id); }
});

test('finished means every contract in the plan holds: a step is held to its check before it is done (V10)', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const work = org.create({ title: 'A site with a model' });
  const page = path.join(H.tmp, 'site', 'index.html');
  await tools.call('work_plan', { action: 'draft', title: 'Website with the Blender model', steps: ['Make the model', 'Build the page', 'Tidy up'],
    contracts: [{ done: 'the .glb is in the site folder' }, { done: 'the page shows the model', check: { file: page, contains: '<model-viewer' } }, {}] }, [],
    { sessionId: work.id });
  let p = org.plan(work.id, { action: 'read' });
  assert.deepEqual(p.steps, ['Make the model', 'Build the page', 'Tidy up'], 'steps stay sentences: every reader keeps working');
  assert.equal(p.contracts[1].done, 'the page shows the model');
  assert.equal(p.contracts[2], null);
  assert.match(require('../modules/harness/plan-doc').render(p), /2\. Build the page\n {3}\*Done when\* the page shows the model/, 'the document the person approves shows each contract');

  const step = (n, state = 'done') => tools.call('work_plan', { action: 'progress', step: n, state }, [], { sessionId: work.id });
  await step(1);
  const refused = JSON.parse(await step(2));
  assert.equal(refused.done, false);
  assert.match(refused.check, /index\.html is not there/);
  assert.notEqual(org.plan(work.id, { action: 'read' }).progress[2], 'done', 'held open');

  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, '<model-viewer src="chair.glb"></model-viewer>');
  await step(2);
  assert.equal(org.plan(work.id, { action: 'read' }).fulfilledAt, null, 'not until every step');
  await step(3);
  p = org.plan(work.id, { action: 'read' });
  assert.ok(p.fulfilledAt, 'fulfilled: every contract holds');
  await step(3, 'running');
  assert.equal(org.plan(work.id, { action: 'read' }).fulfilledAt, null, 'a step reopened: no longer fulfilled');
  await assert.rejects(async () => { org.plan(work.id, { action: 'draft', title: 'x', steps: ['a'], contracts: [{ check: { url: 'https://example.com' } }] }); }, /owner's own addresses/);
});

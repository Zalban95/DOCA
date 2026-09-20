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

test('resetting main retains ownership and unread reports; recalled old main is a work chat', () => {
  const old = memory.mainSession(), work = org.create({ title: 'Still owned' });
  const notice = org.report(work.id, 'report', 'Waiting on a decision');
  const next = memory.resetMain();
  assert.equal(org.session(work.id).parentId, next.id);
  assert.ok(org.notices(next.id).some(n => n.id === notice.id));
  org.archive(old.id, false);
  assert.equal(org.session(old.id).kind, 'work');
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

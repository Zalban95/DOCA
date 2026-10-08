'use strict';

/**
 * Work chats reach the devices as missions, so a watch shows what is actually
 * running — and a work chat a restart cut off is told to them as stopped rather
 * than left "running" on a wrist until the event expires. Found 2026-09-25.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H        = require('./helpers');
const memory   = require('../modules/harness/memory');
const workview = require('../modules/harness/workview');
const bus      = require('../modules/api-v1/bus');

test.before(() => H.start());
test.after(() => H.stop());

const watch = H.mkDevice('Wrist', 'watch', H.WATCH_CAPS);
const lastMission = id => [...bus.drain(watch.device.id, 0).events || []].reverse()
  .find(e => e.type === 'agent.mission' && e.payload.missionId === id)?.payload;

test('a work chat is published in the shape a device already draws, state by state', () => {
  const s = memory.createSession('Laya MCP server', { activate: false, kind: 'work', parentId: memory.mainSession().id });
  const map = st => workview.payloadOf({ ...s, state: st, brief: 'It works.', lastError: 'boom' });
  assert.equal(map('running').state, 'running');
  assert.equal(map('running').endedAt, undefined);
  assert.deepEqual([map('idle').state, map('idle').result], ['done', 'It works.']);
  assert.deepEqual([map('failed').state, map('failed').error], ['failed', 'boom']);
  assert.equal(map('cancelled').state, 'cancelled');
  assert.deepEqual([map('paused').state, map('paused').error], ['paused', workview.RESTARTED], 'paused by a restart, not failed (deep test A)');
  assert.equal(map('idle').agentId, 'work');
  assert.equal(map('idle').label, 'Laya MCP server');
});

test('GET /harness/missions lists work chats beside specialists, newest first', async () => {
  const s = memory.createSession('Eye-of-god capture', { activate: false, kind: 'work', parentId: memory.mainSession().id });
  memory.updateSession(s.id, { state: 'idle', brief: 'Frame delivered.' });
  const r = await H.api(watch.token, 'GET', '/api/v1/harness/missions');
  assert.equal(r.status, 200);
  const row = r.body.missions.find(m => m.missionId === s.id);
  assert.ok(row, 'the work chat is listed');
  assert.equal(row.state, 'done');
  assert.equal(r.body.enabled, true, 'something to show, so not "switched off"');
});

test('a turn in a work chat is announced when it starts and when it ends', async () => {
  const lifecycle = require('../modules/harness/turn/lifecycle');
  const s = memory.createSession('Probe', { activate: false, kind: 'work', parentId: memory.mainSession().id });
  memory.updateSession(s.id, { state: 'running' });
  lifecycle.running.set(s.id, new AbortController());
  lifecycle.changed(s.id);
  assert.equal(lastMission(s.id)?.state, 'running');
  lifecycle.running.delete(s.id);
  memory.updateSession(s.id, { state: 'idle', brief: 'lantern' });
  lifecycle.changed(s.id);
  assert.deepEqual([lastMission(s.id).state, lastMission(s.id).result], ['done', 'lantern']);
});

test('after a restart, a work chat left "running" is told to the devices as paused, not failed', () => {
  const s = memory.createSession('Cut off', { activate: false, kind: 'work', parentId: memory.mainSession().id });
  memory.updateSession(s.id, { state: 'running' });   // stored as running, but nothing runs it: a restart
  assert.ok(workview.recover().includes(s.id));
  const p = lastMission(s.id);
  assert.equal(p.state, 'paused');
  assert.equal(p.error, workview.RESTARTED);
});

test('the orchestrator itself and specialists are not duplicated as work chats', () => {
  const ids = workview.workChats().map(s => s.id);
  assert.equal(ids.includes(memory.mainSession().id), false);
});

test('a stopped or dropped work chat is cancelled, not done; archiving one is quiet and carries archivedAt (audit 2026-10-06)', () => {
  const s = memory.createSession('Stopped job', { activate: false, kind: 'work', parentId: memory.mainSession().id });
  const at = st => workview.payloadOf({ ...memory.getSession(s.id), state: 'idle', job: { state: st, stoppedWhy: 'Stopped from the missions bar' } });
  assert.equal(at('stopped').state, 'cancelled');
  assert.match(at('stopped').error, /missions bar.*restart it or drop it/);
  assert.equal(at('dropped').state, 'cancelled');
  assert.equal(at('working').state, 'done');

  memory.updateSession(s.id, { state: 'idle' });
  require('../modules/harness/organization').archive(s.id, true);
  const p = lastMission(s.id);
  assert.equal(p.quiet, true);
  assert.ok(p.archivedAt);
});

test('every field an agent.mission carries is in the OpenAPI event schema', () => {
  const doc = require('../modules/api-v1/openapi').document();
  const find = o => (o && typeof o === 'object' ? (o['agent.mission'] || Object.values(o).map(find).find(Boolean)) : null);
  const schema = find(doc);
  const props = Object.keys(schema.payload?.properties || schema.properties || {});
  assert.ok(props.length > 5, 'found the schema');
  const ids = [];
  for (const e of bus.drain(watch.device.id, 0).events || []) if (e.type === 'agent.mission') ids.push(...Object.keys(e.payload));
  const work = workview.payloadOf({ id: 'x', title: 't', state: 'idle', createdAt: '', updatedAt: '', archivedAt: 'z', job: { state: 'stopped' } });
  const missing = [...new Set([...ids, ...Object.keys(work), 'plan', 'progress', 'archivedAt', 'quiet'])].filter(k => !props.includes(k));
  assert.deepEqual(missing, []);
});

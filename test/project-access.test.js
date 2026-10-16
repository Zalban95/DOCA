'use strict';

/**
 * Whose project (projects/access.js; owner, 2026-10-16): a project belongs to whoever made it, one made before owners
 * is the hub's, its owner shares it to see or to work on, a host sees and manages every one, and everyone else gets
 * 404 for what is not theirs — in the panel's routes, the agent's tools and a conversation's place.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H = require('./helpers');
const projects = require('../modules/projects/store');

test.before(() => H.start());
test.after(() => H.stop());

const as = (who, method, p, body) => H.api(null, method, p, body, { Cookie: who.cookie, 'X-Doca-Password': who.password });

test('a member sees only their own and what is shared with them; sharing is recorded with who and when', async () => {
  const root = fs.mkdtempSync(path.join(H.tmp, 'shared-'));
  const made = await H.api(null, 'POST', '/api/projects', { root });
  const id = made.body.project.id;
  assert.equal(made.body.project.owner.id, H.owner.user.id, 'its maker owns it');
  const old = { id: 'prj_0123456789', name: 'old', root: fs.mkdtempSync(path.join(H.tmp, 'old-')), sessionId: null, commands: {}, createdAt: new Date().toISOString() };
  require('../modules/store').writeJson('projects/projects', { projects: [...projects.list(), old] });   // made before owners

  const member = await H.signIn('member');
  let r = await as(member, 'GET', '/api/projects');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.projects.map(p => p.id), []);
  assert.equal((await as(member, 'GET', `/api/projects/${id}`)).status, 404);
  assert.equal((await as(member, 'GET', `/api/projects/${id}/chats`)).status, 404);
  assert.equal((await as(member, 'GET', `/api/projects/${old.id}`)).status, 404, 'a project with no owner is the hub\'s');
  assert.ok((await H.api(null, 'GET', '/api/projects')).body.projects.some(p => p.id === old.id), 'a host sees it');

  r = await H.api(null, 'POST', `/api/projects/${id}/sharing`, { personId: member.user.id, right: 'see' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await as(member, 'GET', '/api/projects');
  assert.deepEqual(r.body.projects.map(p => [p.id, p.yours]), [[id, 'see']]);
  assert.equal((await as(member, 'GET', `/api/projects/${id}/chats`)).status, 200);
  r = await as(member, 'POST', `/api/projects/${id}/chat`);
  assert.equal(r.status, 403, 'see is not work');
  assert.equal((await as(member, 'POST', `/api/projects/${id}/sharing`, { personId: H.owner.user.id, right: 'work' })).status, 403, 'only its owner or a host shares it');
  assert.equal((await as(member, 'GET', `/api/projects/${id}/git/status`)).status, 403, 'its git stays the machine\'s');

  await H.api(null, 'POST', `/api/projects/${id}/sharing`, { personId: member.user.id, right: 'work' });
  const chat = await as(member, 'POST', `/api/projects/${id}/chat`);
  assert.equal(chat.status, 200);
  assert.equal(require('../modules/harness/session-access').ownerOf(chat.body.sessionId), member.user.id, 'their chat is theirs');
  assert.equal(projects.forSession(chat.body.sessionId)?.id, id);

  const view = (await H.api(null, 'GET', `/api/projects/${id}/sharing`)).body;
  assert.deepEqual(view.audit.map(a => [a.what, a.to || null]).reverse(), [['created', null], ['shared', 'see'], ['shared', 'work']]);
  assert.equal(view.audit[0].by.id, H.owner.user.id);
  assert.deepEqual(view.shares, [{ id: member.user.id, name: 'member', right: 'work' }]);

  await H.api(null, 'POST', `/api/projects/${id}/sharing`, { personId: member.user.id, right: 'none' });
  assert.equal((await as(member, 'GET', `/api/projects/${id}`)).status, 404);
  assert.equal(projects.forSession(chat.body.sessionId), null, 'a conversation is no longer in a project taken from its person');

  // The agent, for that member: the project tool lists nothing of the owner's, and refuses it by id.
  const tools = require('../modules/harness/tools');
  const ctx = { sessionId: chat.body.sessionId, user: { ...member.user, role: 'member', orgId: member.orgId } };
  assert.equal(await tools.call('project', { action: 'list' }, [], ctx), 'No projects yet.');
  assert.match(await tools.call('project', { action: 'info', id }, [], ctx), /No project/);
});

test('a member makes projects only in a folder of their own; a host changes an owner', async () => {
  const member = await H.signIn('member');
  let r = await as(member, 'POST', '/api/projects', { name: 'My shelf' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const own = r.body.project;
  assert.equal(own.owner.id, member.user.id);
  assert.ok(own.root.startsWith(projects.ownFolder(member.user)), own.root);
  r = await as(member, 'POST', '/api/projects', { root: H.tmp });
  assert.equal(r.status, 403);
  assert.equal((await as(member, 'DELETE', `/api/projects/${own.id}`)).status, 200, 'its owner may remove the record (the folder stays)');
  assert.ok(fs.existsSync(own.root));

  r = await as(member, 'POST', '/api/projects', { name: 'Handed over' });
  const other = await H.signIn('member');
  assert.equal((await as(member, 'POST', `/api/projects/${r.body.project.id}/owner`, { personId: other.user.id })).status, 403);
  const moved = await H.api(null, 'POST', `/api/projects/${r.body.project.id}/owner`, { personId: other.user.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.owner.id, other.user.id);
  assert.equal(moved.body.audit[0].what, 'owner');
  assert.equal((await as(member, 'GET', `/api/projects/${r.body.project.id}`)).status, 404);
  assert.equal((await as(other, 'GET', `/api/projects/${r.body.project.id}`)).status, 200);
});

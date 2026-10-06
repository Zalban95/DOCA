'use strict';

/** The Archive (modules/archive.js): put away rather than deleted, in one place, restored with one click. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const memory = require('../modules/harness/memory');

test.before(() => H.start());
test.after(() => H.stop());

test('a project is put away and brought back; conversations are each person\'s; projects an admin\'s', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').homedir(), '.doca-archive-test-'));
  try {
    const p = (await H.api(null, 'POST', '/api/projects', { name: 'old thing', root })).body.project;
    let r = await H.api(null, 'POST', `/api/archive/project/${p.id}`, { on: true });
    assert.equal(r.status, 200);
    assert.ok(!(await H.api(null, 'GET', '/api/projects')).body.projects.some(x => x.id === p.id), 'out of the Projects list');
    assert.ok((await H.api(null, 'GET', '/api/projects?all=1')).body.projects.some(x => x.id === p.id));
    let items = (await H.api(null, 'GET', '/api/archive')).body.items;
    assert.ok(items.some(i => i.kind === 'project' && i.id === p.id && i.title === 'old thing'));

    const s = memory.createSession('put away', { activate: false });
    await H.api(null, 'POST', `/api/archive/conversation/${s.id}`, { on: true });
    items = (await H.api(null, 'GET', '/api/archive')).body.items;
    assert.ok(items.some(i => i.kind === 'conversation' && i.id === s.id));

    const member = await H.signIn('member', 'archive-member@test.local');
    const theirs = (await H.api(null, 'GET', '/api/archive', undefined, { Cookie: member.cookie })).body.items;
    assert.equal(theirs.length, 0, 'a member sees neither the admin\'s conversations nor the machine\'s projects');
    assert.equal((await H.api(null, 'POST', `/api/archive/project/${p.id}`, { on: false }, { Cookie: member.cookie })).status, 403);
    assert.equal((await H.api(null, 'POST', `/api/archive/conversation/${s.id}`, { on: false }, { Cookie: member.cookie })).status, 404);
    assert.equal((await H.api(null, 'POST', '/api/archive/spaceship/x', { on: false })).status, 404);

    await H.api(null, 'POST', `/api/archive/project/${p.id}`, { on: false });
    await H.api(null, 'POST', `/api/archive/conversation/${s.id}`, { on: false });
    assert.ok((await H.api(null, 'GET', '/api/projects')).body.projects.some(x => x.id === p.id), 'restored');
    assert.ok(!memory.getSession(s.id).archivedAt);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

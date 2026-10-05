'use strict';

// Pages (modules/projects/pages.js, TODO H9.4): a project's markdown files are pages, a new page begins with its
// title, and a chat can be about one page — every turn of it is told which page and given its current text.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

let p;
before(async () => {
  await H.start();
  const root = fs.mkdtempSync(path.join(H.tmp, 'space-'));
  p = require('../modules/projects/store').create({ root, name: 'Handbook' });
});
after(() => H.stop());

test('a new page is a markdown file that begins with its title, never over another', async () => {
  const a = await H.api(null, 'POST', `/api/projects/${p.id}/pages`, { title: 'Onboarding: first week' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.path, 'onboarding-first-week.md');
  assert.equal(fs.readFileSync(path.join(p.root, a.body.path), 'utf8'), '# Onboarding: first week\n\n');
  const b = await H.api(null, 'POST', `/api/projects/${p.id}/pages`, { title: 'Onboarding: first week' });
  assert.equal(b.body.path, 'onboarding-first-week-2.md');
  assert.equal((await H.api(null, 'POST', `/api/projects/${p.id}/pages`, { title: ' ' })).status, 400);
});

test('a chat about a page is told which page it is and what it says now', async () => {
  fs.writeFileSync(path.join(p.root, 'onboarding-first-week.md'), '# Onboarding: first week\n\n## Monday\nLaptop and accounts.\n\n## Tuesday\nShadow a support shift.\n');
  const r = await H.api(null, 'POST', `/api/projects/${p.id}/chats`, { page: 'onboarding-first-week.md' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.chat.page, 'onboarding-first-week.md');
  assert.match(r.body.chat.title, /📄 onboarding-first-week/);
  const listed = (await H.api(null, 'GET', `/api/projects/${p.id}/chats`)).body.chats.find(c => c.id === r.body.chat.id);
  assert.equal(listed.page, 'onboarding-first-week.md', 'the tab knows its page');
  const { projectBrief } = await require('../modules/harness/turn/prompt').turnPreamble({ session: require('../modules/harness/memory').getSession(r.body.chat.id), profile: null, p: require('../modules/harness/agent').params() });
  assert.match(projectBrief, /# This conversation is about a page\nonboarding-first-week\.md in this project/);
  assert.match(projectBrief, /## Tuesday\nShadow a support shift\./, 'its current text');
  fs.writeFileSync(path.join(p.root, 'onboarding-first-week.md'), `# Long\n\n${'word '.repeat(2000)}`);
  assert.match(require('../modules/projects/pages').block(r.body.chat.id), /the first 6000 of 10\d\d\d characters: read_file it for the rest/);
  fs.rmSync(path.join(p.root, 'onboarding-first-week.md'));
  assert.match(require('../modules/projects/pages').block(r.body.chat.id), /not there any more/);
  const plain = await H.api(null, 'POST', `/api/projects/${p.id}/chats`, {});
  assert.equal(require('../modules/projects/pages').block(plain.body.chat.id), '', 'an ordinary chat is about no page');
});

test('a page is a .md file inside its project', async () => {
  assert.equal((await H.api(null, 'POST', `/api/projects/${p.id}/chats`, { page: '../../etc/passwd.md' })).status, 400);
  assert.equal((await H.api(null, 'POST', `/api/projects/${p.id}/chats`, { page: 'notes.txt' })).status, 400);
});

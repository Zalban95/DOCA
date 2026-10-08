'use strict';

// Hub → Files' shortcuts (public/js/files-bookmarks.js): on a fresh install most answered 404, and "Root fs" 403,
// with nothing on the page (self-test round two, C10). /api/paths says which lead somewhere; the tab hides another
// product's missing folders and offers to create DOCA's own.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

before(() => H.start());
after(() => H.stop());

const bookmarks = paths => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'files-bookmarks.js'), 'utf8'), ctx);
  return JSON.parse(vm.runInContext(`JSON.stringify(fmBookmarksFrom(${JSON.stringify(paths)}))`, ctx));
};

test('the paths say which shortcuts lead somewhere, and a missing one shows as one to create', async () => {
  const r = await H.api(null, 'GET', '/api/paths');
  assert.equal(r.status, 200);
  const s = r.body.shortcuts;
  for (const k of ['openclawDir', 'composeDir', 'workspaceDir', 'skillsDir', 'snapshotDir', 'root']) assert.equal(typeof s[k], 'boolean', k);
  assert.equal(s.snapshotDir, fs.existsSync(r.body.snapshotDir));

  const fresh = bookmarks({ home: '/home/x', configPath: '/home/x/.openclaw/openclaw.json', workspaceDir: '/home/x/ws', skillsDir: '/home/x/ws/skills',
    composeDir: '/home/x/openclaw', snapshotDir: '/home/x/snaps',
    shortcuts: { openclawDir: false, composeDir: false, workspaceDir: true, skillsDir: false, snapshotDir: false, root: false } });
  assert.deepEqual(fresh.map(b => b.id), ['home', 'workspace', 'skills', 'snapshots'], 'another product\'s missing folders and an unreadable root are left out');
  assert.deepEqual(fresh.filter(b => b.missing).map(b => b.key), ['SKILLS_DIR', 'SNAPSHOT_DIR'], 'DOCA\'s own missing folders are offered to create');
  const full = bookmarks({ home: '/home/x', configPath: '/home/x/.openclaw/openclaw.json', workspaceDir: '/w', skillsDir: '/s', composeDir: '/c', snapshotDir: '/n',
    shortcuts: { openclawDir: true, composeDir: true, workspaceDir: true, skillsDir: true, snapshotDir: true, root: true } });
  assert.equal(full.find(b => b.id === 'openclaw').path, '/home/x/.openclaw');
  assert.equal(full.length, 7);
});

test('a folder that is not there says so in words', async () => {
  const r = await H.api(null, 'GET', `/api/files/list?path=${encodeURIComponent(path.join(H.tmp || require('node:os').tmpdir(), 'no-such-folder-here'))}`);
  assert.ok([403, 404].includes(r.status));
  if (r.status === 404) assert.match(r.body.error, /There is no folder at .* yet/);
});

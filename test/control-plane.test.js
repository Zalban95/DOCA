'use strict';

/**
 * The agent's write tools refuse what governs it (harness/control-plane.js;
 * ISSUES.md H-19, audit 2026-09-26 N2) — whatever the approval mode.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H     = require('./helpers');
const paths = require('../modules/paths');
const store = require('../modules/store');
const tools = require('../modules/harness/tools');

test.before(() => H.start());
test.after(() => H.stop());

test('write_file refuses the prefs, accounts, devices and keys — directly or through a symlink', async () => {
  fs.writeFileSync(paths.PREFS_FILE, JSON.stringify({ harness: { approval: { mode: 'manual' } } }));
  for (const target of [paths.PREFS_FILE, path.join(store.DATA_DIR, 'auth', 'users.json'), path.join(store.DATA_DIR, 'devices.json'), paths.PROVIDER_KEYS_FILE]) {
    const out = await tools.call('write_file', { path: target, content: '{}' });
    assert.match(out, /^Error: .*(part of what governs this agent|outside the allowed roots|Path is outside)/, target);
  }
  assert.match(fs.readFileSync(paths.PREFS_FILE, 'utf8'), /manual/, 'the approval mode is untouched');

  const link = path.join(H.tmp, 'innocent-settings.json');
  fs.symlinkSync(paths.PREFS_FILE, link);
  assert.match(await tools.call('write_file', { path: link, content: '{}' }), /part of what governs this agent/);

  assert.match(await tools.call('write_file', { path: path.join(H.tmp, 'notes.txt'), content: 'fine' }), /^Wrote 4 bytes/);
});

test('replace_in_files skips what governs the agent, even with apply', async () => {
  const dir = fs.mkdtempSync(path.join(H.tmp, 'cp-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'mode: manual\n');
  // A prefs file inside the folder being replaced in.
  const cp = require('../modules/harness/control-plane');
  const out = await tools.call('replace_in_files', { path: H.tmp, query: 'manual', replacement: 'unattended', apply: true, include: '*.json, *.txt' });
  assert.match(out, /Replaced/);
  assert.match(fs.readFileSync(paths.PREFS_FILE, 'utf8'), /manual/, 'the prefs file is not replaced in');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'mode: unattended\n', 'an ordinary file is');
  assert.ok(cp.which(paths.PREFS_FILE));
});

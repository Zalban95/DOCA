'use strict';

/**
 * Software for a job (mcp/software.js; R2b, 2026-10-13): open and proprietary side by side, each marked, ordered by
 * what is here then by name — never one pushed; the action fits the machine: connect, install, download.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const sw = () => require('../modules/mcp/software');

test('a job lists open and proprietary choices, each marked, with an action', async () => {
  const r = await H.api(null, 'GET', '/api/mcp/software?job=documents');
  assert.equal(r.status, 200);
  const names = r.body.choices.map(c => c.name);
  for (const n of ['LibreOffice', 'Microsoft Word', 'Google Docs', 'WordCraft']) assert.ok(names.includes(n), n);
  for (const c of r.body.choices) {
    assert.ok(c.marks.length, `${c.name} says what it is`);
    assert.ok(['connected', 'connect', 'here', 'install', 'download'].includes(c.state));
    assert.match(c.site, /^https:\/\//);
  }
  assert.ok(r.body.jobs.length >= 12);
});

test('what is here comes first, then by name; absent things download or install', () => {
  const which = b => (b === 'libreoffice' ? '/usr/bin/libreoffice' : null);
  const list = sw().forJob('documents', { platform: 'linux', which });
  assert.equal(list.find(c => c.name === 'LibreOffice').state, 'here');
  assert.equal(list.find(c => c.name === 'Microsoft Word').state, 'download');
  assert.equal(list.find(c => c.name === 'Google Docs').state, 'connect', 'a web app: connect the account');
  const rank = { connected: 0, connect: 1, here: 2, install: 3, download: 3 };
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    assert.ok(rank[a.state] < rank[b.state] || (rank[a.state] === rank[b.state] && a.name.localeCompare(b.name) <= 0), `${a.name} before ${b.name}`);
  }
});

test('found by folder on macOS and Windows; an OS-only program stays on its OS', () => {
  const ls = dir => (dir === '/Applications' ? ['microsoft word.app'] : dir.endsWith('Adobe') ? ['adobe photoshop 2026'] : []);
  const mac = sw().forJob('documents', { platform: 'darwin', which: () => null, ls });
  assert.equal(mac.find(c => c.name === 'Microsoft Word').state, 'connect', 'here: connect the account');
  const win = sw().forJob('image', { platform: 'win32', which: () => null, ls, env: { ProgramFiles: 'C:\\PF' } });
  assert.equal(win.find(c => c.name === 'Adobe Photoshop').state, 'here');
  assert.ok(!sw().forJob('slides', { platform: 'linux', which: () => null }).some(c => c.name === 'Apple Keynote'));
  assert.ok(sw().forJob('slides', { platform: 'darwin', which: () => null, ls: () => [] }).some(c => c.name === 'Apple Keynote'));
});

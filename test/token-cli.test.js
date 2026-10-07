'use strict';

// `npm run token -- issue` says which data folder the token went into, and warns when no running panel reads that
// folder (self-test 2026-10-08, #9: a token issued into the wrong DOCA_DATA_DIR looked valid and was refused).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.join(__dirname, '..', 'bin', 'doca-token.js');
const issue = dataDir => spawnSync(process.execPath, [cli, 'issue', '--name', 'cli', '--preset', 'viewer'],
  { env: { ...process.env, DOCA_DATA_DIR: dataDir }, encoding: 'utf8' });

test('a token names its data folder, and says when no panel uses it', () => {
  const dir = path.join(path.dirname(process.env.DOCA_DATA_DIR), 'token-cli');
  fs.mkdirSync(dir, { recursive: true });
  try {
    const lone = issue(dir);
    assert.equal(lone.status, 0, lone.stderr);
    assert.ok(lone.stdout.includes(`Data    ${dir}`), lone.stdout);
    assert.match(lone.stderr, /no running panel uses .*works only for a panel started with that folder/);
    // A panel listening with this folder marks it (panel-running.js); this test's own process stands in for it.
    fs.writeFileSync(path.join(dir, 'panel.pid'), JSON.stringify({ pid: process.pid, port: 4242 }));
    const used = issue(dir);
    assert.equal(used.status, 0, used.stderr);
    assert.doesNotMatch(used.stderr, /no running panel/);
    // A mark left by a process that is gone reads as none.
    fs.writeFileSync(path.join(dir, 'panel.pid'), JSON.stringify({ pid: 2 ** 22 + 12345, port: 4242 }));
    assert.match(issue(dir).stderr, /no running panel/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

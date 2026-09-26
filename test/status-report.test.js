'use strict';

/**
 * `npm run status`: what is stuck and why, read from disk with no panel and no model.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path   = require('node:path');

const H        = require('./helpers');
const memory   = require('../modules/harness/memory');
const settings = require('../modules/harness/settings');
const status   = require('../modules/status-report');

test.before(() => H.start());
test.after(() => H.stop());

test('a failed conversation, a stalled job and a waiting proposal are named, and --strict fails on them', () => {
  const s = memory.createSession('Broken build', { activate: false });
  memory.updateSession(s.id, { state: 'failed', lastError: 'npm ERR! missing script: build' });
  const w = memory.createSession('Endless job', { activate: false });
  memory.updateSession(w.id, { job: { state: 'stalled', autoTurns: 30 } });
  settings.propose({ changes: [{ path: 'harness.config.doca.temperature', value: 0.5 }], reason: 'steadier answers' });

  const r = status.report();
  assert.ok(r.conversations.failed.some(x => x.id === s.id && /missing script/.test(x.error)));
  assert.ok(r.conversations.stalled.some(x => x.id === w.id && x.autoTurns === 30));
  assert.ok(r.waitingOnAPerson.proposals.some(x => x.paths.includes('harness.config.doca.temperature')));
  const text = status.render(r);
  assert.match(text, /Failed conversations \(7 days\):\n  Broken build .*npm ERR! missing script: build/);
  assert.match(text, /Needs attention:\n  • 1 conversation\(s\) failed/);

  // The CLI, as a separate process on the same data: no server involved.
  const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'doca-status.js'), ...args], { env: process.env, encoding: 'utf8' });
  const json = cli(['--json']);
  assert.equal(json.status, 0);
  assert.ok(JSON.parse(json.stdout).conversations.failed.some(x => x.id === s.id));
  assert.equal(cli(['--strict']).status, 1, '--strict fails when something needs attention');

  memory.deleteSession(s.id); memory.deleteSession(w.id);
});

#!/usr/bin/env node
'use strict';

/**
 * What DOCA guarantees without a model, proved here and now.
 *
 *   npm run prove
 *
 * Every line below is a property the panel enforces in code, and each is backed
 * by tests that run against a scripted stub — no provider, no key, no network,
 * no Ollama. This runs those tests in a scratch data folder (test/helpers.js
 * makes one) and prints each guarantee as held or not. The full suite is
 * `npm test`; this is the part worth showing somebody evaluating DOCA.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const GUARANTEES = [
  ['Nothing answers without a sign-in; every route has a rule, and a missing rule is refused', ['auth.test.js']],
  ['A tool call that does something asks first in manual mode, and a refusal is final', ['approval.test.js']],
  ['The files that govern the agent cannot be written without that call\'s own yes', ['control-plane.test.js']],
  ['Text from pages, files and other machines is labelled as data, not instructions', ['untrusted.test.js']],
  ['Several guards screen outside text; it is clean only if all agree, and blocked parts are withheld and logged', ['guard.test.js']],
  ['Every tool belongs to a kit; what an agent type holds is decided by its kits', ['kits.test.js']],
  ['An agent run can be undone: checkpoints restore a project, and a restore can be undone', ['checkpoints.test.js']],
  ['A backup is verified all-or-nothing before a restore touches anything', ['backups.test.js']],
  ['A config that can never fold its context is said so', ['fold-check.test.js']],
  ['Search, replace and read do what they say on one file and on a slice', ['tool-slices.test.js']],
  ['What is stuck and why can be read from disk with no panel running', ['status-report.test.js']],
  ['Earlier conversations can be searched and read back by the agent, asking no approval', ['recall.test.js']],
];

const root = path.join(__dirname, '..');
console.log('DOCA — guarantees proved without a model\n');
let failed = 0;
for (const [claim, files] of GUARANTEES) {
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=30000', ...files.map(f => path.join(root, 'test', f))],
    { cwd: root, encoding: 'utf8', env: { ...process.env } });
  const pass = Number(/^# pass (\d+)/m.exec(r.stdout)?.[1] || 0);
  const fail = Number(/^# fail (\d+)/m.exec(r.stdout)?.[1] || (r.status ? 1 : 0));
  const ok = r.status === 0 && !fail;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${claim}  (${pass} test${pass === 1 ? '' : 's'}${fail ? `, ${fail} failed` : ''})`);
}
console.log(failed ? `\n${failed} guarantee(s) did not hold — run npm test for detail.` : '\nAll held. No model was called.');
process.exitCode = failed ? 1 : 0;

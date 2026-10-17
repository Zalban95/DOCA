'use strict';

/**
 * The hub's shell refuses to kill by a name pattern (harness/kill-guard.js): it matches the agent's own shell, other
 * tools or the hub itself (2026-10-09 the hub went down; 2026-10-17 two agents killed their own shells). Killing a PID
 * found first still runs, and so does every line that only mentions the words.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

test.after(() => H.stop());

const REFUSED = ['pkill -f run.mjs', 'for p in $(pgrep -f x); do kill $p; done', 'kill $(pgrep node)', 'pgrep -f harness | xargs kill',
  'killall chrome', 'sudo pkill x', 'ls; pkill -9 -f lamp', 'kill -9 `pidof python3`', 'pgrep -f x | xargs -r sudo kill -9', 'cd /tmp && pkill node'];
const RUNS = ['pgrep -a node', 'kill 1234', 'ps -eo pid,args | grep run.mjs', 'echo pkill is bad', 'git log --grep=kill', 'npm run kill-port',
  'grep -r pkill src', 'pids=$(pgrep -f x); echo $pids', 'kill -0 4242 && echo alive'];

test('a kill by name pattern is refused with how to do it instead; a kill by PID and a mention are not', async () => {
  const { refusal } = require('../modules/harness/kill-guard');
  for (const c of REFUSED) assert.ok(refusal(c), `refused: ${c}`);
  for (const c of RUNS) assert.equal(refusal(c), null, `runs: ${c}`);
  await H.start();
  const tools = require('../modules/harness/tools');
  const r = await tools.call('shell', { command: 'pkill -f doca-test-never-matches' });
  assert.match(r, /^Error: Not run: killing processes by a name pattern/);
  assert.match(r, /pgrep -a/, 'it says how');
});

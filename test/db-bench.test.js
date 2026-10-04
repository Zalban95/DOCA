'use strict';

// npm run db-bench (bin/doca-db-bench.js): DOCA's own workloads, through the layer's calls, on a temp file.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('the bench measures every workload and never touches the real data folder', () => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-bench-real-'));
  const env = { ...process.env, DOCA_DATA_DIR: real };
  delete env.DOCA_DB_URL;
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'doca-db-bench.js'), '--n', '50', '--json'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.engine, 'sqlite');
  assert.equal(out.where, 'temp file');
  assert.deepEqual(out.results.map(x => x.op), ['append', 'batch', 'point', 'aggregate', 'doc', 'parallel']);
  for (const x of out.results) assert.ok(x.opsPerSec > 0, `${x.op} measured`);
  assert.deepEqual(fs.readdirSync(real), [], 'no doca.db, no WAL, nothing in the data folder it was given');
  fs.rmSync(real, { recursive: true, force: true });
});

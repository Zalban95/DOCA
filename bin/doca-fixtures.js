#!/usr/bin/env node
'use strict';

/**
 * `npm run fixtures`: write docs/api/fixtures/*.json from the hub's own frames (test/client-fixtures.test.js with
 * DOCA_WRITE_FIXTURES=1) — a script rather than `VAR=1 node …` in package.json, which Windows' cmd does not read.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const r = spawnSync(process.execPath, ['--test', path.join(__dirname, '..', 'test', 'client-fixtures.test.js')],
  { stdio: 'inherit', env: { ...process.env, DOCA_WRITE_FIXTURES: '1' } });
process.exit(r.status ?? 1);

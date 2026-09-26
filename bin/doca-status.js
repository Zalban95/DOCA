#!/usr/bin/env node
'use strict';

/**
 * What is stuck, and why — without the panel running, and without a model.
 *
 *   npm run status              a readable report
 *   npm run status -- --json    the same, for a script or a CI job
 *   npm run status -- --strict  exit 1 when something needs attention
 *
 * Reads DOCA_DATA_DIR (or DOCA_HOME/.doca), the same data the panel uses.
 */
const { report, render } = require('../modules/status-report');

const args = process.argv.slice(2);
report().then(r => {
  console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
  if (args.includes('--strict') && r.attention.length) process.exitCode = 1;
  require('../modules/db').close();
});

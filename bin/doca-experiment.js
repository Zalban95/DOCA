#!/usr/bin/env node
'use strict';

/**
 * Measure an experiment (docs/design/hive.md §8): `npm run experiment -- <id>`, each measured by bin/experiments/<id>.js.
 *
 * Runs on a throwaway copy of this machine's settings and model keys (a temp data folder; the real one is never
 * written), with the experiment switched on there, against the models this machine is configured with — a paid
 * provider's tokens are real, which is why nothing runs it by itself. Prints a row for the write-up's results table.
 */
const fs = require('fs');
const path = require('path');

const which = process.argv[2];
const known = fs.readdirSync(path.join(__dirname, 'experiments')).map(f => f.replace(/\.js$/, ''));
if (!known.includes(which)) { console.error(`usage: npm run experiment -- ${known.join(' | ')}`); process.exit(2); }

const { tmp, cleanup } = require('./lib/sandbox').sandbox('doca-experiment-');   // the real data is never written

const main = () => require(`./experiments/${which}`).measure({ tmp });

main().then(code => { cleanup(); process.exit(code); })
  .catch(e => { console.error(`experiment: ${e.message}`); cleanup(); process.exit(1); });

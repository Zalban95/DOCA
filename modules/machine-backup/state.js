'use strict';

/**
 * What the machine backup remembers between runs: when it last worked, last tried, why it failed, when it was switched
 * on (store `machine-backup/state`), and each run's account — files, bytes new, how long, the files it could not read —
 * kept beside restic's snapshots (store `machine-backup/runs`, the last 60), since a snapshot does not record what it
 * left out. Names, numbers and paths only — never a password.
 */
const store = require('../store');

const KEEP_RUNS = 60;

function get() { return store.readJson('machine-backup/state', {}); }
function patch(p) { const s = { ...get(), ...p }; store.writeJson('machine-backup/state', s); return s; }

function runs() { const r = store.readJson('machine-backup/runs', []); return Array.isArray(r) ? r : []; }
function addRun(run) { store.writeJson('machine-backup/runs', [run, ...runs()].slice(0, KEEP_RUNS)); return run; }

module.exports = { get, patch, runs, addRun, KEEP_RUNS };

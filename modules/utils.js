'use strict';

const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');

const { COMPOSE_DIR, PREFS_FILE, FM_ALLOWED_ROOTS } = require('./paths');

/** Run a shell command and return { stdout, stderr }. Rejects on non-zero exit. */
function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: cwd || COMPOSE_DIR, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject({ error: err.message, stderr, stdout });
      else resolve({ stdout, stderr });
    });
  });
}

/** Set standard SSE headers on an Express response. */
function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

/** Return true if the resolved path falls within an allowed root. */
function fmSafe(p) {
  const abs = path.resolve(p);
  return FM_ALLOWED_ROOTS.some(root => abs === root || abs.startsWith(root + '/'));
}

/** Load dashboard preferences from disk (returns {} on missing/corrupt file). */
function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); }
  catch { return {}; }
}

/** Persist dashboard preferences to disk. */
function savePrefs(data) {
  fs.writeFileSync(PREFS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** Load the models sub-object from prefs. */
function loadModelsPrefs() {
  return loadPrefs().models || {};
}

/** Save the models sub-object into prefs. */
function saveModelsPrefs(models) {
  const prefs = loadPrefs();
  prefs.models = models;
  savePrefs(prefs);
}

module.exports = {
  run,
  sseHeaders,
  fmSafe,
  loadPrefs,
  savePrefs,
  loadModelsPrefs,
  saveModelsPrefs,
};

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { SNAPSHOT_DIR, SNAPSHOT_SCRIPT, RESTORE_SCRIPT, PREFS_FILE } = require('./paths');
const { sseHeaders, loadPrefs } = require('./utils');

/** Merge snapshot settings from prefs with env/defaults. */
function loadSnapshotSettings() {
  const prefs = loadPrefs();
  const s = prefs.snapshotSettings || {};
  return {
    snapshotDir:    s.snapshotDir    || SNAPSHOT_DIR,
    snapshotScript: s.snapshotScript || SNAPSHOT_SCRIPT,
    restoreScript:  s.restoreScript  || RESTORE_SCRIPT,
    includePaths:   s.includePaths   || [],
  };
}

/** GET /api/snapshots/settings */
function handleGetSettings(req, res) {
  res.json(loadSnapshotSettings());
}

/** POST /api/snapshots/settings */
function handlePostSettings(req, res) {
  const { snapshotDir, snapshotScript, restoreScript, includePaths } = req.body;
  const prefs = loadPrefs();
  prefs.snapshotSettings = { snapshotDir, snapshotScript, restoreScript, includePaths };
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/snapshots */
function handleList(req, res) {
  const cfg = loadSnapshotSettings();
  try {
    if (!fs.existsSync(cfg.snapshotDir)) return res.json({ snapshots: [], warning: `Snapshot dir not found: ${cfg.snapshotDir}` });
    const entries = fs.readdirSync(cfg.snapshotDir, { withFileTypes: true });
    const snapshots = entries
      .filter(e => e.isDirectory() || e.name.endsWith('.tar.gz'))
      .map(e => {
        const s = fs.statSync(path.join(cfg.snapshotDir, e.name));
        const size = e.isDirectory() ? null : s.size;
        return { name: e.name, created: s.mtime.toISOString(), size };
      })
      .sort((a, b) => b.created.localeCompare(a.created));
    res.json({ snapshots });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/snapshots/create */
function handleCreate(req, res) {
  const { label } = req.body;
  const cfg = loadSnapshotSettings();
  sseHeaders(res);

  const sseErr = msg => {
    res.write(`data: ${JSON.stringify(`ERROR: ${msg}`)}\n\n`);
    res.write(`data: ${JSON.stringify('[exit 1]')}\n\n`);
    res.end();
  };

  const scriptExists = cfg.snapshotScript && fs.existsSync(cfg.snapshotScript);

  let child;
  if (scriptExists) {
    const extraArgs = cfg.includePaths.length ? cfg.includePaths : [];
    child = spawn('bash', [cfg.snapshotScript, ...(label ? [label] : []), ...extraArgs]);
  } else if (cfg.includePaths && cfg.includePaths.length > 0) {
    if (!fs.existsSync(cfg.snapshotDir)) {
      try { fs.mkdirSync(cfg.snapshotDir, { recursive: true }); } catch (e) { return sseErr(`Cannot create snapshot dir: ${e.message}`); }
    }
    const ts = (label || new Date().toISOString()).replace(/[:.]/g, '-');
    const dest = path.join(cfg.snapshotDir, ts + '.tar.gz');
    res.write(`data: ${JSON.stringify(`[tar fallback] Creating ${dest}\n`)}\n\n`);
    child = spawn('tar', ['czf', dest, ...cfg.includePaths]);
  } else {
    return sseErr(`Snapshot script not found: ${cfg.snapshotScript || '(none)'}\nConfigure a script path or set include paths in Snapshot Settings for the built-in tar fallback.`);
  }

  child.stdout.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.on('error', err => sseErr(err.message));
  child.on('close', code => { res.write(`data: ${JSON.stringify(`[exit ${code}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
}

/** POST /api/snapshots/restore */
function handleRestore(req, res) {
  const { name } = req.body;
  if (!name || !/^[\w.\-]+$/.test(name)) return res.status(400).json({ error: 'Invalid snapshot name' });
  const cfg = loadSnapshotSettings();
  sseHeaders(res);

  const sseErr = msg => {
    res.write(`data: ${JSON.stringify(`ERROR: ${msg}`)}\n\n`);
    res.write(`data: ${JSON.stringify('[exit 1]')}\n\n`);
    res.end();
  };

  const restoreScriptExists = cfg.restoreScript && fs.existsSync(cfg.restoreScript);

  let restoreChild;
  if (restoreScriptExists) {
    restoreChild = spawn('bash', [cfg.restoreScript, name]);
  } else {
    const archivePath = path.join(cfg.snapshotDir, name);
    if (!fs.existsSync(archivePath)) return sseErr(`Snapshot file not found: ${archivePath}`);
    res.write(`data: ${JSON.stringify(`[tar fallback] Restoring ${archivePath} to /\n`)}\n\n`);
    restoreChild = spawn('tar', ['xzf', archivePath, '-C', '/']);
  }

  restoreChild.stdout.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  restoreChild.stderr.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  restoreChild.on('error', err => sseErr(err.message));
  restoreChild.on('close', code => { res.write(`data: ${JSON.stringify(`[exit ${code}]`)}\n\n`); res.end(); });
  req.on('close', () => restoreChild.kill());
}

module.exports = {
  handleGetSettings,
  handlePostSettings,
  handleList,
  handleCreate,
  handleRestore,
};

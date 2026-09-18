'use strict';

const { exec, execFile, spawn } = require('child_process');

const { sseHeaders, loadPrefs, savePrefs } = require('./utils');

/**
 * `docker` with its arguments, and no shell in between.
 *
 * `--format '{{json .}}'` is quoted for sh. cmd.exe does not strip those quotes,
 * so on Windows docker was handed `'{{json` and `.}}'` as two extra arguments
 * and answered "docker ps accepts no arguments" — a 500 on every Containers
 * load, and it hid the daemon-not-running case behind a parse error. execFile
 * passes the argument vector straight to the process, so the braces need no
 * quoting anywhere.
 */
const dockerJson = (args, done) => execFile('docker', args, { maxBuffer: 8 * 1024 * 1024 }, done);

const textOf = err => String((err && (err.message || err.stderr)) || '');

/**
 * "Docker is not installed here" is a fact about the machine, not a fault.
 *
 * The panel is useful without docker — Containers is one tab of many — and this
 * answered 500 with the raw shell error, which is the same mistake as the files
 * ENOENT 500 and the `keys.js` ENOENT bug: the user goes looking for what broke
 * in the panel when nothing did. A 503 says "this dependency is not here"
 * without saying the panel is unwell, and it is distinguishable in the UI
 * because the code travels with it.
 */
function dockerMissing(err) {
  return /not found|ENOENT|no such file/i.test(textOf(err));
}

/**
 * Installed, but nothing answering. The commoner state of the two, and it was
 * still a 500: the daemon's own words are "Cannot connect to the Docker daemon
 * … Is the docker daemon running?" on Linux and "failed to connect to the
 * docker API at npipe:… check if … the daemon is running" on Windows, neither
 * of which is a missing binary. Same 503 — the dependency is not available —
 * with its own code and a message that says which of the two it is, because
 * "install docker" is useless advice to somebody who has it installed.
 */
function dockerStopped(err) {
  return /cannot connect to the docker daemon|daemon is (not )?running|docker api at|is the docker daemon/i
    .test(textOf(err));
}

/** Shared by the routes: the same shape, and the same three answers. */
function dockerFailed(res, err, what) {
  if (dockerMissing(err)) return res.status(503).json({
    error: `Docker is not installed on this host, so there are no ${what} to list.`,
    code: 'docker_missing',
  });
  if (dockerStopped(err)) return res.status(503).json({
    error: `Docker is installed but its daemon is not running, so there are no ${what} to list. `
      + 'Start it (systemctl start docker, or open Docker Desktop) and refresh.',
    code: 'docker_stopped',
  });
  return res.status(500).json({ error: err.message });
}

/** GET /api/docker/containers */
function handleContainers(req, res) {
  dockerJson(['ps', '-a', '--format', '{{json .}}'], (err, stdout) => {
    if (err) return dockerFailed(res, err, 'containers');
    const containers = stdout.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    res.json({ containers });
  });
}

/** POST /api/docker/containers/:id/action */
function handleContainerAction(req, res) {
  const { action } = req.body;
  const id = req.params.id;
  const allowed = ['start', 'stop', 'restart', 'remove', 'rm'];
  if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const cmd = action === 'remove' ? `docker rm -f ${id}` : `docker ${action} ${id}`;
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      // A real docker error ("no such container") is this route's own 500 with
      // stderr; only the two states of docker itself go through dockerFailed.
      if (dockerMissing(err) || dockerStopped(err)) return dockerFailed(res, err, 'containers');
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ ok: true, output: stdout.trim() });
  });
}

/** GET /api/docker/containers/:id/logs — SSE stream */
function handleContainerLogs(req, res) {
  sseHeaders(res);
  const id    = req.params.id;
  const tail  = req.query.tail || '200';
  const child = spawn('docker', ['logs', '-f', '--tail', tail, id]);

  const send = d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`);
  child.stdout.on('data', send);
  child.stderr.on('data', send);
  child.on('close', () => res.end());
  child.on('error', err => { res.write(`data: ${JSON.stringify(`[error: ${err.message}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
}

/** GET /api/docker/images */
function handleImages(req, res) {
  dockerJson(['images', '--format', '{{json .}}'], (err, stdout) => {
    if (err) return dockerFailed(res, err, 'images');
    const images = stdout.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    res.json({ images });
  });
}

/** POST /api/docker/images/pull — SSE progress */
function handleImagePull(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'No image name' });
  sseHeaders(res);
  const child = spawn('docker', ['pull', name]);
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.on('error', err => { res.write(`data: ${JSON.stringify(`[error: ${err.message}]`)}\n\n`); res.end(); });
  child.on('close', code => { res.write(`data: ${JSON.stringify(`[exit ${code}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
}

/** DELETE /api/docker/images/:id */
function handleImageDelete(req, res) {
  const id = decodeURIComponent(req.params.id);
  exec(`docker rmi ${id}`, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true });
  });
}

/** POST /api/docker/run — create & start a container from an image (SSE progress) */
function handleRun(req, res) {
  const { image, name, ports, gpu, restart, envVars, volumes, createOnly } = req.body;
  if (!image) return res.status(400).json({ error: 'No image specified' });

  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  const args = [createOnly ? 'create' : 'run', createOnly ? undefined : '-d'].filter(Boolean);

  if (name) args.push('--name', name);
  if (restart && restart !== 'no') args.push('--restart', restart);

  if      (gpu === 'all') args.push('--gpus', 'all');
  else if (gpu === '0')   args.push('--gpus', 'device=0');
  else if (gpu === '1')   args.push('--gpus', 'device=1');

  (ports || []).forEach(p => { if (p.trim()) args.push('-p', p.trim()); });
  (envVars || []).forEach(e => { if (e.trim()) args.push('-e', e.trim()); });
  (volumes || []).forEach(v => { if (v.trim()) args.push('-v', v.trim()); });

  args.push(image);

  const verb = createOnly ? 'create' : 'run';
  const cmdDisplay = `docker ${args.join(' ')}`;
  sseWrite({ status: `$ ${cmdDisplay}\n` });

  const child = spawn('docker', args);
  child.stdout.on('data', d => sseWrite({ status: d.toString() }));
  child.stderr.on('data', d => sseWrite({ status: d.toString() }));
  child.on('close', (code) => {
    const ok = code === 0;
    const msg = ok
      ? `\n✓ Container ${createOnly ? 'created' : 'started'}`
      : `\n✗ Exit ${code}`;
    sseWrite({ done: true, ok, status: msg });
    res.end();
  });
  child.on('error', e => { sseWrite({ done: true, ok: false, status: `Error: ${e.message}` }); res.end(); });
  req.on('close', () => { if (!child.killed) child.kill(); });
}

/* ── Docker presets (saved configurations) ────────────────────── */

/** GET /api/docker/presets */
function handleGetPresets(req, res) {
  const prefs = loadPrefs();
  res.json({ presets: prefs.dockerPresets || {} });
}

/** POST /api/docker/presets */
function handleSavePreset(req, res) {
  const preset = req.body;
  if (!preset || !preset.name) return res.status(400).json({ error: 'name required' });
  try {
    const prefs = loadPrefs();
    if (!prefs.dockerPresets) prefs.dockerPresets = {};
    prefs.dockerPresets[preset.name] = preset;
    savePrefs(prefs);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** DELETE /api/docker/presets/:name */
function handleDeletePreset(req, res) {
  const name = decodeURIComponent(req.params.name);
  try {
    const prefs = loadPrefs();
    if (prefs.dockerPresets) {
      delete prefs.dockerPresets[name];
      savePrefs(prefs);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  handleContainers,
  handleContainerAction,
  handleContainerLogs,
  handleImages,
  handleImagePull,
  handleImageDelete,
  handleRun,
  handleGetPresets,
  handleSavePreset,
  handleDeletePreset,
};

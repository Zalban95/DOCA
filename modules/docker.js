'use strict';

const fs = require('fs');
const { exec, spawn } = require('child_process');

const { CONFIG_PATH } = require('./paths');
const { sseHeaders, loadPrefs, savePrefs } = require('./utils');

function _readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

function _writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

/** Extract host ports from a docker ps Ports string like "0.0.0.0:8880->8880/tcp" */
function _extractHostPorts(portsStr) {
  if (!portsStr) return [];
  const ports = [];
  for (const m of portsStr.matchAll(/(?:\d+\.\d+\.\d+\.\d+|::):(\d+)->/g)) {
    ports.push(parseInt(m[1], 10));
  }
  return ports;
}

/** GET /api/docker/containers */
function handleContainers(req, res) {
  exec(`docker ps -a --format '{{json .}}'`, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    const containers = stdout.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    const cfg = _readConfig();
    const tp  = cfg.toolProviders || {};

    containers.forEach(c => {
      const hostPorts = _extractHostPorts(c.Ports || '');
      c.toolProvider = null;
      for (const [name, prov] of Object.entries(tp)) {
        try {
          const provPort = parseInt(new URL(prov.baseUrl).port, 10);
          if (hostPorts.includes(provPort)) {
            c.toolProvider = { name, baseUrl: prov.baseUrl };
            break;
          }
        } catch {}
      }
    });

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
    if (err) return res.status(500).json({ error: stderr || err.message });
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
  exec(`docker images --format '{{json .}}'`, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
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

/* ── Tool Provider registration from Docker tab ───────────────── */

/** POST /api/docker/register-tool-provider */
function handleRegisterToolProvider(req, res) {
  const { name, baseUrl } = req.body;
  if (!name || !baseUrl) return res.status(400).json({ error: 'name and baseUrl required' });
  try {
    const cfg = _readConfig();
    if (!cfg.toolProviders) cfg.toolProviders = {};
    cfg.toolProviders[name] = { baseUrl, apiKey: '' };
    _writeConfig(cfg);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** DELETE /api/docker/tool-provider/:name */
function handleUnregisterToolProvider(req, res) {
  const name = decodeURIComponent(req.params.name);
  try {
    const cfg = _readConfig();
    if (cfg.toolProviders) {
      delete cfg.toolProviders[name];
      _writeConfig(cfg);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
  handleRegisterToolProvider,
  handleUnregisterToolProvider,
  handleGetPresets,
  handleSavePreset,
  handleDeletePreset,
};

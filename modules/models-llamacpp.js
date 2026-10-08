'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

const { loadPrefs, savePrefs, sseHeaders } = require('./utils');

const PREFS_KEY      = 'llamacpp';
const BIND_HOST      = '0.0.0.0';

/**
 * The address this machine is reachable at, for whoever is told about the
 * instance — the panel's endpoint line and the provider written into
 * `openclaw.json`.
 *
 * It used to be the constant `172.18.0.1`, which is one machine's Docker
 * bridge: correct there, and on every other install an endpoint that nothing
 * answers on. The server binds `0.0.0.0` regardless, so loopback is right for
 * the common case, and `llamacpp.advertiseHost` in prefs is how a stack whose
 * clients live in containers says otherwise.
 */
function advertiseHost() {
  const h = (loadPrefs()[PREFS_KEY] || {}).advertiseHost;
  return typeof h === 'string' && h.trim() ? h.trim() : '127.0.0.1';
}

const _procs = {};

/**
 * The configured instances, and nothing invented.
 *
 * This used to seed one hardcoded instance — a 30B gguf under `/media/al/…` —
 * whenever the list was empty, which meant every fresh install acquired a
 * phantom instance pointing at a path that does not exist on it, and a plain
 * GET of the list wrote to prefs to put it there. The panel already draws "No
 * llama.cpp instances configured" and has an Add button, so empty is a state
 * it can render.
 */
function loadInstances() {
  const cfg = loadPrefs()[PREFS_KEY] || {};
  return Array.isArray(cfg.instances) ? cfg.instances : [];
}

function saveInstances(instances) {
  const prefs = loadPrefs();
  if (!prefs[PREFS_KEY]) prefs[PREFS_KEY] = {};
  prefs[PREFS_KEY].instances = instances;
  savePrefs(prefs);
}

function instanceStatus(inst) {
  const proc = _procs[inst.id];
  const running = !!(proc && proc.child && !proc.child.killed);
  return {
    ...inst,
    running,
    pid: running ? proc.child.pid : null,
    startedAt: running ? proc.startedAt : null,
    endpoint: `http://${advertiseHost()}:${inst.port}/v1`,
  };
}

function isPortTaken(port, excludeId) {
  return Object.entries(_procs).some(([id, p]) =>
    id !== excludeId && p.child && !p.child.killed && p.port === port
  );
}

/** The llama.cpp servers model-servers.js sees, minus the panel's own, in the shape the tab draws. */
async function externalServers(ownPorts) {
  const { servers } = await require('./model-servers').status();
  return servers.filter(s => /^llama/.test(s.kind || '')).filter(s => { try { return !ownPorts.includes(Number(new URL(s.url).port)); } catch { return true; } })
    .map(s => ({ provider: s.provider, label: s.label, url: s.url, router: s.kind === 'llama.cpp router', build: null, ctx: null,
      models: (s.models || []).map(m => ({ id: m.id, state: m.state, ctx: m.ctx || null })), doca: (s.doca || []).length, foreign: !!s.foreign }));
}

/** GET /api/models/llamacpp/list */
async function handleList(_req, res) {
  const instances = loadInstances();
  // And the llama-servers running without the panel, so the tab shows what is there: found by model-servers.js, the
  // one discovery the sidebar and system_status use too (audit 2026-10-06 coh F10), or by each one's /props
  // (models-llamacpp-external.js), the older path kept beside it (CONSTITUTION W14; features/data/alternatives.js).
  const own = instances.map(i => Number(i.port));
  const via = require('./settings-schema').value('llamacpp.discovery') === 'props' ? 'props' : 'servers';
  require('./features/usage').count(`llamacpp-external:${via}`);
  const external = await (via === 'props' ? require('./models-llamacpp-external').find(own) : externalServers(own)).catch(() => []);
  res.json({ instances: instances.map(instanceStatus), external, via });
}

/** GET /api/models/llamacpp/status */
function handleStatus(_req, res) {
  const instances = loadInstances();
  const result = {};
  for (const inst of instances) {
    const proc = _procs[inst.id];
    result[inst.id] = {
      running: !!(proc && proc.child && !proc.child.killed),
      pid:     proc?.child?.pid || null,
      port:    inst.port,
    };
  }
  res.json({ status: result });
}

/** POST /api/models/llamacpp/config — create or update an instance */
function handleConfig(req, res) {
  const { id, name, modelPath, port, nGpuLayers, ctxSize, mmprojPath, jinja } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const instances = loadInstances();
  const idx = instances.findIndex(i => i.id === id);
  // What the form does not show (the vision projector, --jinja, where a Hugging Face install came from) is kept as it
  // was unless the request names it: a save from the form used to rebuild the entry from its five fields.
  const was = idx >= 0 ? instances[idx] : {};
  const entry = {
    ...was,
    id,
    name:        name       || id,
    modelPath:   modelPath  || '',
    port:        parseInt(port)        || 11435,
    nGpuLayers:  nGpuLayers === 'auto' ? 'auto' : Number.isFinite(parseInt(nGpuLayers)) ? parseInt(nGpuLayers) : 999,
    ctxSize:     parseInt(ctxSize)    || 8192,
    ...(mmprojPath !== undefined ? { mmprojPath: String(mmprojPath || '') } : {}),
    ...(jinja !== undefined ? { jinja: !!jinja } : {}),
  };

  if (idx >= 0) {
    instances[idx] = entry;
  } else {
    instances.push(entry);
  }
  saveInstances(instances);
  res.json({ ok: true, instance: instanceStatus(entry) });
}

/** DELETE /api/models/llamacpp/:id — remove instance (stops if running) */
function handleDelete(req, res) {
  const { id } = req.params;
  const proc = _procs[id];
  if (proc && proc.child && !proc.child.killed) {
    proc.child.kill('SIGTERM');
    delete _procs[id];
  }
  const instances = loadInstances().filter(i => i.id !== id);
  saveInstances(instances);
  res.json({ ok: true });
}

/** The llama-server command line for an instance, by argv (never a shell string). */
function argsFor(inst) {
  return [
    '-m', inst.modelPath,
    '--host', BIND_HOST,
    '--port', String(inst.port),
    // `auto`: no -ngl, so llama.cpp fits the layers itself (its default); a number is the person's.
    ...(inst.nGpuLayers === 'auto' ? [] : ['-ngl', String(inst.nGpuLayers ?? 999)]),
    '-c', String(inst.ctxSize || 8192),
    // --jinja: the GGUF's own chat template, which is what makes tool calls work (llamacpp-hf/ sets it).
    ...(inst.jinja ? ['--jinja'] : []),
    ...(inst.mmprojPath && fs.existsSync(inst.mmprojPath) ? ['--mmproj', inst.mmprojPath] : []),
  ];
}

/** POST /api/models/llamacpp/start — start a llama-server instance (SSE) */
function handleStart(req, res) {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const instances = loadInstances();
  const inst = instances.find(i => i.id === id);
  if (!inst) return res.status(404).json({ error: `Instance "${id}" not found` });

  if (_procs[id]?.child && !_procs[id].child.killed) {
    return res.status(409).json({ error: `Instance "${id}" is already running` });
  }

  if (!inst.modelPath || !fs.existsSync(inst.modelPath)) {
    return res.status(400).json({ error: `Model file not found: ${inst.modelPath}` });
  }

  if (isPortTaken(inst.port, id)) {
    return res.status(409).json({ error: `Port ${inst.port} is already in use by another llama.cpp instance` });
  }

  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  const args = argsFor(inst);

  const cmdDisplay = `llama-server ${args.join(' ')}`;
  sseWrite({ status: `Starting llama-server…\n$ ${cmdDisplay}\n` });

  const child = spawn('llama-server', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  _procs[id] = { child, port: inst.port, startedAt: new Date().toISOString() };

  let started = false;

  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    sseWrite({ status: text });
    if (!started && (text.includes('listening') || text.includes('server is listening'))) {
      started = true;
      sseWrite({ done: true, ok: true, status: `\n✓ llama-server running on http://${advertiseHost()}:${inst.port}/v1\n` });
      registerEndpoint(inst);
      res.end();
    }
  });

  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    sseWrite({ status: text });
    if (!started && (text.includes('listening') || text.includes('server is listening'))) {
      started = true;
      sseWrite({ done: true, ok: true, status: `\n✓ llama-server running on http://${advertiseHost()}:${inst.port}/v1\n` });
      registerEndpoint(inst);
      res.end();
    }
  });

  child.on('close', (code, signal) => {
    delete _procs[id];
    if (!started) {
      const msg = code !== null ? `✗ llama-server exited with code ${code}` : `✗ Killed (${signal || 'unknown'})`;
      sseWrite({ done: true, ok: false, status: msg });
      res.end();
    }
  });

  child.on('error', err => {
    delete _procs[id];
    if (!started) {
      sseWrite({ done: true, ok: false, status: `Error: ${err.message}. Is llama-server installed and in PATH?` });
      res.end();
    }
  });

  const startTimeout = setTimeout(() => {
    if (!started) {
      started = true;
      sseWrite({ done: true, ok: true, status: `\n✓ llama-server started (port ${inst.port}), loading model…\n` });
      registerEndpoint(inst);
      res.end();
    }
  }, 30000);

  child.on('close', () => clearTimeout(startTimeout));
  child.on('error', () => clearTimeout(startTimeout));

  res.on('close', () => clearTimeout(startTimeout));
}

/** POST /api/models/llamacpp/stop */
function handleStop(req, res) {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const proc = _procs[id];
  if (!proc || !proc.child || proc.child.killed) {
    delete _procs[id];
    return res.json({ ok: true, wasRunning: false });
  }

  proc.child.kill('SIGTERM');
  const timeout = setTimeout(() => {
    try { proc.child.kill('SIGKILL'); } catch {}
  }, 5000);

  proc.child.on('close', () => {
    clearTimeout(timeout);
    delete _procs[id];
  });

  res.json({ ok: true, wasRunning: true });
}

/** POST /api/models/llamacpp/restart */
function handleRestart(req, res) {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const proc = _procs[id];
  if (proc && proc.child && !proc.child.killed) {
    proc.child.kill('SIGTERM');
    const timeout = setTimeout(() => {
      try { proc.child.kill('SIGKILL'); } catch {}
    }, 5000);

    proc.child.on('close', () => {
      clearTimeout(timeout);
      delete _procs[id];
      handleStart({ body: { id } }, res);
    });
  } else {
    delete _procs[id];
    handleStart({ body: { id } }, res);
  }
}

/** POST /api/models/llamacpp/health — check if an instance responds */
async function handleHealth(req, res) {
  const { id } = req.body;
  const instances = loadInstances();
  const inst = instances.find(i => i.id === id);
  if (!inst) return res.status(404).json({ error: 'Instance not found' });

  try {
    const r = await fetch(`http://127.0.0.1:${inst.port}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    res.json({ healthy: true, models: data });
  } catch (e) {
    res.json({ healthy: false, error: e.message });
  }
}

function registerEndpoint(inst) {
  try {
    require('./provider-keys').set(`llamacpp-${inst.id}`, {
      baseUrl: `http://${advertiseHost()}:${inst.port}/v1`,
      apiKey:  '',
      api:     'openai-chat-completions',
      models:  [],
    });
  } catch {}
}

function getRunningInstances() {
  const instances = loadInstances();
  return instances
    .filter(inst => _procs[inst.id]?.child && !_procs[inst.id].child.killed)
    .map(inst => ({
      id:       inst.id,
      name:     inst.name,
      port:     inst.port,
      pid:      _procs[inst.id].child.pid,
      endpoint: `http://${advertiseHost()}:${inst.port}/v1`,
    }));
}

/** Add or replace one instance (llamacpp-hf/install.js): a free id and port are the caller's to choose. */
function saveInstance(entry) {
  const list = loadInstances().filter(i => i.id !== entry.id);
  saveInstances([...list, entry]);
  return instanceStatus(entry);
}

module.exports = {
  saveInstance,
  argsFor,
  handleList,
  handleStatus,
  handleConfig,
  handleDelete,
  handleStart,
  handleStop,
  handleRestart,
  handleHealth,
  getRunningInstances,
  loadInstances,
};

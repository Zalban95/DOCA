'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

const { CONFIG_PATH } = require('./paths');
const { loadPrefs, savePrefs, sseHeaders } = require('./utils');

const PREFS_KEY      = 'llamacpp';
const BIND_HOST      = '0.0.0.0';
const INTERNAL_HOST  = '172.18.0.1';

const DEFAULT_INSTANCE = {
  id:          'nemotron-cascade',
  name:        'Nemotron Cascade 2 30B',
  modelPath:   '/media/al/NewVolume/models/nemotron-cascade-2/Nemotron-Cascade-2-30B-A3B.Q4_K_M.gguf',
  port:        11435,
  nGpuLayers:  999,
  ctxSize:     8192,
};

const _procs = {};

function loadInstances() {
  const prefs = loadPrefs();
  const cfg   = prefs[PREFS_KEY] || {};
  let instances = cfg.instances || [];
  if (!instances.length) {
    instances = [{ ...DEFAULT_INSTANCE }];
    cfg.instances = instances;
    prefs[PREFS_KEY] = cfg;
    savePrefs(prefs);
  }
  return instances;
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
    endpoint: `http://${INTERNAL_HOST}:${inst.port}/v1`,
  };
}

function isPortTaken(port, excludeId) {
  return Object.entries(_procs).some(([id, p]) =>
    id !== excludeId && p.child && !p.child.killed && p.port === port
  );
}

/** GET /api/models/llamacpp/list */
function handleList(_req, res) {
  const instances = loadInstances();
  res.json({
    instances: instances.map(instanceStatus),
  });
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
  const { id, name, modelPath, port, nGpuLayers, ctxSize } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const instances = loadInstances();
  const idx = instances.findIndex(i => i.id === id);
  const entry = {
    id,
    name:        name       || id,
    modelPath:   modelPath  || '',
    port:        parseInt(port)        || 11435,
    nGpuLayers:  Number.isFinite(parseInt(nGpuLayers)) ? parseInt(nGpuLayers) : 999,
    ctxSize:     parseInt(ctxSize)    || 8192,
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

  const args = [
    '-m', inst.modelPath,
    '--host', BIND_HOST,
    '--port', String(inst.port),
    '-ngl', String(inst.nGpuLayers ?? 999),
    '-c', String(inst.ctxSize || 8192),
  ];

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
      sseWrite({ done: true, ok: true, status: `\n✓ llama-server running on http://${INTERNAL_HOST}:${inst.port}/v1\n` });
      registerEndpoint(inst);
      res.end();
    }
  });

  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    sseWrite({ status: text });
    if (!started && (text.includes('listening') || text.includes('server is listening'))) {
      started = true;
      sseWrite({ done: true, ok: true, status: `\n✓ llama-server running on http://${INTERNAL_HOST}:${inst.port}/v1\n` });
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
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg.toolProviders) cfg.toolProviders = {};
    cfg.toolProviders[`llamacpp-${inst.id}`] = {
      baseUrl: `http://${INTERNAL_HOST}:${inst.port}`,
      apiKey:  '',
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
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
      endpoint: `http://${INTERNAL_HOST}:${inst.port}/v1`,
    }));
}

module.exports = {
  handleList,
  handleStatus,
  handleConfig,
  handleDelete,
  handleStart,
  handleStop,
  handleRestart,
  handleHealth,
  getRunningInstances,
};

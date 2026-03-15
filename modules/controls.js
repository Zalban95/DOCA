'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { COMPOSE_DIR } = require('./paths');
const { run, sseHeaders, loadModelsPrefs } = require('./utils');

/** GET /api/status — system overview: Docker, GPU, CPU/RAM, Ollama, HuggingFace */
async function handleStatus(req, res) {
  const mp = loadModelsPrefs();
  const ollamaUrl = (mp.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');

  const [dockerResult, gpuResult, ollamaTagsResult, ollamaPsResult] = await Promise.allSettled([
    run(`docker ps --format '{{json .}}'`),
    run('nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits'),
    run(`curl -s ${ollamaUrl}/api/tags`),
    run(`curl -s ${ollamaUrl}/api/ps`),
  ]);

  let containers = [];
  if (dockerResult.status === 'fulfilled') {
    containers = dockerResult.value.stdout.trim().split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }

  let gpu = null;
  if (gpuResult.status === 'fulfilled') {
    gpu = gpuResult.value.stdout.trim().split('\n').map(l => {
      const p = l.split(', ').map(s => s.trim());
      return { name: p[0], temp: p[1], util: p[2], memUsed: p[3], memTotal: p[4] };
    });
  }

  const cpus    = os.cpus();
  const loadAvg = os.loadavg();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  const cpuPct   = Math.round((1 - totalIdle / totalTick) * 100);
  const ramTotal = Math.round(os.totalmem() / 1e6);
  const ramUsed  = Math.round((os.totalmem() - os.freemem()) / 1e6);

  const system = {
    cpuPct,
    load1:  Math.round(loadAvg[0] * 100) / 100,
    load5:  Math.round(loadAvg[1] * 100) / 100,
    ramUsed,
    ramTotal,
  };

  let models = [];
  if (ollamaTagsResult.status === 'fulfilled') {
    try {
      const data = JSON.parse(ollamaTagsResult.value.stdout);
      models = (data.models || []).map(m => ({ name: m.name, size: m.size }));
    } catch {}
  }

  let loadedModels = [];
  if (ollamaPsResult.status === 'fulfilled') {
    try {
      const data = JSON.parse(ollamaPsResult.value.stdout);
      loadedModels = (data.models || []).map(m => ({
        name:      m.name,
        size:      m.size,
        sizeVram:  m.size_vram || 0,
        expiresAt: m.expires_at || null,
      }));
    } catch {}
  }

  const home       = process.env.HOME || os.homedir();
  const hfCacheDir = mp.hf?.cacheDir || path.join(home, '.cache', 'huggingface', 'hub');
  let hfModels = [];
  try {
    if (fs.existsSync(hfCacheDir)) {
      hfModels = fs.readdirSync(hfCacheDir)
        .filter(e => e.startsWith('models--'))
        .map(e => {
          const parts = e.split('--');
          return { repo_id: parts.length >= 3 ? `${parts[1]}/${parts.slice(2).join('/')}` : e };
        });
    }
  } catch {}

  res.json({ containers, gpu, system, models, loadedModels, hfModels, time: new Date().toISOString() });
}

/** POST /api/action — start / stop / restart Docker Compose */
async function handleAction(req, res) {
  const { action } = req.body;
  const cmds = {
    start:   'docker compose up -d',
    stop:    'docker compose down',
    restart: 'docker compose down && docker compose up -d',
  };
  if (!cmds[action]) return res.status(400).json({ error: 'Unknown action' });
  try {
    const result = await run(cmds[action]);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.error || e.message, stderr: e.stderr });
  }
}

/** GET /api/logs — SSE stream of Docker Compose logs */
function handleLogs(req, res) {
  sseHeaders(res);
  const tail  = req.query.tail || '100';
  const child = spawn('docker', ['compose', 'logs', '--follow', '--tail', tail], { cwd: COMPOSE_DIR });
  const emit  = line => line && res.write(`data: ${JSON.stringify(line)}\n\n`);
  child.stdout.on('data', d => d.toString().split('\n').forEach(emit));
  child.stderr.on('data', d => d.toString().split('\n').forEach(l => emit(l && '[stderr] ' + l)));
  child.on('error', err => { emit(`[error] ${err.message}`); res.end(); });
  req.on('close', () => child.kill());
}

module.exports = { handleStatus, handleAction, handleLogs };

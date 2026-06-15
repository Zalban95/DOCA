'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { COMPOSE_DIR } = require('./paths');
const { run, sseHeaders, loadModelsPrefs } = require('./utils');
const { getRunningInstances: getLlamaCppRunning } = require('./models-llamacpp');

/** Snapshot cumulative CPU tick counters per logical core. */
function cpuSnapshot() {
  return os.cpus().map(c => {
    const t = c.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    return { idle: t.idle, total };
  });
}

/** Sample CPU usage over a short window so the % reflects *current* load
 *  rather than the cumulative since-boot average. Returns per-core + overall %. */
async function sampleCpu(windowMs = 200) {
  const a = cpuSnapshot();
  await new Promise(r => setTimeout(r, windowMs));
  const b = cpuSnapshot();
  const cores = a.map((s1, i) => {
    const s2     = b[i] || s1;
    const idle   = s2.idle  - s1.idle;
    const total  = s2.total - s1.total;
    return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : 0;
  });
  const cpuPct = cores.length
    ? Math.round(cores.reduce((sum, p) => sum + p, 0) / cores.length)
    : 0;
  return { cpuPct, cores };
}

/** Best-effort CPU package temperature (°C) from the Linux thermal subsystem. */
function readCpuTemp() {
  const base = '/sys/class/thermal';
  try {
    const zones = fs.readdirSync(base).filter(z => z.startsWith('thermal_zone'));
    // Prefer a zone whose type looks like a CPU/package sensor.
    const preferred = zones.find(z => {
      try {
        const type = fs.readFileSync(path.join(base, z, 'type'), 'utf8').trim();
        return /x86_pkg_temp|coretemp|cpu|k10temp|zenpower|soc/i.test(type);
      } catch { return false; }
    });
    const zone = preferred || zones[0];
    if (zone) {
      const milli = parseInt(fs.readFileSync(path.join(base, zone, 'temp'), 'utf8').trim(), 10);
      if (Number.isFinite(milli)) return Math.round(milli / 1000);
    }
  } catch {}
  return null;
}

/** Parse one numeric nvidia-smi field; returns null for blank / "[N/A]". */
function smiNum(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /n\/?a|not supported|unknown/i.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** GET /api/status — system overview: Docker, GPU, CPU/RAM, Ollama, HuggingFace */
async function handleStatus(req, res) {
  const mp = loadModelsPrefs();
  const ollamaUrl = (mp.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');

  const [dockerResult, gpuResult, ollamaTagsResult, ollamaPsResult, cpuSample] = await Promise.all([
    Promise.allSettled([
      run(`docker ps --format '{{json .}}'`),
      run('nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,power.limit,fan.speed,clocks.sm --format=csv,noheader,nounits'),
      run(`curl -s ${ollamaUrl}/api/tags`),
      run(`curl -s ${ollamaUrl}/api/ps`),
    ]),
    sampleCpu(),
  ]).then(([settled, sample]) => [...settled, sample]);

  let containers = [];
  if (dockerResult.status === 'fulfilled') {
    containers = dockerResult.value.stdout.trim().split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }

  let gpu = null;
  if (gpuResult.status === 'fulfilled') {
    gpu = gpuResult.value.stdout.trim().split('\n').filter(Boolean).map(l => {
      const p = l.split(',').map(s => s.trim());
      return {
        name:       p[0],
        temp:       p[1],
        util:       p[2],
        memUsed:    p[3],
        memTotal:   p[4],
        powerDraw:  smiNum(p[5]),
        powerLimit: smiNum(p[6]),
        fan:        smiNum(p[7]),
        clockSm:    smiNum(p[8]),
      };
    });
  }

  const loadAvg = os.loadavg();
  const { cpuPct, cores } = cpuSample;
  const cpuTemp = readCpuTemp();

  let ramTotal, ramUsed;
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const val = key => {
      const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
      return m ? parseInt(m[1], 10) : NaN;
    };
    const totalKB = val('MemTotal');
    const availKB = val('MemAvailable');
    ramTotal = Math.round(totalKB / 1e3);
    ramUsed  = Math.round((totalKB - availKB) / 1e3);
  } catch {
    ramTotal = Math.round(os.totalmem() / 1e6);
    ramUsed  = Math.round((os.totalmem() - os.freemem()) / 1e6);
  }

  const system = {
    cpuPct,
    cores,
    coreCount: cores.length || os.cpus().length,
    cpuTemp,
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

  const llamacppRunning = getLlamaCppRunning();

  res.json({ containers, gpu, system, models, loadedModels, hfModels, llamacppRunning, time: new Date().toISOString() });
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

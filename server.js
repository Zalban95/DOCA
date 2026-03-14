/**
 * OPENCLAW PANEL — server.js
 * Modules: status, action, logs, config (multi-file), keys, skills, setup, snapshots,
 *          files (upload/download), claude code, chat
 */
'use strict';

const express = require('express');
const http    = require('http');
const { exec, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const multer = require('multer');
const { WebSocketServer } = require('ws');

let pty = null;
try { pty = require('node-pty'); } catch (e) {
  console.warn('[terminal] node-pty not available — run: npm install node-pty');
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Paths ──────────────────────────────────────────────────────────────────
const COMPOSE_DIR     = process.env.COMPOSE_DIR     || '/home/al/openclaw';
const CONFIG_PATH     = process.env.CONFIG_PATH     || '/home/al/.openclaw/openclaw.json';
const SKILLS_DIR      = process.env.SKILLS_DIR      || '/home/al/.openclaw/workspace/skills';
const WORKSPACE_DIR   = process.env.WORKSPACE_DIR   || '/home/al/.openclaw/workspace';
const SETUP_DIR       = process.env.SETUP_DIR       || '/home/al';
const SNAPSHOT_SCRIPT = process.env.SNAPSHOT_SCRIPT || '/home/al/snapshot-agent.sh';
const RESTORE_SCRIPT  = process.env.RESTORE_SCRIPT  || '/home/al/restore-agent.sh';
const SNAPSHOT_DIR    = process.env.SNAPSHOT_DIR    || '/media/al/NewVolume/openclaw-snapshots';
const PORT            = process.env.PORT            || 4242;
const PREFS_FILE      = path.join(__dirname, '.dashboard-prefs.json');

// ─── Multi-file config registry ──────────────────────────────────────────────
const CONFIG_REGISTRY = {
  openclaw:          CONFIG_PATH,
  soul:              '/home/al/.openclaw/SOUL.md',
  compose:           '/home/al/openclaw/docker-compose.yml',
  aider:             '/home/al/.aider.conf.yml',
  env:               '/home/al/openclaw/.env',
  'modelfile-qwen':  '/home/al/.ollama/Modelfile.qwen-coder-gpu',
  'modelfile-qwen3': '/home/al/.ollama/Modelfile.qwen3',
  setup:             '/home/al/setup-openclaw.sh',
  snapshot:          '/home/al/snapshot-agent.sh',
  restore:           '/home/al/restore-agent.sh',
};

// ─── File manager allowed roots ───────────────────────────────────────────────
const FM_ALLOWED_ROOTS = [
  '/home/al',
  '/media/al',
  '/tmp',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: cwd || COMPOSE_DIR, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject({ error: err.message, stderr, stdout });
      else resolve({ stdout, stderr });
    });
  });
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

/** Return true if path is within an allowed root */
function fmSafe(p) {
  const abs = path.resolve(p);
  return FM_ALLOWED_ROOTS.some(root => abs === root || abs.startsWith(root + '/'));
}

// ─── STATUS ──────────────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  const mp = loadModelsPrefs ? loadModelsPrefs() : {};
  const ollamaUrl = (mp.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');

  const [dockerResult, gpuResult, ollamaTagsResult, ollamaPsResult] = await Promise.allSettled([
    run(`docker ps --format '{{json .}}'`),
    run('nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits'),
    run(`curl -s ${ollamaUrl}/api/tags`),
    run(`curl -s ${ollamaUrl}/api/ps`),
  ]);

  // All running Docker containers (not just compose)
  let containers = [];
  if (dockerResult.status === 'fulfilled') {
    containers = dockerResult.value.stdout.trim().split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }

  // GPU
  let gpu = null;
  if (gpuResult.status === 'fulfilled') {
    gpu = gpuResult.value.stdout.trim().split('\n').map(l => {
      const p = l.split(', ').map(s => s.trim());
      return { name: p[0], temp: p[1], util: p[2], memUsed: p[3], memTotal: p[4] };
    });
  }

  // CPU + RAM via os module (always available, no extra binary)
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

  // Installed Ollama models
  let models = [];
  if (ollamaTagsResult.status === 'fulfilled') {
    try {
      const data = JSON.parse(ollamaTagsResult.value.stdout);
      models = (data.models || []).map(m => ({ name: m.name, size: m.size }));
    } catch {}
  }

  // Currently loaded (in-memory) Ollama models
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

  res.json({ containers, gpu, system, models, loadedModels, time: new Date().toISOString() });
});

// ─── ACTIONS ─────────────────────────────────────────────────────────────────
app.post('/api/action', async (req, res) => {
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
});

// ─── LOGS SSE ────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  sseHeaders(res);
  const tail  = req.query.tail || '100';
  const child = spawn('docker', ['compose', 'logs', '--follow', '--tail', tail], { cwd: COMPOSE_DIR });
  const emit  = line => line && res.write(`data: ${JSON.stringify(line)}\n\n`);
  child.stdout.on('data', d => d.toString().split('\n').forEach(emit));
  child.stderr.on('data', d => d.toString().split('\n').forEach(l => emit(l && '[stderr] ' + l)));
  req.on('close', () => child.kill());
});

// ─── MULTI-FILE CONFIG ────────────────────────────────────────────────────────

// GET /api/configs/:id  — read any registered config file
app.get('/api/configs/:id', (req, res) => {
  const filePath = CONFIG_REGISTRY[req.params.id];
  if (!filePath) return res.status(404).json({ error: 'Unknown config id' });
  try {
    const content = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf8')
      : '';
    res.json({ content, path: filePath });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/configs/:id  — write a registered config file
app.post('/api/configs/:id', (req, res) => {
  const filePath = CONFIG_REGISTRY[req.params.id];
  if (!filePath) return res.status(404).json({ error: 'Unknown config id' });
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'No content' });
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, filePath + '.bak');
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true, backup: filePath + '.bak' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy: GET /api/config  (keeps old panel working during transition)
app.get('/api/config', (req, res) => {
  try { res.json({ config: fs.readFileSync(CONFIG_PATH, 'utf8') }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config', (req, res) => {
  const { config } = req.body;
  if (!config) return res.status(400).json({ error: 'No config provided' });
  try {
    JSON.parse(config);
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, config, 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API KEYS ─────────────────────────────────────────────────────────────────
app.get('/api/keys', (req, res) => {
  try {
    const cfg       = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const providers = cfg?.models?.providers || {};
    const result    = {};
    for (const [name, p] of Object.entries(providers)) {
      const key = p.apiKey || '';
      result[name] = {
        baseUrl:      p.baseUrl || '',
        apiKeyMasked: key && key !== 'ollama'
          ? key.slice(0, 4) + '••••••••' + key.slice(-4)
          : key,
        hasKey: !!key && key !== 'ollama',
        models: (p.models || []).map(m => m.id || m.name || m),
      };
    }
    res.json({ providers: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/keys', (req, res) => {
  const { provider, apiKey, baseUrl } = req.body;
  if (!provider) return res.status(400).json({ error: 'provider required' });
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg.models) cfg.models = {};
    if (!cfg.models.providers) cfg.models.providers = {};
    if (!cfg.models.providers[provider])
      cfg.models.providers[provider] = { api: 'openai-responses', models: [] };
    if (apiKey)  cfg.models.providers[provider].apiKey  = apiKey;
    if (baseUrl) cfg.models.providers[provider].baseUrl = baseUrl;
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/keys/add-provider', (req, res) => {
  const { name, baseUrl, apiKey, api, models: pm } = req.body;
  if (!name || !baseUrl) return res.status(400).json({ error: 'name and baseUrl required' });
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg.models) cfg.models = {};
    if (!cfg.models.providers) cfg.models.providers = {};
    cfg.models.providers[name] = { baseUrl, apiKey: apiKey || '', api: api || 'openai-responses', models: pm || [] };
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/keys/:name', (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg?.models?.providers?.[req.params.name])
      delete cfg.models.providers[req.params.name];
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tool Providers — same structure as regular providers, stored under cfg.toolProviders
app.get('/api/keys/tool-providers', (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const providers = cfg.toolProviders || {};
    const result = {};
    for (const [name, p] of Object.entries(providers)) {
      const key = p.apiKey || '';
      result[name] = {
        baseUrl:      p.baseUrl || '',
        apiKeyMasked: key ? key.slice(0, 4) + '••••••••' + key.slice(-4) : '',
        hasKey:       !!key,
      };
    }
    res.json({ providers: result });
  } catch (e) { res.json({ providers: {} }); }
});

app.post('/api/keys/tool-providers', (req, res) => {
  const { provider, apiKey, baseUrl } = req.body;
  if (!provider) return res.status(400).json({ error: 'provider required' });
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg.toolProviders) cfg.toolProviders = {};
    if (!cfg.toolProviders[provider]) cfg.toolProviders[provider] = { baseUrl: '' };
    if (apiKey  !== undefined) cfg.toolProviders[provider].apiKey  = apiKey;
    if (baseUrl !== undefined) cfg.toolProviders[provider].baseUrl = baseUrl;
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/keys/tool-providers/add', (req, res) => {
  const { name, baseUrl, apiKey } = req.body;
  if (!name || !baseUrl) return res.status(400).json({ error: 'name and baseUrl required' });
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg.toolProviders) cfg.toolProviders = {};
    cfg.toolProviders[name] = { baseUrl, apiKey: apiKey || '' };
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/keys/tool-providers/:name', (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg?.toolProviders?.[req.params.name]) delete cfg.toolProviders[req.params.name];
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// General prefs API
app.get('/api/prefs', (req, res) => res.json(loadPrefs()));

app.post('/api/prefs', (req, res) => {
  try {
    const prefs = loadPrefs();
    const updated = { ...prefs, ...req.body };
    fs.writeFileSync(PREFS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SKILLS ───────────────────────────────────────────────────────────────────

function readSkillMeta(sp) {
  let description = '', version = '';
  for (const fname of ['package.json', 'skill.json', 'manifest.json']) {
    const fp = path.join(sp, fname);
    if (fs.existsSync(fp)) {
      try { const d = JSON.parse(fs.readFileSync(fp, 'utf8')); description = d.description || ''; version = d.version || ''; }
      catch {}
      break;
    }
  }
  if (!description) {
    for (const fname of ['README.md', 'readme.md']) {
      const fp = path.join(sp, fname);
      if (fs.existsSync(fp)) {
        const lines = fs.readFileSync(fp, 'utf8').split('\n');
        description = lines.find(l => l.trim() && !l.startsWith('#'))?.slice(0, 120) || '';
        break;
      }
    }
  }
  return { description, version };
}

app.get('/api/skills', (req, res) => {
  try {
    if (!fs.existsSync(SKILLS_DIR)) return res.json({ skills: [] });
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skills  = entries.filter(e => e.isDirectory()).map(e => {
      const isDisabled = e.name.startsWith('.') && e.name.endsWith('.disabled');
      const realName   = isDisabled ? e.name.slice(1, -9) : e.name;
      const sp = path.join(SKILLS_DIR, e.name);
      const { description, version } = readSkillMeta(sp);
      return { name: realName, dirName: e.name, version, description, enabled: !isDisabled };
    });
    res.json({ skills });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/skills/:name', (req, res) => {
  const name = req.params.name;
  const sp = path.join(SKILLS_DIR, name);
  const disabledPath = path.join(SKILLS_DIR, `.${name}.disabled`);
  const actualPath = fs.existsSync(sp) ? sp : fs.existsSync(disabledPath) ? disabledPath : null;
  if (!actualPath) return res.status(404).json({ error: 'Not found' });
  try {
    const files = fs.readdirSync(actualPath).map(f => {
      const s = fs.statSync(path.join(actualPath, f));
      return { name: f, size: s.size, isDir: s.isDirectory() };
    });
    let readme = '';
    const readmeName = files.find(f => f.name.toLowerCase() === 'readme.md');
    if (readmeName) readme = fs.readFileSync(path.join(actualPath, readmeName.name), 'utf8');
    const { description, version } = readSkillMeta(actualPath);
    const enabled = actualPath === sp;
    res.json({ name, enabled, version, description, readme, files, path: actualPath });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/skills/:name/toggle', (req, res) => {
  const name = req.params.name;
  const sp = path.join(SKILLS_DIR, name);
  const disabledPath = path.join(SKILLS_DIR, `.${name}.disabled`);
  try {
    if (fs.existsSync(sp)) {
      fs.renameSync(sp, disabledPath);
      res.json({ ok: true, enabled: false });
    } else if (fs.existsSync(disabledPath)) {
      fs.renameSync(disabledPath, sp);
      res.json({ ok: true, enabled: true });
    } else {
      res.status(404).json({ error: 'Skill not found' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/skills/install', (req, res) => {
  const { skill, force } = req.body;
  if (!skill) return res.status(400).json({ error: 'skill name required' });
  sseHeaders(res);
  const cmd   = `npx clawhub install ${skill}${force ? ' --force' : ''}`;
  const child = spawn('bash', ['-c', cmd], { cwd: WORKSPACE_DIR });
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.on('close', code => { res.write(`data: ${JSON.stringify(`[exit ${code}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
});

app.delete('/api/skills/:name', (req, res) => {
  const name = req.params.name;
  const sp = path.join(SKILLS_DIR, name);
  const disabledPath = path.join(SKILLS_DIR, `.${name}.disabled`);
  const actualPath = fs.existsSync(sp) ? sp : fs.existsSync(disabledPath) ? disabledPath : null;
  if (!actualPath) return res.status(404).json({ error: 'Not found' });
  try { fs.rmSync(actualPath, { recursive: true, force: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Search skills online via clawhub, fallback to GitHub search API
app.get('/api/skills/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  const githubFallback = () => {
    const url = `https://api.github.com/search/repositories?q=topic:clawhub-skill+${encodeURIComponent(q)}&sort=stars&per_page=30`;
    const https = require('https');
    https.get(url, { headers: { 'User-Agent': 'openclaw-dashboard/1.0' } }, ghRes => {
      let body = '';
      ghRes.on('data', d => body += d);
      ghRes.on('end', () => {
        try {
          const data = JSON.parse(body);
          const items = data.items || [];
          const results = items.map(r => ({
            name:        r.full_name,
            description: r.description || '',
            version:     '',
            official:    r.owner?.login === 'clawhub',
            community:   r.owner?.login !== 'clawhub',
            source:      'github',
            stars:       r.stargazers_count,
            url:         r.html_url,
          }));
          res.json({ results, via: 'github' });
        } catch (e) {
          res.json({ results: [], error: `GitHub search failed: ${e.message}` });
        }
      });
    }).on('error', e => res.json({ results: [], error: `GitHub search error: ${e.message}` }));
  };

  exec(`npx clawhub search ${JSON.stringify(q)} --json 2>/dev/null`, { timeout: 15000 }, (err, stdout) => {
    if (err || !stdout.trim()) return githubFallback();
    try {
      const parsed = JSON.parse(stdout);
      const results = (Array.isArray(parsed) ? parsed : parsed.results || []).map(s => ({
        name:        s.name        || s.id || '',
        description: s.description || '',
        version:     s.version     || '',
        official:    !!(s.official || s.verified),
        community:   !!(s.community),
        source:      s.source      || s.registry || 'clawhub',
      }));
      res.json({ results, via: 'clawhub' });
    } catch {
      githubFallback();
    }
  });
});

// ─── SETUP SCRIPTS ────────────────────────────────────────────────────────────
const ALLOWED_SCRIPTS = ['setup-openclaw.sh', 'setup-phase2.sh', 'snapshot-agent.sh', 'restore-agent.sh'];

app.get('/api/setup/scripts', (req, res) => {
  const scripts = ALLOWED_SCRIPTS.map(name => {
    const fullPath = path.join(SETUP_DIR, name);
    const exists   = fs.existsSync(fullPath);
    let size = 0, modified = null;
    if (exists) { const s = fs.statSync(fullPath); size = s.size; modified = s.mtime.toISOString(); }
    return { name, exists, size, modified };
  });
  res.json({ scripts });
});

app.get('/api/setup/scripts/:name', (req, res) => {
  if (!ALLOWED_SCRIPTS.includes(req.params.name)) return res.status(403).json({ error: 'Not allowed' });
  const fp = path.join(SETUP_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.json({ content: fs.readFileSync(fp, 'utf8') });
});

app.post('/api/setup/scripts/:name', (req, res) => {
  if (!ALLOWED_SCRIPTS.includes(req.params.name)) return res.status(403).json({ error: 'Not allowed' });
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'No content' });
  const fp = path.join(SETUP_DIR, req.params.name);
  try {
    if (fs.existsSync(fp)) fs.copyFileSync(fp, fp + '.bak');
    fs.writeFileSync(fp, content, 'utf8');
    fs.chmodSync(fp, 0o755);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SNAPSHOTS ────────────────────────────────────────────────────────────────

/** Read snapshot settings from prefs, merging with env/defaults */
function loadSnapshotSettings() {
  const prefs = loadPrefs();
  const s = prefs.snapshotSettings || {};
  return {
    snapshotDir:    s.snapshotDir    || SNAPSHOT_DIR,
    snapshotScript: s.snapshotScript || SNAPSHOT_SCRIPT,
    restoreScript:  s.restoreScript  || RESTORE_SCRIPT,
    includePaths:   s.includePaths   || []
  };
}

app.get('/api/snapshots/settings', (req, res) => {
  res.json(loadSnapshotSettings());
});

app.post('/api/snapshots/settings', (req, res) => {
  const { snapshotDir, snapshotScript, restoreScript, includePaths } = req.body;
  const prefs = loadPrefs();
  prefs.snapshotSettings = { snapshotDir, snapshotScript, restoreScript, includePaths };
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/snapshots', (req, res) => {
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
});

app.post('/api/snapshots/create', (req, res) => {
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
    // Built-in tar fallback when no script is configured
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
});

app.post('/api/snapshots/restore', (req, res) => {
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
    // Built-in tar restore fallback
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
});

// ─── FILE MANAGER ─────────────────────────────────────────────────────────────

// GET /api/files/list?path=...
app.get('/api/files/list', (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath || !fmSafe(dirPath)) return res.status(403).json({ error: 'Path not allowed' });
  try {
    if (!fs.existsSync(dirPath)) return res.status(404).json({ error: 'Not found' });
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const names   = fs.readdirSync(dirPath);
    const entries = names.map(name => {
      try {
        const full = path.join(dirPath, name);
        const s    = fs.statSync(full);
        return {
          name,
          isDir: s.isDirectory(),
          size:  s.isDirectory() ? null : s.size,
          mtime: s.mtime.toISOString(),
          mode:  s.mode.toString(8),
        };
      } catch { return { name, isDir: false, size: null, mtime: null, mode: null }; }
    });
    res.json({ entries, path: dirPath });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/files/read?path=...
app.get('/api/files/read', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fmSafe(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  try {
    const s = fs.statSync(filePath);
    if (s.isDirectory()) return res.status(400).json({ error: 'Is a directory' });
    if (s.size > 2 * 1024 * 1024) return res.status(413).json({ error: 'File too large (>2MB)' });
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, size: s.size, mtime: s.mtime.toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/files/write  { path, content }
app.post('/api/files/write', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || !fmSafe(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  if (content === undefined) return res.status(400).json({ error: 'No content' });
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/files/rename  { from, to }
app.post('/api/files/rename', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to || !fmSafe(from) || !fmSafe(to)) return res.status(403).json({ error: 'Path not allowed' });
  try { fs.renameSync(from, to); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/files/delete  { paths: [] }
app.post('/api/files/delete', (req, res) => {
  const { paths } = req.body;
  if (!Array.isArray(paths) || !paths.every(p => fmSafe(p))) return res.status(403).json({ error: 'Path not allowed' });
  const errors = [];
  paths.forEach(p => {
    try { fs.rmSync(p, { recursive: true, force: true }); }
    catch (e) { errors.push(`${p}: ${e.message}`); }
  });
  if (errors.length) return res.status(207).json({ ok: false, errors });
  res.json({ ok: true });
});

// POST /api/files/mkdir  { path }
app.post('/api/files/mkdir', (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath || !fmSafe(dirPath)) return res.status(403).json({ error: 'Path not allowed' });
  try { fs.mkdirSync(dirPath, { recursive: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/files/paste  { op: 'copy'|'cut', paths: [], dest }
app.post('/api/files/paste', (req, res) => {
  const { op, paths, dest } = req.body;
  if (!dest || !fmSafe(dest) || !Array.isArray(paths)) return res.status(403).json({ error: 'Invalid request' });
  if (!paths.every(p => fmSafe(p))) return res.status(403).json({ error: 'Source path not allowed' });

  const errors = [];
  paths.forEach(src => {
    try {
      const base = path.basename(src);
      let target = path.join(dest, base);
      // Avoid overwrite: append _copy suffix
      if (fs.existsSync(target) && src !== target) {
        const ext  = path.extname(base);
        const name = path.basename(base, ext);
        target = path.join(dest, `${name}_copy${ext}`);
      }
      if (op === 'cut') {
        fs.renameSync(src, target);
      } else {
        // Recursive copy
        function cpRecurse(s, d) {
          const st = fs.statSync(s);
          if (st.isDirectory()) {
            fs.mkdirSync(d, { recursive: true });
            fs.readdirSync(s).forEach(f => cpRecurse(path.join(s, f), path.join(d, f)));
          } else {
            fs.copyFileSync(s, d);
          }
        }
        cpRecurse(src, target);
      }
    } catch (e) { errors.push(`${src}: ${e.message}`); }
  });

  if (errors.length) return res.status(207).json({ ok: false, errors });
  res.json({ ok: true });
});

// ─── FILE UPLOAD / DOWNLOAD ───────────────────────────────────────────────────

app.post('/api/files/upload', uploadMw.array('files', 20), (req, res) => {
  const dest = req.body.dest;
  if (!dest || !fmSafe(dest)) return res.status(403).json({ error: 'Destination not allowed' });
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const results = [];
  for (const file of (req.files || [])) {
    let name = file.originalname;
    let target = path.join(dest, name);
    if (fs.existsSync(target)) {
      const ext  = path.extname(name);
      const base = path.basename(name, ext);
      name   = `${base}_${Date.now()}${ext}`;
      target = path.join(dest, name);
    }
    try {
      fs.writeFileSync(target, file.buffer);
      results.push({ name, size: file.size, ok: true });
    } catch (e) {
      results.push({ name: file.originalname, error: e.message });
    }
  }
  res.json({ results });
});

app.get('/api/files/download', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fmSafe(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  try {
    const s = fs.statSync(filePath);
    if (s.isDirectory()) return res.status(400).json({ error: 'Cannot download directory' });
    res.download(filePath, path.basename(filePath));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Serve raw file with correct MIME type (used for media preview)
app.get('/api/files/raw', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fmSafe(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  try {
    const s = fs.statSync(filePath);
    if (s.isDirectory()) return res.status(400).json({ error: 'Cannot serve directory' });
    res.sendFile(path.resolve(filePath));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CODE TOOLS ───────────────────────────────────────────────────────────────

const CODE_TOOLS = [
  { id: 'claude', label: 'Claude Code', cmd: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code', url: 'https://github.com/anthropics/claude-code' },
  { id: 'aider',  label: 'Aider',       cmd: 'aider',  installHint: 'pip install aider-install && aider-install', url: 'https://aider.chat' },
  { id: 'codex',  label: 'OpenAI Codex CLI', cmd: 'codex', installHint: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
  { id: 'goose',  label: 'Goose',       cmd: 'goose',  installHint: 'pip install goose-ai', url: 'https://github.com/block/goose' },
];

app.get('/api/code/tools', async (req, res) => {
  const prefs    = loadPrefs();
  const expanded = prefs.codeExpanded || [];
  const cfgMap   = prefs.codeConfig   || {};

  const results = await Promise.all(CODE_TOOLS.map(t => new Promise(resolve => {
    const detectCmd = [
      `bash -lc "which ${t.cmd} 2>/dev/null"`,
      `{ test -f "$HOME/.npm-global/bin/${t.cmd}" && echo "$HOME/.npm-global/bin/${t.cmd}"; }`,
      `{ test -f "$HOME/.local/bin/${t.cmd}"      && echo "$HOME/.local/bin/${t.cmd}"; }`,
      `{ test -f "/usr/local/bin/${t.cmd}"        && echo "/usr/local/bin/${t.cmd}"; }`,
      `find "$HOME/.nvm/versions" -name "${t.cmd}" -type f 2>/dev/null | grep -m1 .`,
    ].join(' || ');
    exec(detectCmd, { env: { ...process.env, HOME: process.env.HOME || require('os').homedir() } }, (err, stdout) => {
      const detected = !!stdout.trim();
      let version = null;
      if (detected) {
        const bin = stdout.trim().split('\n')[0];
        try {
          const vOut = require('child_process').execSync(
            `bash -lc "'${bin}' --version 2>/dev/null || '${bin}' version 2>/dev/null"`,
            { timeout: 3000 }
          ).toString().trim();
          version = vOut.split('\n')[0].slice(0, 60);
        } catch {}
      }
      resolve({
        ...t,
        detected,
        version,
        pinned:     expanded.includes(t.id),
        configPath: cfgMap[t.id]?.configPath || '',
      });
    });
  })));

  res.json({ tools: results, expanded });
});

app.post('/api/code/tools/pin', (req, res) => {
  const { expanded } = req.body;
  if (!Array.isArray(expanded)) return res.status(400).json({ error: 'expanded must be array' });
  const prefs = loadPrefs();
  prefs.codeExpanded = expanded;
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/code/tools/:id/config', (req, res) => {
  const { id } = req.params;
  const { configPath } = req.body;
  try {
    const prefs = loadPrefs();
    if (!prefs.codeConfig) prefs.codeConfig = {};
    prefs.codeConfig[id] = { configPath: configPath || '' };
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CLAUDE CODE ──────────────────────────────────────────────────────────────

let claudeProc = null;

app.get('/api/claude/status', async (req, res) => {
  try {
    const result = await run('claude --version 2>/dev/null || echo "NOT_FOUND"');
    const out = result.stdout.trim();
    const available = !out.includes('NOT_FOUND');
    res.json({ available, version: available ? out : null, running: !!claudeProc });
  } catch {
    res.json({ available: false, version: null, running: !!claudeProc });
  }
});

app.post('/api/claude/run', (req, res) => {
  const { prompt, workdir } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt' });
  sseHeaders(res);
  const cwd = workdir || WORKSPACE_DIR;
  const child = spawn('claude', ['-p', prompt], {
    cwd,
    env: { ...process.env, TERM: 'dumb' }
  });
  claudeProc = child;
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stdout', text: d.toString() })}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stderr', text: d.toString() })}\n\n`));
  child.on('close', code => {
    res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
    res.end();
    if (claudeProc === child) claudeProc = null;
  });
  req.on('close', () => { child.kill(); if (claudeProc === child) claudeProc = null; });
});

app.post('/api/claude/stop', (req, res) => {
  if (claudeProc) { claudeProc.kill(); claudeProc = null; }
  res.json({ ok: true });
});

// Start claude interactively (no -p flag) and stream output via SSE
app.post('/api/claude/start', (req, res) => {
  if (claudeProc) return res.status(409).json({ error: 'A Claude process is already running' });
  sseHeaders(res);
  const cwd = req.body?.workdir || WORKSPACE_DIR;
  const child = spawn('claude', [], {
    cwd,
    env: { ...process.env, TERM: 'dumb' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  claudeProc = child;
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stdout', text: d.toString() })}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stderr', text: d.toString() })}\n\n`));
  child.on('close', code => {
    res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
    res.end();
    if (claudeProc === child) claudeProc = null;
  });
  child.on('error', err => {
    res.write(`data: ${JSON.stringify({ type: 'stderr', text: `Failed to start claude: ${err.message}` })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', code: 1 })}\n\n`);
    res.end();
    if (claudeProc === child) claudeProc = null;
  });
  res.on('close', () => { child.kill(); if (claudeProc === child) claudeProc = null; });
});

// Send a line of text to the running claude process stdin
app.post('/api/claude/stdin', (req, res) => {
  const { text } = req.body;
  if (!claudeProc) return res.status(404).json({ error: 'No running process' });
  try {
    claudeProc.stdin.write((text ?? '') + '\n');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CHAT (OpenClaw Agent) ────────────────────────────────────────────────────

const chatHistory = [];

/** Resolve ${VAR} in string from process.env */
function resolveEnvVars(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
}

/** Parse openclaw.json tolerantly (strip control chars and trailing commas) */
function parseOpenclawConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    .replace(/[\x00-\x1F\x7F]/g, ' ')    // strip ALL control chars
    .replace(/,(\s*[}\]])/g, '$1');       // strip trailing commas
  return JSON.parse(raw);
}

/** Load gateway URL + auth from openclaw.json for chat completions */
function loadGatewayChatConfig() {
  try {
    const cfg = parseOpenclawConfig();
    const gw = cfg?.gateway || {};
    const http = gw?.http || {};
    const endpoints = http?.endpoints || {};
    const chatEp = endpoints?.chatCompletions || {};
    if (!chatEp.enabled) return null;

    let url;
    const envUrl = process.env.OPENCLAW_GATEWAY_URL;
    if (envUrl) {
      url = envUrl.replace(/\/$/, '') + '/v1/chat/completions';
    } else {
      const port = process.env.OPENCLAW_GATEWAY_PORT || gw?.port || 18789;
      const host = '127.0.0.1';
      url = `http://${host}:${port}/v1/chat/completions`;
    }

    const token = resolveEnvVars(gw?.auth?.token || gw?.auth?.password || '');
    return { url, token: token || null };
  } catch { return null; }
}

app.get('/api/chat/status', (req, res) => {
  let parseError = null, gatewayCfg = null;
  try {
    const cfg = parseOpenclawConfig();
    gatewayCfg = cfg?.gateway || null;
  } catch (e) { parseError = e.message; }

  const cfg = loadGatewayChatConfig();
  res.json({
    gateway: !!cfg,
    chatEnabled: !!cfg,
    parseError,
    gatewayCfg,
    configPath: CONFIG_PATH,
    hint: cfg ? 'Using OpenClaw Gateway' : 'Enable gateway.http.endpoints.chatCompletions in openclaw.json'
  });
});

app.get('/api/chat/history', (req, res) => { res.json({ messages: chatHistory }); });

app.post('/api/chat/clear', (req, res) => { chatHistory.length = 0; res.json({ ok: true }); });

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message' });
  chatHistory.push({ role: 'user', content: message, time: new Date().toISOString() });

  const gw = loadGatewayChatConfig();
  sseHeaders(res);

  if (gw?.url) {
    const messages = chatHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const controller = new AbortController();
      res.on('close', () => controller.abort());

      const headers = {
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': 'main'
      };
      if (gw.token) headers['Authorization'] = `Bearer ${gw.token}`;

      const resp = await fetch(gw.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'openclaw',
          stream: true,
          messages
        }),
        signal: controller.signal
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Gateway ${resp.status}: ${err.slice(0, 200)}`);
      }

      let response = '';
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const obj = JSON.parse(data);
              const content = obj?.choices?.[0]?.delta?.content;
              if (content) {
                response += content;
                res.write(`data: ${JSON.stringify({ type: 'text', text: content })}\n\n`);
              }
            } catch {}
          }
        }
      }

      if (response) chatHistory.push({ role: 'assistant', content: response, time: new Date().toISOString() });
      res.write(`data: ${JSON.stringify({ type: 'done', code: 0 })}\n\n`);
      res.end();
      return;
    } catch (e) {
      console.error('[chat] gateway error:', e.message);
      res.write(`data: ${JSON.stringify({ type: 'stderr', text: `Gateway error: ${e.message}\nFalling back to claude CLI…\n` })}\n\n`);
    }
  } else {
    console.warn('[chat] gateway chat not configured or chatCompletions not enabled');
  }

  /* Fallback: claude CLI */
  let clauDeAvailable = false;
  try {
    const test = spawn('which', ['claude']);
    await new Promise(resolve => test.on('close', code => { clauDeAvailable = code === 0; resolve(); }));
  } catch {}

  if (!clauDeAvailable) {
    res.write(`data: ${JSON.stringify({ type: 'stderr', text: 'Chat not available: Gateway unreachable and claude CLI not installed.\nCheck gateway config or install claude CLI.' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', code: 1 })}\n\n`);
    res.end();
    return;
  }

  const child = spawn('claude', ['-p', message], {
    cwd: WORKSPACE_DIR,
    env: { ...process.env, TERM: 'dumb' }
  });
  let response = '';
  child.on('error', err => {
    console.error('[chat] claude spawn error:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'stderr', text: `claude CLI error: ${err.message}` })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', code: 1 })}\n\n`);
    res.end();
  });
  child.stdout.on('data', d => {
    const text = d.toString();
    response += text;
    res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
  });
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stderr', text: d.toString() })}\n\n`));
  child.on('close', code => {
    if (response) chatHistory.push({ role: 'assistant', content: response, time: new Date().toISOString() });
    res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
    res.end();
  });
  req.on('close', () => child.kill());
});

// ─── CONFIG FAVORITES (user prefs) ───────────────────────────────────────────

function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); }
  catch { return {}; }
}

app.get('/api/config-favorites', (req, res) => {
  const prefs = loadPrefs();
  res.json({ favorites: prefs.favorites || [] });
});

app.post('/api/config-favorites', (req, res) => {
  const { favorites } = req.body;
  if (!Array.isArray(favorites)) return res.status(400).json({ error: 'favorites must be array' });
  const prefs = loadPrefs();
  prefs.favorites = favorites;
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// File manager favorites (starred paths)
app.get('/api/fm-favorites', (req, res) => {
  const prefs = loadPrefs();
  res.json({ favorites: prefs.fmFavorites || [] });
});

app.post('/api/fm-favorites', (req, res) => {
  const { favorites } = req.body;
  if (!Array.isArray(favorites)) return res.status(400).json({ error: 'favorites must be array' });
  const prefs = loadPrefs();
  prefs.fmFavorites = favorites;
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── MODELS ───────────────────────────────────────────────────────────────────

/** Known non-LLM tools with detection commands */
const KNOWN_TOOLS = [
  { id: 'whisper',        label: 'Whisper (STT)',          cmd: 'whisper',        type: 'stt'   },
  { id: 'faster-whisper', label: 'Faster-Whisper (STT)',   cmd: 'faster-whisper', type: 'stt'   },
  { id: 'kokoro',         label: 'Kokoro TTS',             cmd: 'kokoro',         type: 'tts'   },
  { id: 'piper',          label: 'Piper TTS',              cmd: 'piper',          type: 'tts'   },
  { id: 'stable-diffusion', label: 'Stable Diffusion (API)', cmd: null,           type: 'image' },
  { id: 'comfyui',        label: 'ComfyUI (API)',           cmd: null,            type: 'image' },
];

function loadModelsPrefs() {
  const prefs = loadPrefs();
  return prefs.models || {};
}

function saveModelsPrefs(models) {
  const prefs = loadPrefs();
  prefs.models = models;
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
}

// Ollama: search models online (curated + Ollama registry)
const OLLAMA_POPULAR = [
  { name: 'llama3.2',       description: 'Meta Llama 3.2 — best general-purpose 3B/1B model' },
  { name: 'llama3.1',       description: 'Meta Llama 3.1 — 8B/70B/405B multilingual model' },
  { name: 'mistral',        description: 'Mistral 7B — fast efficient language model' },
  { name: 'qwen2.5',        description: 'Alibaba Qwen2.5 — strong coding & reasoning model' },
  { name: 'qwen2.5-coder',  description: 'Qwen2.5 Coder — specialised code model' },
  { name: 'gemma3',         description: "Google Gemma 3 — lightweight model" },
  { name: 'phi4',           description: 'Microsoft Phi-4 — small but capable model' },
  { name: 'phi4-mini',      description: 'Microsoft Phi-4 Mini — ultra-compact model' },
  { name: 'deepseek-r1',    description: 'DeepSeek R1 — reasoning-focused model' },
  { name: 'deepseek-coder-v2', description: 'DeepSeek Coder V2 — powerful code model' },
  { name: 'nomic-embed-text', description: 'Nomic Embed Text — embedding model' },
  { name: 'mxbai-embed-large', description: 'MixedBread large embedding model' },
  { name: 'codellama',      description: 'Meta CodeLlama — code generation model' },
  { name: 'dolphin-mistral',description: 'Dolphin Mistral — uncensored fine-tune' },
  { name: 'vicuna',         description: 'Vicuna — LLaMA fine-tune for chat' },
  { name: 'wizardlm2',      description: 'WizardLM2 — instruction following' },
  { name: 'solar',          description: 'SOLAR 10.7B — high performance Korean/English' },
  { name: 'neural-chat',    description: 'Intel Neural Chat — optimised for Intel hardware' },
  { name: 'starling-lm',    description: 'Starling — RLHF fine-tuned chat model' },
  { name: 'openchat',       description: 'OpenChat 3.5 — fine-tuned on C-RLFT data' },
  { name: 'orca-mini',      description: 'Orca Mini — small reasoning model' },
  { name: 'zephyr',         description: 'Zephyr 7B — HuggingFace RLHF model' },
  { name: 'llava',          description: 'LLaVA — vision + language model' },
  { name: 'moondream',      description: 'Moondream 2 — tiny vision model' },
  { name: 'bakllava',       description: 'BakLLaVA — Mistral+LLaVA multimodal' },
  { name: 'whisper',        description: 'Whisper — speech recognition model' },
  { name: 'all-minilm',     description: 'all-MiniLM — small fast embedding model' },
];

app.get('/api/models/ollama/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ results: OLLAMA_POPULAR.slice(0, 12) });

  // Filter curated list first
  const curated = OLLAMA_POPULAR.filter(m =>
    m.name.includes(q) || m.description.toLowerCase().includes(q)
  );

  // Also try Ollama search API (best-effort)
  try {
    const r = await fetch(`https://ollama.com/api/search?q=${encodeURIComponent(q)}&limit=20`, {
      headers: { 'User-Agent': 'openclaw-dashboard/1.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) {
      const data = await r.json();
      const apiResults = (data.models || []).map(m => ({
        name: m.name, description: m.description || '', pulls: m.pulls
      }));
      // Merge: dedupe by name, curated first
      const names = new Set(curated.map(m => m.name));
      const merged = [...curated, ...apiResults.filter(m => !names.has(m.name))];
      return res.json({ results: merged });
    }
  } catch {}

  // Fallback: curated only
  res.json({ results: curated.length ? curated : OLLAMA_POPULAR.filter(m => m.name.startsWith(q[0])).slice(0, 8) });
});

// Ollama: get status + version
app.get('/api/models/ollama/status', async (req, res) => {
  const mp = loadModelsPrefs();
  const base = (mp.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    res.json({ connected: true, version: data.version || 'unknown', url: base });
  } catch (e) {
    res.json({ connected: false, error: e.message, url: base });
  }
});

// Ollama: currently loaded (in-memory) models via /api/ps
app.get('/api/models/ollama/running', async (req, res) => {
  const mp   = loadModelsPrefs();
  const base = (mp.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  try {
    const r    = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const models = (data.models || []).map(m => ({
      name:     m.name,
      size:     m.size     || 0,
      sizeVram: m.size_vram || 0,
    }));
    res.json({ models });
  } catch (e) {
    res.json({ models: [], error: e.message });
  }
});

// Ollama: list installed models
app.get('/api/models/ollama/list', async (req, res) => {
  const mp = loadModelsPrefs();
  const base = (mp.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    res.json({ models: data.models || [] });
  } catch (e) {
    res.status(503).json({ error: `Cannot reach Ollama at ${base}: ${e.message}` });
  }
});

// Ollama: pull a model (SSE progress)
app.post('/api/models/ollama/pull', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'model name required' });
  const mp = loadModelsPrefs();
  const base = (mp.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');

  sseHeaders(res);
  const sseWrite = d => res.write(`data: ${JSON.stringify(d)}\n\n`);

  try {
    const r = await fetch(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true })
    });
    if (!r.ok) {
      sseWrite({ status: `Error: HTTP ${r.status}` });
      res.write(`data: ${JSON.stringify({ done: true, error: true })}\n\n`);
      return res.end();
    }
    const reader = r.body.getReader();
    const dec    = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          sseWrite(obj);
        } catch {}
      }
    }
    sseWrite({ status: 'success', done: true });
  } catch (e) {
    sseWrite({ status: `Error: ${e.message}`, done: true, error: true });
  }
  res.end();
});

// Ollama: delete a model
app.post('/api/models/ollama/delete', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'model name required' });
  const mp = loadModelsPrefs();
  const base = (mp.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Models settings: get/save
app.get('/api/models/settings', (req, res) => {
  res.json(loadModelsPrefs());
});

app.post('/api/models/settings', (req, res) => {
  try {
    saveModelsPrefs(req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Non-LLM tools: detect + availability
app.get('/api/models/tools', async (req, res) => {
  const mp = loadModelsPrefs();
  const toolPrefs = mp.tools || {};

  const results = await Promise.all(KNOWN_TOOLS.map(async t => {
    const pref = toolPrefs[t.id] || {};
    let detected = false;
    let detectedPath = '';

    if (t.cmd) {
      // Check custom path first, then PATH
      const customPath = pref.path || '';
      if (customPath && fs.existsSync(customPath)) {
        detected = true; detectedPath = customPath;
      } else {
        try {
          const { stdout } = await new Promise((resolve, reject) =>
            exec(`which ${t.cmd}`, (e, o, er) => e ? reject(e) : resolve({ stdout: o.trim() }))
          );
          if (stdout) { detected = true; detectedPath = stdout; }
        } catch {}
      }
    } else {
      // API-based tool (SD, ComfyUI): check if endpoint responds
      const apiUrl = pref.apiUrl || '';
      if (apiUrl) {
        try {
          await fetch(apiUrl, { signal: AbortSignal.timeout(2000) });
          detected = true; detectedPath = apiUrl;
        } catch {}
      }
    }

    return {
      id:                   t.id,
      label:                t.label,
      type:                 t.type,
      detected,
      path:                 pref.path    || detectedPath,
      apiUrl:               pref.apiUrl  || '',
      availableForOpenclaw: pref.available !== false && detected,
    };
  }));

  res.json({ tools: results });
});

// Save per-tool config
app.post('/api/models/tools/:id/config', (req, res) => {
  const { id } = req.params;
  const { path: toolPath, apiUrl, available } = req.body;
  try {
    const mp = loadModelsPrefs();
    if (!mp.tools) mp.tools = {};
    mp.tools[id] = { path: toolPath || '', apiUrl: apiUrl || '', available: !!available };
    saveModelsPrefs(mp);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── System Tools Detection & Install ────────────────────────────────────────

const SYSTEM_TOOLS = [
  {
    id: 'node',
    label: 'Node.js',
    category: 'required',
    detectCmd: 'node --version 2>/dev/null',
    note: 'JavaScript runtime — the dashboard runs on Node.js',
    repo: 'https://github.com/nvm-sh/nvm',
    repoLabel: 'nvm (recommended)',
    installCmd: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts`,
  },
  {
    id: 'npm',
    label: 'npm',
    category: 'required',
    detectCmd: 'npm --version 2>/dev/null',
    note: 'Package manager — bundled with Node.js',
    repo: 'https://github.com/nvm-sh/nvm',
    repoLabel: 'nvm (installs Node + npm)',
    installCmd: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts`,
  },
  {
    id: 'node-pty',
    label: 'node-pty',
    category: 'required',
    detectCmd: `node -e "require('node-pty');console.log('ok')" 2>/dev/null`,
    note: 'Native PTY addon — required for embedded terminals',
    repo: 'https://www.npmjs.com/package/node-pty',
    repoLabel: 'npm: node-pty',
    installCmd: 'npm install node-pty',
    installCwd: __dirname,
    detectCwd:  __dirname,
  },
  {
    id: 'docker',
    label: 'Docker',
    category: 'recommended',
    detectCmd: 'docker --version 2>/dev/null',
    note: 'Container runtime — required for container management',
    repo: 'https://docs.docker.com/engine/install/',
    repoLabel: 'docs.docker.com',
    installCmd: 'curl -fsSL https://get.docker.com | sh',
  },
  {
    id: 'git',
    label: 'Git',
    category: 'recommended',
    detectCmd: 'git --version 2>/dev/null',
    note: 'Version control — required for skills management',
    repo: 'https://git-scm.com',
    repoLabel: 'apt: git',
    installCmd: 'sudo apt-get update && sudo apt-get install -y git',
  },
  {
    id: 'python3',
    label: 'Python 3',
    category: 'recommended',
    detectCmd: 'python3 --version 2>/dev/null || python --version 2>/dev/null',
    note: 'Required for Python-based AI tools (Aider, Whisper, Kokoro)',
    repo: 'https://python.org',
    repoLabel: 'apt: python3',
    installCmd: 'sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv',
  },
  {
    id: 'pip',
    label: 'pip',
    category: 'recommended',
    detectCmd: 'PATH="$HOME/.local/bin:$PATH" pip3 --version 2>/dev/null || PATH="$HOME/.local/bin:$PATH" pip --version 2>/dev/null || python3 -m pip --version 2>/dev/null',
    note: 'Python package manager — required for AI tools',
    repo: 'https://pip.pypa.io',
    repoLabel: 'apt: python3-pip',
    installCmd: 'sudo apt-get install -y python3-pip',
  },
  {
    id: 'nvidia-smi',
    label: 'nvidia-smi',
    category: 'optional',
    detectCmd: 'nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null || nvidia-smi 2>/dev/null | head -1',
    note: 'NVIDIA GPU monitoring — optional',
    repo: 'https://www.nvidia.com/drivers',
    repoLabel: 'nvidia.com/drivers',
    installCmd: null,
  },
  {
    id: 'huggingface-cli',
    label: 'huggingface-cli',
    category: 'optional',
    detectCmd: 'PATH="$HOME/.local/bin:$PATH" huggingface-cli --version 2>/dev/null || python3 -c "import huggingface_hub; print(huggingface_hub.__version__)" 2>/dev/null',
    note: 'HuggingFace Hub CLI — for downloading local models',
    repo: 'https://pypi.org/project/huggingface-hub/',
    repoLabel: 'pip: huggingface-hub',
    installCmd: 'PATH="$HOME/.local/bin:$PATH" python3 -m pip install --user huggingface-hub || python3 -m pip install --break-system-packages huggingface-hub',
  },
];

app.get('/api/system/tools', async (req, res) => {
  const results = await Promise.all(SYSTEM_TOOLS.map(t => new Promise(resolve => {
    exec(`bash -lc "${t.detectCmd.replace(/"/g, '\\"')}"`,
      { env: { ...process.env, HOME: process.env.HOME || os.homedir() }, cwd: t.detectCwd || undefined, timeout: 5000 },
      (err, stdout) => {
        const out      = stdout.trim();
        const detected = !err && !!out && out !== '' && out.toLowerCase() !== 'undefined';
        // Extract a clean version string from the first line
        const version  = detected ? out.split('\n')[0].replace(/^v/, '').slice(0, 60) : null;
        resolve({
          id:           t.id,
          label:        t.label,
          category:     t.category,
          note:         t.note,
          repo:         t.repo,
          repoLabel:    t.repoLabel,
          canInstall:   !!t.installCmd,
          detected,
          version,
        });
      }
    );
  })));

  res.json({ tools: results });
});

app.post('/api/system/tools/install', (req, res) => {
  const { id, password } = req.body;
  const tool = SYSTEM_TOOLS.find(t => t.id === id);
  if (!tool || !tool.installCmd) return res.status(400).json({ error: 'No install command for this tool' });

  sseHeaders(res);
  const sseWrite = d => res.write(`data: ${JSON.stringify(d)}\n\n`);

  // If the command contains sudo and a password was supplied, rewrite it to use sudo -S
  // so we can feed the password through stdin without a TTY.
  let cmd = tool.installCmd;
  const needsSudo = cmd.includes('sudo ') && typeof password === 'string' && password.length > 0;
  if (needsSudo) cmd = cmd.replace(/\bsudo\b/g, 'sudo -S');

  sseWrite({ status: `Installing ${tool.label}…\n$ ${tool.installCmd}` });

  const child = spawn('bash', ['-lc', cmd], {
    cwd:   tool.installCwd || (process.env.HOME || WORKSPACE_DIR),
    env:   { ...process.env, HOME: process.env.HOME || os.homedir(), DEBIAN_FRONTEND: 'noninteractive' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // For sudo commands, feed the password then close stdin.
  // For all other commands, leave stdin open — closing it immediately can
  // send SIGHUP to bash -lc on some Linux setups, killing the process.
  if (needsSudo) {
    child.stdin.write(password + '\n');
    child.stdin.end();
  }

  child.stdout.on('data', d => sseWrite({ status: d.toString() }));
  child.stderr.on('data', d => sseWrite({ status: d.toString() }));
  child.on('close', (code, signal) => {
    const ok  = code === 0;
    const msg = ok ? '✓ Done'
      : code !== null ? `✗ Exit ${code}`
      : `✗ Killed by signal (${signal || 'unknown'})`;
    sseWrite({ done: true, ok, status: msg });
    res.end();
  });
  child.on('error', e => {
    sseWrite({ done: true, ok: false, status: `Error: ${e.message}` });
    res.end();
  });
  req.on('close', () => child.kill());
});

// ─── Local Non-LLM Models ─────────────────────────────────────────────────────

const LOCAL_NLM_TOOLS = {
  whisper: {
    label: 'Whisper (STT)',
    models: [
      { name: 'tiny',    description: 'Tiny — fastest, lowest accuracy (~39 MB)' },
      { name: 'base',    description: 'Base — good balance of speed/accuracy (~74 MB)' },
      { name: 'small',   description: 'Small — better accuracy (~244 MB)' },
      { name: 'medium',  description: 'Medium — high accuracy (~769 MB)' },
      { name: 'large',   description: 'Large v2/v3 — best accuracy (~1.5 GB)' },
      { name: 'large-v3',description: 'Large v3 — latest, best accuracy (~1.5 GB)' },
    ],
    installCmd: (model) => `pip install openai-whisper && python -c "import whisper; whisper.load_model('${model}')"`,
    detectFile: (dir, model) => path.join(dir || os.homedir(), '.cache', 'whisper', `${model}.pt`),
  },
  kokoro: {
    label: 'Kokoro TTS',
    models: [
      { name: 'kokoro-v0_19', description: 'Kokoro v0.19 — main model (~326 MB)' },
      { name: 'voices',       description: 'Voice pack (~100 MB)' },
    ],
    installCmd: (model) => `pip install kokoro-onnx`,
    detectFile: (dir) => path.join(dir || os.homedir(), 'kokoro'),
  },
  'stable-diffusion': {
    label: 'Stable Diffusion',
    models: [
      { name: 'stable-diffusion-v1-5',    description: 'SD 1.5 — classic, widely compatible (~4 GB)' },
      { name: 'stable-diffusion-xl-base', description: 'SDXL Base — higher quality (~6.7 GB)' },
      { name: 'stable-diffusion-3',       description: 'SD 3 — latest architecture (~5 GB)' },
    ],
    installCmd: (model) => `pip install diffusers transformers accelerate && huggingface-cli download runwayml/${model}`,
    detectFile: (dir) => dir || '',
  },
  comfyui: {
    label: 'ComfyUI Models',
    models: [
      { name: 'v1-5-pruned-emaonly', description: 'SD 1.5 pruned checkpoint (~4 GB)' },
      { name: 'sdxl_base_1.0',       description: 'SDXL base checkpoint (~6.5 GB)' },
    ],
    installCmd: (model) => `wget -c https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/${model}.safetensors`,
    detectFile: (dir) => dir || '',
  },
};

app.get('/api/models/local/settings', (req, res) => {
  const mp = loadModelsPrefs();
  res.json(mp.local || {});
});

app.post('/api/models/local/settings', (req, res) => {
  try {
    const mp = loadModelsPrefs();
    if (!mp.local) mp.local = {};
    const { tool, modelsPath, apiUrl } = req.body;
    if (!tool) return res.status(400).json({ error: 'tool required' });
    if (!mp.local[tool]) mp.local[tool] = {};
    if (modelsPath !== undefined) mp.local[tool].modelsPath = modelsPath;
    if (apiUrl     !== undefined) mp.local[tool].apiUrl     = apiUrl;
    saveModelsPrefs(mp);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/models/local/search', (req, res) => {
  const tool = req.query.tool || 'whisper';
  const q    = (req.query.q || '').toLowerCase().trim();
  const def  = LOCAL_NLM_TOOLS[tool];
  if (!def) return res.json({ results: [] });
  const list = def.models;
  const results = q
    ? list.filter(m => m.name.includes(q) || m.description.toLowerCase().includes(q))
    : list;
  res.json({ results });
});

app.get('/api/models/local/list', (req, res) => {
  const tool = req.query.tool || 'whisper';
  const mp   = loadModelsPrefs();
  const dir  = mp.local?.[tool]?.modelsPath || '';
  const def  = LOCAL_NLM_TOOLS[tool];
  if (!def) return res.json({ models: [] });

  const models = def.models.map(m => {
    const filePath = def.detectFile(dir, m.name);
    const detected = filePath ? fs.existsSync(filePath) : false;
    return { name: m.name, description: m.description, detected, path: filePath || '' };
  });
  res.json({ models });
});

app.post('/api/models/local/install', (req, res) => {
  const { tool, model } = req.body;
  if (!tool || !model) return res.status(400).json({ error: 'tool and model required' });
  const def = LOCAL_NLM_TOOLS[tool];
  if (!def) return res.status(400).json({ error: 'unknown tool' });

  sseHeaders(res);
  const sseWrite = d => res.write(`data: ${JSON.stringify(d)}\n\n`);

  const cmd   = def.installCmd(model);
  const child = spawn('bash', ['-lc', cmd], {
    cwd: process.env.HOME || WORKSPACE_DIR,
    env: process.env,
  });

  sseWrite({ status: `Running: ${cmd}` });
  child.stdout.on('data', d => sseWrite({ status: d.toString() }));
  child.stderr.on('data', d => sseWrite({ status: d.toString() }));
  child.on('close', code => {
    sseWrite({ done: true, error: code !== 0, status: code === 0 ? '✓ Done' : `✗ Exit ${code}` });
    res.end();
  });
  child.on('error', e => {
    sseWrite({ done: true, error: true, status: `Error: ${e.message}` });
    res.end();
  });
  req.on('close', () => child.kill());
});

app.post('/api/models/local/delete', (req, res) => {
  const { tool, model } = req.body;
  if (!tool || !model) return res.status(400).json({ error: 'tool and model required' });
  const mp  = loadModelsPrefs();
  const dir = mp.local?.[tool]?.modelsPath || '';
  const def = LOCAL_NLM_TOOLS[tool];
  if (!def) return res.status(400).json({ error: 'unknown tool' });

  const filePath = def.detectFile(dir, model);
  if (!filePath || !fs.existsSync(filePath))
    return res.status(404).json({ error: 'File not found' });

  try {
    fs.rmSync(filePath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── WebSocket Terminal ───────────────────────────────────────────────────────

const httpServer = http.createServer(app);
const termWss    = new WebSocketServer({ noServer: true });
const codeWss    = new WebSocketServer({ noServer: true });

// Route WebSocket upgrades manually so we can strip the permessage-deflate
// extension header before the handshake — prevents RSV1 frame errors with ws@8.
httpServer.on('upgrade', (req, socket, head) => {
  delete req.headers['sec-websocket-extensions'];
  if (req.url === '/ws/terminal') {
    termWss.handleUpgrade(req, socket, head, ws => termWss.emit('connection', ws, req));
  } else if (req.url.startsWith('/ws/code')) {
    codeWss.handleUpgrade(req, socket, head, ws => codeWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

termWss.on('connection', (ws) => {
  if (!pty) {
    ws.send(JSON.stringify({ type: 'output', data: '\r\nnode-pty is not installed.\r\nRun: npm install node-pty\r\nthen restart the panel.\r\n' }));
    ws.close();
    return;
  }

  const shell = process.env.SHELL || '/bin/bash';
  let ptyProc;
  try {
    ptyProc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80, rows: 24,
      cwd: process.env.HOME || WORKSPACE_DIR,
      env: process.env
    });
  } catch (e) {
    ws.send(JSON.stringify({ type: 'output', data: `\r\nFailed to spawn shell: ${e.message}\r\n` }));
    ws.close();
    return;
  }

  ptyProc.onData(data => {
    if (ws.readyState === ws.OPEN)
      ws.send(JSON.stringify({ type: 'output', data }));
  });

  ptyProc.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      ws.close();
    }
  });

  ws.on('message', raw => {
    try {
      const { type, data, cols, rows } = JSON.parse(raw.toString());
      if (type === 'input')  ptyProc.write(data);
      if (type === 'resize') ptyProc.resize(Math.max(2, cols), Math.max(2, rows));
    } catch {}
  });

  ws.on('close', () => { try { ptyProc.kill(); } catch {} });
});

// ─── WebSocket Code Terminals (one per tool, bare shell + launch button) ──────

codeWss.on('connection', (ws, req) => {
  if (!pty) {
    ws.send(JSON.stringify({ type: 'output', data: '\r\nnode-pty not installed. Run: npm install node-pty\r\n' }));
    ws.close();
    return;
  }

  const shell = process.env.SHELL || '/bin/bash';
  let ptyProc;
  try {
    ptyProc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80, rows: 20,
      cwd: process.env.HOME || WORKSPACE_DIR,
      env: process.env
    });
  } catch (e) {
    ws.send(JSON.stringify({ type: 'output', data: `\r\nFailed to spawn shell: ${e.message}\r\n` }));
    ws.close();
    return;
  }

  ptyProc.onData(data => {
    if (ws.readyState === ws.OPEN)
      ws.send(JSON.stringify({ type: 'output', data }));
  });

  ptyProc.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      ws.close();
    }
  });

  ws.on('message', raw => {
    try {
      const { type, data, cols, rows } = JSON.parse(raw.toString());
      if (type === 'input')  ptyProc.write(data);
      if (type === 'resize') ptyProc.resize(Math.max(2, cols), Math.max(2, rows));
    } catch {}
  });

  ws.on('close', () => { try { ptyProc.kill(); } catch {} });
});

// ─── DOCKER ───────────────────────────────────────────────────────────────────

app.get('/api/docker/containers', (req, res) => {
  exec(`docker ps -a --format '{{json .}}'`, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    const containers = stdout.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    res.json({ containers });
  });
});

app.post('/api/docker/containers/:id/action', (req, res) => {
  const { action } = req.body;
  const id = req.params.id;
  const allowed = ['start', 'stop', 'restart', 'remove', 'rm'];
  if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const cmd = action === 'remove' ? `docker rm -f ${id}` : `docker ${action} ${id}`;
  exec(cmd, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true, output: stdout.trim() });
  });
});

app.get('/api/docker/containers/:id/logs', (req, res) => {
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
});

app.get('/api/docker/images', (req, res) => {
  exec(`docker images --format '{{json .}}'`, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    const images = stdout.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    res.json({ images });
  });
});

app.post('/api/docker/images/pull', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'No image name' });
  sseHeaders(res);
  const child = spawn('docker', ['pull', name]);
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.on('error', err => { res.write(`data: ${JSON.stringify(`[error: ${err.message}]`)}\n\n`); res.end(); });
  child.on('close', code => { res.write(`data: ${JSON.stringify(`[exit ${code}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
});

app.delete('/api/docker/images/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  exec(`docker rmi ${id}`, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true });
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenClaw Panel v2.1 → http://0.0.0.0:${PORT}`);
});

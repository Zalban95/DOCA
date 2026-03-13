/**
 * OPENCLAW PANEL — server.js
 * Modules: status, action, logs, config (multi-file), keys, skills, setup, snapshots,
 *          files (upload/download), claude code, chat
 */
'use strict';

const express = require('express');
const { exec, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const multer = require('multer');

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
  const [composeResult, gpuResult, ollamaResult] = await Promise.allSettled([
    run('docker compose ps --format json'),
    run('nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits'),
    run('curl -s http://localhost:11434/api/tags'),
  ]);

  // Containers
  let containers = [];
  if (composeResult.status === 'fulfilled') {
    containers = composeResult.value.stdout.trim().split('\n')
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
  const cpus   = os.cpus();
  const loadAvg = os.loadavg();
  // Simple busy% from CPU info
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  const cpuPct = Math.round((1 - totalIdle / totalTick) * 100);
  const ramTotal = Math.round(os.totalmem() / 1e6);  // MB
  const ramUsed  = Math.round((os.totalmem() - os.freemem()) / 1e6);

  const system = {
    cpuPct,
    load1:  Math.round(loadAvg[0] * 100) / 100,
    load5:  Math.round(loadAvg[1] * 100) / 100,
    ramUsed,
    ramTotal,
  };

  // Ollama models
  let models = [];
  if (ollamaResult.status === 'fulfilled') {
    try {
      const data = JSON.parse(ollamaResult.value.stdout);
      models = (data.models || []).map(m => ({ name: m.name, size: m.size }));
    } catch {}
  }

  res.json({ containers, gpu, system, models, time: new Date().toISOString() });
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
app.get('/api/snapshots', (req, res) => {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) return res.json({ snapshots: [] });
    const entries = fs.readdirSync(SNAPSHOT_DIR, { withFileTypes: true });
    const snapshots = entries.filter(e => e.isDirectory()).map(e => {
      const s = fs.statSync(path.join(SNAPSHOT_DIR, e.name));
      return { name: e.name, created: s.mtime.toISOString() };
    }).sort((a, b) => b.created.localeCompare(a.created));
    res.json({ snapshots });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/snapshots/create', (req, res) => {
  const { label } = req.body;
  sseHeaders(res);
  const child = spawn('bash', [SNAPSHOT_SCRIPT, ...(label ? [label] : [])]);
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.on('close', code => { res.write(`data: ${JSON.stringify(`[exit ${code}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
});

app.post('/api/snapshots/restore', (req, res) => {
  const { name } = req.body;
  if (!name || !/^[\w.\-]+$/.test(name)) return res.status(400).json({ error: 'Invalid snapshot name' });
  sseHeaders(res);
  const child = spawn('bash', [RESTORE_SCRIPT, name]);
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.on('close', code => { res.write(`data: ${JSON.stringify(`[exit ${code}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
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

// ─── CHAT (OpenClaw Agent) ────────────────────────────────────────────────────

const chatHistory = [];

/** Resolve ${VAR} in string from process.env */
function resolveEnvVars(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
}

/** Parse openclaw.json tolerantly (JSON5-ish: strip comments, trailing commas, bad control chars) */
function parseOpenclawConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    .replace(/\/\/[^\n]*/g, '')           // strip // comments first (needs newlines intact)
    .replace(/\/\*[\s\S]*?\*\//g, '')     // strip /* */ comments
    .replace(/,(\s*[}\]])/g, '$1')        // strip trailing commas
    .replace(/[\x00-\x1F\x7F]/g, ' ');   // strip ALL control chars (incl \n \r \t — JSON is whitespace-agnostic)
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
      req.on('close', () => controller.abort());

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

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenClaw Panel v2.1 → http://0.0.0.0:${PORT}`);
});

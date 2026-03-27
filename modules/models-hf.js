'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { exec, spawn } = require('child_process');

const { loadModelsPrefs, saveModelsPrefs, sseHeaders } = require('./utils');

/** GET /api/models/hf/settings */
function handleGetSettings(req, res) {
  const mp = loadModelsPrefs();
  res.json(mp.hf || { cacheDir: '', token: '' });
}

/** POST /api/models/hf/settings */
function handlePostSettings(req, res) {
  try {
    const mp = loadModelsPrefs();
    const { cacheDir, token } = req.body;
    mp.hf = { cacheDir: cacheDir || '', token: token || '' };
    saveModelsPrefs(mp);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** Helper: build env for HF CLI commands */
function hfEnv() {
  const mp   = loadModelsPrefs();
  const home = process.env.HOME || os.homedir();
  return {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${home}/.local/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}`,
      ...(mp.hf?.token ? { HF_TOKEN: mp.hf.token } : {}),
    },
    home,
    mp,
  };
}

/** GET /api/models/hf/status */
function handleStatus(req, res) {
  const { env } = hfEnv();
  const detectCmd = `python3 -c "import huggingface_hub; print(huggingface_hub.__version__)" 2>/dev/null || huggingface-cli --version 2>/dev/null`;
  exec(`bash -lc "${detectCmd.replace(/"/g, '\\"')}"`, { env, timeout: 5000 }, (err, stdout) => {
    const version = stdout.trim().split('\n')[0] || null;
    if (err || !version) return res.json({ detected: false, version: null, user: null });
    const whoamiCmd = `python3 -c "from huggingface_hub import whoami; u=whoami(); print(u.get('name',''))" 2>/dev/null || huggingface-cli whoami 2>/dev/null`;
    exec(`bash -lc "${whoamiCmd.replace(/"/g, '\\"')}"`, { env, timeout: 5000 }, (e2, out2) => {
      const user = e2 ? null : (out2.trim().split('\n')[0] || null);
      res.json({ detected: true, version, user });
    });
  });
}

/** GET /api/models/hf/list */
function handleList(req, res) {
  const { env, home, mp } = hfEnv();

  exec(`bash -lc "huggingface-cli scan-cache --json 2>/dev/null"`, { env, timeout: 10000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
    if (!err && stdout.trim()) {
      try {
        const data  = JSON.parse(stdout.trim());
        const repos = (data.repos || []).map(r => ({
          repo_id:       r.repo_id,
          repo_type:     r.repo_type || 'model',
          size_on_disk:  r.size_on_disk || 0,
          nb_files:      r.nb_files    || 0,
          last_modified: r.last_modified || null,
        }));
        return res.json({ repos });
      } catch {}
    }
    // Fallback: scan cache directory
    const cacheDir = mp.hf?.cacheDir || path.join(home, '.cache', 'huggingface', 'hub');
    try {
      if (!fs.existsSync(cacheDir)) return res.json({ repos: [] });
      const entries = fs.readdirSync(cacheDir);
      const repos   = entries
        .filter(e => e.startsWith('models--') || e.startsWith('datasets--'))
        .map(e => {
          const full    = path.join(cacheDir, e);
          const stat    = fs.statSync(full);
          const parts   = e.split('--');
          const repo_id = parts.length >= 3 ? `${parts[1]}/${parts.slice(2).join('/')}` : e;
          return { repo_id, repo_type: e.startsWith('datasets--') ? 'dataset' : 'model',
                   size_on_disk: stat.size, nb_files: null, last_modified: stat.mtime.toISOString() };
        });
      res.json({ repos });
    } catch (e2) { res.status(500).json({ error: e2.message }); }
  });
}

/** GET /api/models/hf/search */
async function handleSearch(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  try {
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&limit=20&sort=downloads&direction=-1`;
    const r   = await fetch(url, { headers: { 'User-Agent': 'doca-panel/1.0' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const results = data.map(m => ({
      id:           m.id,
      downloads:    m.downloads   || 0,
      likes:        m.likes       || 0,
      pipeline_tag: m.pipeline_tag || '',
    }));
    res.json({ results });
  } catch (e) { res.status(502).json({ error: e.message }); }
}

/** POST /api/models/hf/download — SSE progress */
function handleDownload(req, res) {
  const { repoId } = req.body;
  if (!repoId) return res.status(400).json({ error: 'repoId required' });

  const { home, mp } = hfEnv();
  const token = mp.hf?.token || '';
  const cache = mp.hf?.cacheDir || '';

  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  const cleanCache = cache ? cache.replace(/\/+/g, '/') : '';

  const args = ['download', repoId];
  if (cleanCache) args.push('--cache-dir', cleanCache);

  sseWrite({ status: `Downloading ${repoId}…\n$ huggingface-cli ${args.join(' ')}\n\n` });

  const hfPath = `/usr/bin:/usr/local/bin:${home}/.local/bin:/bin`;
  const child  = spawn('huggingface-cli', args, {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${hfPath}:${process.env.PATH || ''}`,
      PYTHONUNBUFFERED: '1',
      HF_HUB_DISABLE_PROGRESS_BARS: '0',
      TQDM_NCOLS: '80',
      TQDM_MININTERVAL: '0.5',
      ...(token ? { HF_TOKEN: token } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', d => sseWrite({ status: d.toString() }));
  child.stderr.on('data', d => sseWrite({ status: d.toString() }));
  child.on('close', (code, signal) => {
    const ok  = code === 0;
    const msg = ok ? '\n✓ Done'
      : code !== null ? `\n✗ Exit ${code}`
      : `\n✗ Killed by signal (${signal || 'unknown'})`;
    sseWrite({ done: true, ok, status: msg });
    res.end();
  });
  child.on('error', e => {
    sseWrite({ done: true, ok: false, status: `Error: ${e.message}. Is huggingface-cli installed?` });
    res.end();
  });
  res.on('close', () => { if (!child.killed) child.kill(); });
}

/** POST /api/models/hf/delete */
function handleDelete(req, res) {
  const { repoId } = req.body;
  if (!repoId) return res.status(400).json({ error: 'repoId required' });

  const { home, mp } = hfEnv();
  const cache = mp.hf?.cacheDir || path.join(home, '.cache', 'huggingface', 'hub');

  const dirName = `models--${repoId.replace(/\//g, '--')}`;
  const full    = path.join(cache, dirName);

  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Cache entry not found' });
  try {
    fs.rmSync(full, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  handleGetSettings,
  handlePostSettings,
  handleStatus,
  handleList,
  handleSearch,
  handleDownload,
  handleDelete,
};

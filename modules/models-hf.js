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
  const cacheDir = mp.hf?.cacheDir || path.join(home, '.cache', 'huggingface', 'hub');

  // Try Python API with the correct cache dir, then fall back to filesystem scan
  const scanPy = `import json,sys; from huggingface_hub import scan_cache_dir; info = scan_cache_dir(${JSON.stringify(cacheDir)}); print(json.dumps({"repos": [{"repo_id": r.repo_id, "repo_type": r.repo_type, "size_on_disk": r.size_on_disk, "nb_files": r.nb_files, "last_modified": str(r.last_accessed)} for r in info.repos]}))`;
  exec(`python3 -u -c ${JSON.stringify(scanPy)} 2>/dev/null`, { env, timeout: 10000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
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
    // Fallback: scan cache directory on filesystem
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

  // Python wrapper that reports per-file progress explicitly to stdout
  const pyScript = `
import sys, os, threading, time
os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'
from huggingface_hub import snapshot_download, list_repo_files

repo_id = ${JSON.stringify(repoId)}
token = ${JSON.stringify(token)} or None
cache_dir = ${JSON.stringify(cleanCache)} or None

try:
    files = list_repo_files(repo_id, token=token)
    total = len(files)
    print(f"Repository has {total} files", flush=True)
except Exception:
    total = None
    print("Fetching file list...", flush=True)

done_flag = threading.Event()
start = time.time()

def monitor():
    if not cache_dir:
        return
    target = os.path.join(cache_dir, "models--" + repo_id.replace("/", "--"))
    last_msg = ""
    while not done_flag.is_set():
        done_flag.wait(3)
        try:
            sz = sum(
                os.path.getsize(os.path.join(dp, f))
                for dp, _, fns in os.walk(target)
                for f in fns
            )
            elapsed = time.time() - start
            msg = f"Cache size: {sz / 1e9:.2f} GB  ({elapsed:.0f}s elapsed)"
            if msg != last_msg:
                print(msg, flush=True)
                last_msg = msg
        except Exception:
            pass

t = threading.Thread(target=monitor, daemon=True)
t.start()

try:
    result = snapshot_download(repo_id, token=token, cache_dir=cache_dir)
    done_flag.set()
    print(f"\\nDownloaded to: {result}", flush=True)
except Exception as e:
    done_flag.set()
    print(f"\\nError: {e}", file=sys.stderr, flush=True)
    sys.exit(1)
`.trim();

  const displayCmd = `huggingface-cli download ${repoId}${cleanCache ? ' --cache-dir ' + cleanCache : ''}`;
  sseWrite({ status: `Downloading ${repoId}…\n$ ${displayCmd}\n\n` });

  const hfPath = `/usr/bin:/usr/local/bin:${home}/.local/bin:/bin`;
  const child  = spawn('python3', ['-u', '-c', pyScript], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${hfPath}:${process.env.PATH || ''}`,
      PYTHONUNBUFFERED: '1',
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
    sseWrite({ done: true, ok: false, status: `Error: ${e.message}. Is python3 + huggingface_hub installed?` });
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

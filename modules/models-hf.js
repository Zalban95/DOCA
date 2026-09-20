'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

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

/**
 * The interpreters worth trying, in order.
 *
 * `python3` does not exist on Windows, where the launcher is `py` and the
 * interpreter is `python` — so every HF call here failed on the machine this
 * panel is actually tested on, and the tab reported "not detected" with a
 * working huggingface_hub installed a metre away.
 */
const PYTHONS = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];

/** Helper: build env for HF CLI commands */
function hfEnv() {
  const mp   = loadModelsPrefs();
  const home = process.env.HOME || os.homedir();
  // `path.delimiter`, not ':'. Joining Windows paths with colons produces one
  // unusable entry and takes the inherited PATH down with it, so the very
  // interpreter this is trying to find stops being findable.
  const extra = [path.join(home, '.local', 'bin'), '/usr/local/bin']
    .filter(p => process.platform !== 'win32' || !p.startsWith('/'));
  return {
    env: {
      ...process.env,
      HOME: home,
      PATH: [...extra, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
      ...(mp.hf?.token ? { HF_TOKEN: mp.hf.token } : {}),
    },
    home,
    mp,
  };
}

/** The first interpreter on this machine that runs, or null. */
function pythonBin(env) {
  const attempt = i => new Promise(resolve => {
    if (i >= PYTHONS.length) return resolve(null);
    execFile(PYTHONS[i], ['-c', ''], { env, timeout: 5000, windowsHide: true }, err =>
      resolve(err && err.code === 'ENOENT' ? attempt(i + 1) : PYTHONS[i]));
  });
  return attempt(0);
}

/**
 * Run one python snippet, trying each interpreter until one exists.
 *
 * `execFile`, not `exec` through `bash -lc`: there is no shell on Windows to
 * run `2>/dev/null` or `||`, and the script went through two rounds of quote
 * mangling on the way to one. Resolves `{ ok, out }` — never rejects, because
 * "no python" is an answer this panel draws rather than an error page.
 */
function runPython(script, { env, timeout = 5000, maxBuffer } = {}) {
  const attempt = i => new Promise(resolve => {
    if (i >= PYTHONS.length) return resolve({ ok: false, out: '' });
    execFile(PYTHONS[i], ['-c', script], { env, timeout, maxBuffer, windowsHide: true }, (err, stdout) => {
      // ENOENT means this interpreter is not here; any other failure means it
      // ran and said no, which is a real answer and stops the search.
      if (err && err.code === 'ENOENT') return resolve(attempt(i + 1));
      resolve({ ok: !err, out: (stdout || '').trim() });
    });
  });
  return attempt(0);
}

/** GET /api/models/hf/status */
async function handleStatus(req, res) {
  const { env } = hfEnv();
  const ver = await runPython('import huggingface_hub; print(huggingface_hub.__version__)', { env });
  const version = ver.ok ? ver.out.split('\n')[0] : null;
  if (!version) return res.json({ detected: false, version: null, user: null });

  const who = await runPython(
    "from huggingface_hub import whoami; u=whoami(); print(u.get('name',''))", { env });
  res.json({ detected: true, version, user: who.ok ? (who.out.split('\n')[0] || null) : null });
}

/**
 * A date the panel can render, from whatever the scan produced.
 *
 * The python side prints `str(r.last_accessed)`, and in current
 * huggingface_hub that is a float of epoch seconds — `1788300758.396` — which
 * reaches `new Date()` as **Invalid Date**, so every row of the cached-models
 * table showed one. Older versions hand back a datetime string, which parses;
 * both arrive here and only one used to work.
 */
function _isoDate(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Bytes and file count under one cache entry — the fallback's own `du`. */
function _entrySize(root) {
  let bytes = 0, files = 0, mtime = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;          // the cache links snapshots at blobs
      if (e.isDirectory()) { stack.push(full); continue; }
      if (!e.isFile()) continue;
      try {
        const st = fs.statSync(full);
        bytes += st.size; files += 1;
        if (st.mtimeMs > mtime) mtime = st.mtimeMs;
      } catch { /* vanished mid-walk */ }
    }
  }
  return { bytes, files, mtime };
}

/** GET /api/models/hf/list */
async function handleList(req, res) {
  const { env, home, mp } = hfEnv();
  const cacheDir = mp.hf?.cacheDir || path.join(home, '.cache', 'huggingface', 'hub');

  // Try the Python API with the correct cache dir, then fall back to a scan.
  const scanPy = `import json,sys; from huggingface_hub import scan_cache_dir; info = scan_cache_dir(${JSON.stringify(cacheDir)}); print(json.dumps({"repos": [{"repo_id": r.repo_id, "repo_type": r.repo_type, "size_on_disk": r.size_on_disk, "nb_files": r.nb_files, "last_modified": str(r.last_accessed)} for r in info.repos]}))`;
  const scan = await runPython(scanPy, { env, timeout: 10000, maxBuffer: 5 * 1024 * 1024 });
  if (scan.ok && scan.out) {
    try {
      const data  = JSON.parse(scan.out);
      const repos = (data.repos || []).map(r => ({
        repo_id:       r.repo_id,
        repo_type:     r.repo_type || 'model',
        size_on_disk:  r.size_on_disk || 0,
        nb_files:      r.nb_files    || 0,
        last_modified: _isoDate(r.last_modified),
      }));
      return res.json({ repos });
    } catch { /* fall through to the scan below */ }
  }

  try {
    if (!fs.existsSync(cacheDir)) return res.json({ repos: [] });
    const repos = fs.readdirSync(cacheDir)
      .filter(e => e.startsWith('models--') || e.startsWith('datasets--'))
      .map(e => {
        // `statSync(dir).size` is the size of the directory entry — a few
        // kilobytes — not of what is in it, so without python every repo in
        // this list read as 4 KB however many gigabytes it held.
        const { bytes, files, mtime } = _entrySize(path.join(cacheDir, e));
        const parts   = e.split('--');
        const isData  = e.startsWith('datasets--');
        const repo_id = parts.length >= 3 ? `${parts[1]}/${parts.slice(2).join('/')}` : e;
        return { repo_id, repo_type: isData ? 'dataset' : 'model',
                 size_on_disk: bytes, nb_files: files,
                 last_modified: mtime ? new Date(mtime).toISOString() : null };
      });
    res.json({ repos });
  } catch (e2) { res.status(500).json({ error: e2.message }); }
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
async function handleDownload(req, res) {
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

  // The same interpreter `runPython` settled on, and the same PATH: this used
  // to hardcode `python3` and join its directories with ':', which on Windows
  // is neither the interpreter's name nor a path separator.
  const { env: pyEnv } = hfEnv();
  const bin = await pythonBin(pyEnv);
  if (!bin) {
    sseWrite({ done: true, ok: false,
      status: `Error: no Python found (tried ${PYTHONS.join(', ')}). Install Python and huggingface_hub.` });
    return res.end();
  }
  const child = spawn(bin, ['-u', '-c', pyScript], {
    cwd: home,
    env: { ...pyEnv, PYTHONUNBUFFERED: '1', ...(token ? { HF_TOKEN: token } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
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
    sseWrite({ done: true, ok: false, status: `Error: ${e.message}. Is Python + huggingface_hub installed?` });
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

  // A repo id is `owner/name`, so only those characters are turned into a
  // directory name. Backslashes were left alone by the old `/`-only replace,
  // which on Windows is a path separator — `..\..\something` walked straight
  // out of the cache and into a recursive delete.
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(repoId) || repoId.includes('..'))
    return res.status(400).json({ error: `Not a repo id: ${repoId}` });

  const slug = repoId.replace(/\//g, '--');
  // Both prefixes: `handleList` lists datasets too, and delete only ever knew
  // about `models--`, so every dataset in the list answered "not found".
  const candidates = [`models--${slug}`, `datasets--${slug}`]
    .map(d => path.join(cache, d))
    .filter(full => fs.existsSync(full));

  if (!candidates.length) return res.status(404).json({ error: 'Cache entry not found' });
  try {
    for (const full of candidates) fs.rmSync(full, { recursive: true, force: true });
    res.json({ ok: true, deleted: candidates });
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

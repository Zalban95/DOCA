'use strict';

const { loadModelsPrefs } = require('./utils');
const { sseHeaders }      = require('./utils');
const { OLLAMA_POPULAR }  = require('./models');

/** Helper: get base Ollama URL from prefs */
function ollamaBase() {
  const mp = loadModelsPrefs();
  return (mp.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

/** GET /api/models/ollama/search */
async function handleSearch(req, res) {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ results: OLLAMA_POPULAR.slice(0, 12) });

  const curated = OLLAMA_POPULAR.filter(m =>
    m.name.includes(q) || m.description.toLowerCase().includes(q)
  );

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
      const names = new Set(curated.map(m => m.name));
      const merged = [...curated, ...apiResults.filter(m => !names.has(m.name))];
      return res.json({ results: merged });
    }
  } catch {}

  res.json({ results: curated.length ? curated : OLLAMA_POPULAR.filter(m => m.name.startsWith(q[0])).slice(0, 8) });
}

/** GET /api/models/ollama/status */
async function handleStatus(req, res) {
  const base = ollamaBase();
  try {
    const r = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    res.json({ connected: true, version: data.version || 'unknown', url: base });
  } catch (e) {
    res.json({ connected: false, error: e.message, url: base });
  }
}

/** GET /api/models/ollama/running */
async function handleRunning(req, res) {
  const base = ollamaBase();
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
}

/** GET /api/models/ollama/list */
async function handleList(req, res) {
  const base = ollamaBase();
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    res.json({ models: data.models || [] });
  } catch (e) {
    res.status(503).json({ error: `Cannot reach Ollama at ${base}: ${e.message}` });
  }
}

/** POST /api/models/ollama/pull — SSE progress stream */
async function handlePull(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'model name required' });
  const base = ollamaBase();

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
}

/** POST /api/models/ollama/delete */
async function handleDelete(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'model name required' });
  const base = ollamaBase();
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
}

module.exports = {
  handleSearch,
  handleStatus,
  handleRunning,
  handleList,
  handlePull,
  handleDelete,
};

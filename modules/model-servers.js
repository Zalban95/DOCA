'use strict';

/**
 * The model servers on this machine and what they are doing (audit 2026-10-06, TODO H10.13). The Models tab used to
 * know Ollama and the llama-servers DOCA started itself, and nothing else — so a llama.cpp router run by a service of
 * its own could hold both GPUs while the panel said nothing was on. Every local provider in Field → API keys is asked
 * here, in its own dialect:
 *
 *   llama.cpp router   GET /models — each model with status loaded / sleeping / unloaded / loading; a loaded one's
 *                      own server answers /slots, whose is_processing says it is generating right now
 *   llama-server       GET /slots (one model, busy or not)
 *   Ollama             GET /api/ps (what is in memory)
 *   anything else      GET <base>/models — it answers, with these model ids
 *
 * and each is joined with DOCA's own requests in flight (harness/inflight.js): busy with one of DOCA's is "working for
 * DOCA: <what>"; busy with none of them is "working for something else on this machine" — not DOCA's, said plainly.
 */
const KEEP_MS = 3000;
let _cache = { at: 0, value: null };

async function getJson(url, ms = 1500) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const portOf = args => { const i = (args || []).indexOf('--port'); return i >= 0 ? Number(args[i + 1]) : null; };
const busySlots = slots => Array.isArray(slots) && slots.some(s => s.is_processing);

/** What one provider's server says about itself, or {answering: false}. */
async function probe(ep) {
  const base = String(ep.baseUrl || '').replace(/\/+$/, '');
  let origin;
  try { origin = new URL(base).origin; } catch { return { answering: false }; }
  // llama.cpp's router: models with a status each.
  try {
    const j = await getJson(`${origin}/models`);
    if (Array.isArray(j.data) && j.data.some(m => m.status?.value)) {
      const host = new URL(origin).hostname;
      const models = await Promise.all(j.data.map(async m => {
        const state = m.status?.value || 'unknown', port = portOf(m.status?.args);
        let working = false;
        if (state === 'loaded' && port) { try { working = busySlots(await getJson(`http://${host}:${port}/slots`, 800)); } catch { /* its own server is not saying */ } }
        return { id: m.id, state: working ? 'working' : state };
      }));
      return { answering: true, kind: 'llama.cpp router', models };
    }
  } catch { /* not a router */ }
  // Ollama: what is in memory.
  if (ep.id === 'ollama' || /:11434$/.test(origin)) {
    try {
      const j = await getJson(`${origin}/api/ps`);
      return { answering: true, kind: 'Ollama', models: (j.models || []).map(m => ({ id: m.name, state: 'loaded', vram: m.size_vram || 0 })) };
    } catch { return { answering: false, kind: 'Ollama' }; }
  }
  // One llama-server: busy or not.
  try {
    const slots = await getJson(`${origin}/slots`, 800);
    if (Array.isArray(slots)) {
      let ids = [];
      try { ids = ((await getJson(`${base}/models`)).data || []).map(m => m.id); } catch { /* the slots are enough */ }
      return { answering: true, kind: 'llama-server', models: (ids.length ? ids : ['(its model)']).map(id => ({ id, state: busySlots(slots) ? 'working' : 'loaded' })) };
    }
  } catch { /* not a llama-server */ }
  // Any OpenAI-compatible server: it answers, with these models.
  try {
    const j = await getJson(`${base}/models`);
    return { answering: true, kind: 'OpenAI-compatible', models: (j.data || []).map(m => ({ id: m.id, state: 'available' })) };
  } catch { return { answering: false }; }
}

/** One of DOCA's requests in words: what made it, in which conversation. */
function describe(r) {
  let title = '';
  try { const s = r.sessionId && require('./harness/memory').getSession(r.sessionId); title = s ? (s.title || s.id) : ''; } catch { /* gone */ }
  const what = { step: r.agent ? `${r.agent}'s mission` : 'a turn', fold: 'folding a long conversation', ask: 'a one-off question', probe: 'a tool check' }[r.kind] || r.kind;
  return { kind: r.kind, model: r.model, since: r.at, sessionId: r.sessionId || null, text: title ? `${what} in “${title}”` : what };
}

/** A server's own answer joined with DOCA's requests to it: busy with none of them is busy for someone else. */
function join(ep, s, inflight) {
  const doca = inflight.filter(r => r.provider === ep.id).map(describe);
  const working = (s.models || []).some(m => m.state === 'working');
  return { provider: ep.id, label: ep.label || ep.id, url: ep.baseUrl, ...s, doca, foreign: working && !doca.length };
}

/** Every local model server with its models and who it is working for. Cached a few seconds. */
async function status() {
  if (_cache.value && Date.now() - _cache.at < KEEP_MS) return _cache.value;
  const providers = require('./harness/providers');
  const inflight = require('./harness/inflight').list();
  const eps = providers.list().filter(p => p.local).map(p => { try { return providers.endpoint(p.id); } catch { return null; } }).filter(Boolean);
  const servers = await Promise.all(eps.map(async ep => join(ep, await probe(ep), inflight)));
  _cache = { at: Date.now(), value: { servers: servers.filter(s => s.answering), at: new Date().toISOString() } };
  return _cache.value;
}

function mount(app) {
  app.get('/api/models/servers', async (_req, res) => { try { res.json(await status()); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { status, probe, join, describe, mount };

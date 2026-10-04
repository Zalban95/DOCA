'use strict';

/**
 * llama-servers this panel did not start (review 2026-10-04): the router on
 * :8080 that the harness talks to was invisible on the Models tab, which listed
 * only the instances the panel launches itself. They are found the way the
 * harness already reaches them — its local provider endpoints — and recognised
 * by llama.cpp's own /props (a `build_info`); a router lists its models with
 * their state and launch arguments in /v1/models, which is where the context
 * size comes from, so nothing is woken to read it. Read-only: starting and
 * stopping them is whoever started them's business.
 */
const root = base => String(base).replace(/\/+$/, '').replace(/\/v1$/, '');

async function get(url, ms = 1500) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** @param {number[]} ownPorts the panel's own instances, left out */
async function find(ownPorts = []) {
  const providers = require('./harness/providers');
  const seen = new Set();
  const out = [];
  for (const p of providers.list().filter(x => x.local && x.baseUrl && x.id !== 'ollama')) {
    const base = root(p.baseUrl);
    let port = null;
    try { port = Number(new URL(base).port) || null; } catch { continue; }
    if (seen.has(base) || ownPorts.includes(port)) continue;
    seen.add(base);
    let props;
    try { props = await get(`${base}/props`); } catch { continue; }
    if (!props?.build_info && !props?.default_generation_settings) continue;   // not llama.cpp
    let models = [];
    try {
      models = ((await get(`${base}/v1/models`)).data || []).map(m => {
        const args = m.status?.args || [];
        const i = args.findIndex(a => a === '--ctx-size' || a === '-c');
        return { id: m.id, state: m.status?.value || null, ctx: i >= 0 ? Number(args[i + 1]) || null : null };
      });
    } catch { /* a server that lists nothing still is one */ }
    out.push({ provider: p.id, label: p.label, url: base, router: props.role === 'router', build: props.build_info || null,
      ctx: props.default_generation_settings?.n_ctx || null, models });
  }
  return out;
}

module.exports = { find };

'use strict';

/**
 * A key from a service's card (connectors/services.js KEYS): the person pastes only the key, and the hub fills in the
 * rest — the service's address, the header and its prefix, a note for the agent — and saves it as a key for services
 * (service-keys.js, used with api_call). Then it tries the key once on the service's own "who am I" (or a harmless
 * read), so the card says at once whether it works. The answer is read for success only; nothing of it is returned.
 */
const keys = require('../service-keys');
const { KEYS } = require('./services');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function tryKey(preset) {
  const t = preset.test;
  const url = `${preset.origin}${t.path}`;
  const req = keys.apply(preset.name, url, { Accept: 'application/json', 'User-Agent': 'DOCA', ...(t.headers || {}), ...(t.body ? { 'Content-Type': 'application/json' } : {}) });
  let r;
  try { r = await fetch(req.url, { method: t.method || 'GET', headers: req.headers, body: t.body ? JSON.stringify(t.body) : undefined, signal: AbortSignal.timeout(15000) }); }
  catch (e) { return { ok: false, error: `${new URL(preset.origin).host} could not be reached (${e.cause?.code || e.name}).` }; }
  const text = await r.text().catch(() => '');
  if (r.ok && (!t.expect || text.replace(/\s+/g, '').includes(t.expect))) return { ok: true, summary: `${new URL(preset.origin).host} accepted the key` };
  return { ok: false, error: `${new URL(preset.origin).host} did not accept the key (HTTP ${r.status}${r.ok ? ', the answer said no' : ''}).` };
}

async function savePreset(service, { key, who } = {}) {
  const preset = KEYS[service];
  if (!preset) throw bad(`No key preset for "${service}".`, 404);
  const saved = keys.save({ name: preset.name, origin: preset.origin, place: 'header', field: 'Authorization', prefix: preset.prefix ?? 'Bearer ', note: preset.note, who, key });
  return { key: saved, test: await tryKey(preset) };
}

module.exports = { savePreset, tryKey };

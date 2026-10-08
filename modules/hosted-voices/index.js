'use strict';

/**
 * A voice from a service — ElevenLabs, OpenAI, Cartesia or Google — for a screen that asks for one (Settings → Voice →
 * This screen's voice; asked 2026-10-08: "an easy setup when requested", never pushed). Each provider is one file here
 * saying how it is called and how it takes a tone; this one runs it.
 *
 * The key is a key for services (service-keys.js: DATA_DIR/keys/services.json, protected — never prefs, never a
 * browser), named and addressed by the provider's file, so the hub adds it only to that service's own address; a
 * person without host may use it only when the admin opened it to everyone, as for the agent's api_call. The hub
 * makes the call, so the key never reaches a screen. A screen's choice is its setting `voice`: `engine` is
 * `hosted:<provider>`, `ttsVoice` the voice's id, `hosted` {model, style, stability, language} (tts-engines.js).
 */
const PROVIDERS = Object.fromEntries(['elevenlabs', 'openai', 'cartesia', 'google'].map(id => [id, require(`./${id}`)]));
const PREFIX = 'hosted:';
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const ENDPOINT = p => (process.env[`DOCA_${p.id.toUpperCase()}_TTS_URL`] || p.key.origin).replace(/\/+$/, '');   // the tests' stub

const providerOf = engineId => (String(engineId || '').startsWith(PREFIX) ? PROVIDERS[String(engineId).slice(PREFIX.length)] || null : null);
const kept = p => require('../service-keys').list().find(k => k.name === p.key.name) || null;

/** The engine a screen's `voice` names (tts-engines.js shape: ttsModel, ttsVoice, tags), or null when it is not one of these. */
function engine(mine = {}) {
  const p = providerOf(mine.engine);
  if (!p) return null;
  const o = mine.hosted || {};
  const model = p.models.find(m => m.id === o.model) || p.models.find(m => m.id === p.model);
  return { id: PREFIX + p.id, label: p.label, hosted: p.id, ttsUrl: ENDPOINT(p), ttsModel: model.id, ttsVoice: '', ttsSpeed: 1,
    tags: model.tags ? 'hosted' : null, languages: null, options: o };
}

/** What Settings → Voice offers: each provider, whether its key is kept and may be used by this person, and how to set one up. */
function list({ host = true } = {}) {
  return Object.values(PROVIDERS).map(p => {
    const k = kept(p);
    return { id: PREFIX + p.id, provider: p.id, label: p.label, about: p.about, keyPage: p.keyPage, key: p.key, advanced: p.advanced,
      models: p.models.map(m => ({ id: m.id, label: m.label, tags: m.tags })), model: p.model,
      hasKey: !!k, usable: !!k && (host || k.who === 'everyone'), who: k?.who || null };
  });
}

/** A request to the provider with its key added by the hub (service-keys.apply: its own address only, and who may). */
async function call(p, path, init = {}, { host = true } = {}) {
  const keys = require('../service-keys');
  // The key is applied for the provider's own address only; a test's stub (DOCA_<PROVIDER>_TTS_URL) stands in for it.
  const sent = keys.apply(p.key.name, `${p.key.origin}${path}`, { ...(p.headers || {}), ...(init.headers || {}) }, { host });
  if (sent.exchange) throw bad(`The key "${p.key.name}" is kept as an exchange; ${p.label} takes the key itself — paste it again in Settings → Voice.`);
  const url = ENDPOINT(p) + sent.url.slice(p.key.origin.length);
  const r = await fetch(url, { ...init, headers: sent.headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) {
    const text = keys.scrub(await r.text().catch(() => ''), sent.key).slice(0, 300);
    throw bad(`${p.label} answered HTTP ${r.status}${r.status === 401 || r.status === 403 ? ' — check the key in Settings → Voice' : ''}: ${text}`, r.status === 401 ? 502 : r.status);
  }
  return r;
}

/** The provider's voices as {id, name}; [] when it cannot be asked (no key, or it said no). */
async function voices(e, { host = true } = {}) {
  const p = PROVIDERS[e.hosted];
  try { return await p.voices(async path => (await call(p, path, { method: 'GET' }, { host })).json()); } catch { return []; }
}

/** One sentence spoken: {type, buf}, or {empty: true} when nothing but tags was left to say. */
async function speak(e, text, { voice, speed, host = true } = {}) {
  const p = PROVIDERS[e.hosted];
  if (!p) throw bad('No such voice service.');
  let v = voice;
  if (!v) { const vs = await voices(e, { host }); v = vs[0]?.id; }
  if (!v) throw bad(`Choose a voice of ${p.label} in Settings → Voice.`);
  const req = p.request({ text, voice: v, model: e.ttsModel, speed, opts: e.options || {} });
  if (!req.input) return { empty: true };
  const r = await call(p, req.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) }, { host });
  if (req.base64) {
    const j = await r.json();
    return { type: req.type || 'audio/mpeg', buf: Buffer.from(String(j[req.base64] || ''), 'base64') };
  }
  return { type: r.headers.get('content-type') || 'audio/mpeg', buf: Buffer.from(await r.arrayBuffer()) };
}

module.exports = { PROVIDERS, PREFIX, engine, list, voices, speak, providerOf };

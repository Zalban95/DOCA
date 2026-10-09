'use strict';

/**
 * What uses a port on this machine (use.js asks it for a service, a llama.cpp server or a container's published ports):
 * a model provider whose endpoint is that port — the agent's model, its fallbacks, assistant mode's, reading a screen,
 * finding by meaning, a specialist's own — the hive's voice and speech-to-text and the screens speaking through it, the
 * model requests DOCA has in flight there, and a page an agent's job serves from it. Read from the settings and the
 * readings that already exist (providers, voiceServices, tts-engines, screens/showing, harness/inflight, machines.served),
 * each time, so it is always this hive's. Plain sentences: they go into a person's "are you sure".
 */
const LOOP = /^(127\.0\.0\.1|localhost|::1|\[::1\]|0\.0\.0\.0)$/;

/** The port of a URL on this machine, else null. */
function portOf(url) {
  try {
    const u = new URL(url);
    if (!LOOP.test(u.hostname)) return null;
    return Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  } catch { return null; }
}

/** The models DOCA uses, each with what for: [{ provider, model, role }]. */
function modelsInUse() {
  const out = [];
  const add = (provider, model, role) => { if (provider || model) out.push({ provider: provider || 'ollama', model: model || '', role }); };
  let c = {};
  try { c = require('../harness/catalog').configFor('doca') || {}; } catch { /* no harness */ }
  add(c.provider, c.model, 'the agent\'s model');
  for (const f of Array.isArray(c.fallbackChain) ? c.fallbackChain : []) if (f?.provider) add(f.provider, f.model || c.model, 'a fallback of the agent\'s model');
  if (c.escalateTo?.provider) add(c.escalateTo.provider, c.escalateTo.model, 'the stronger model a stuck job escalates to');
  const val = k => { try { return require('../settings-schema').value(k) || null; } catch { return null; } };
  if (val('assistant.provider')) add(val('assistant.provider'), val('assistant.model'), 'assistant mode\'s model');
  if (val('vision.provider')) add(val('vision.provider'), val('vision.model'), 'the model that reads screens');
  if (val('retrieval.provider') && val('retrieval.model')) add(val('retrieval.provider'), val('retrieval.model'), 'the model that finds by meaning');
  if (val('library.provider') && val('library.model')) add(val('library.provider'), val('library.model'), 'the Library\'s embedding model');
  try { for (const a of require('../agents/registry').list()) if (!a.broken && a.provider) add(a.provider, a.model, `the ${a.id} specialist's model`); } catch { /* none */ }
  return out;
}

function providerPort(provider) {
  try { return portOf(require('../harness/providers').endpoint(provider).baseUrl); } catch { return null; }
}

/** How many screens heard from lately speak through a voice at this port. */
function screensSpeaking(port) {
  let n = 0;
  try {
    const engines = require('../tts-engines'), screens = require('../screens'), devices = require('../api-v1/devices');
    for (const id of Object.keys(require('../screens/showing').all())) {
      const d = devices.get(id);
      const voice = screens.effective(id, d?.userId || null).voice || {};
      if (portOf(engines.forVoice(voice).ttsUrl) === port) n++;
    }
  } catch { /* no screens */ }
  return n;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Why stopping whatever listens on `port` here would be felt: [{ kind, text }], `name` is how to call it. The kind says
 * whether it is set up to use it (`model`, `voice`, `stt`, `screens`) or using it now (`working`, `inflight`, `served`)
 * — service-life/ lets a service that starts when needed go while only set up to be used.
 */
function needs(port, name) {
  if (!port) return [];
  const list = [];
  const out = { push: (text, kind) => list.push({ kind, text }) };
  const models = modelsInUse().filter(m => providerPort(m.provider) === port);
  const running = require('../harness/turn/lifecycle').running.size;
  for (const m of models) out.push(`it runs ${m.role}${m.model ? ` (${m.model})` : ''}`, 'model');
  if (models.some(m => m.role === 'the agent\'s model') && running) out.push(`${plural(running, 'conversation is', 'conversations are')} working on it now`, 'working');
  let vs = {};
  try { vs = require('../chat').loadVoiceServices(); } catch { /* no voice */ }
  const screens = screensSpeaking(port);
  if (portOf(vs.ttsUrl) === port) out.push(`${name} is the hive's voice${screens ? `; ${plural(screens, 'screen')} ${screens === 1 ? 'uses' : 'use'} it` : ''}`, 'voice');
  else if (screens) out.push(`${plural(screens, 'screen')} ${screens === 1 ? 'speaks' : 'speak'} with it`, 'screens');
  if (portOf(vs.sttUrl) === port) out.push(`${name} is the hive's speech-to-text: calls and voice messages are heard through it`, 'stt');
  const flying = require('../harness/inflight').list().filter(r => portOf(r.url) === port).length;
  if (flying) out.push(`${plural(flying, 'model request')} from DOCA ${flying === 1 ? 'is' : 'are'} in flight to it now`, 'inflight');
  try {
    for (const p of require('./index').served().filter(s => s.port === port))
      out.push(`it serves ${p.url}${p.who ? `, which ${p.who}'s job printed` : ''}`, 'served');
  } catch { /* no jobs */ }
  return list;
}

/** The same, as sentences: what a person's "are you sure" names. */
const reasons = (port, name) => needs(port, name).map(n => n.text);

/** The host ports a container publishes, from docker ps' Ports ("0.0.0.0:8880->8880/tcp, :::8880->8880/tcp"). */
function published(ports) {
  return [...new Set([...String(ports || '').matchAll(/:(\d+)->/g)].map(m => Number(m[1])))];
}

module.exports = { reasons, needs, portOf, published, modelsInUse, screensSpeaking };

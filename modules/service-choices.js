'use strict';

/**
 * What a typed setting could be, found where it would be served (asked 2026-10-08: "we can manually edit and type from
 * scratch where we can select … or use a drop-down menu to see what is available from the specific service"). The
 * panel's choiceInput (public/js/lib/choice-input.js) lists these beside a box that keeps whatever is typed:
 *
 *   tts-url, stt-url    the speech services of the Services tab, at their address on this machine, running or not,
 *                       and the address set now
 *   tts-model, stt-model  the models the service at `url` (or the one set now) lists at /v1/models, and a speech
 *                       row's own model name
 *   provider-url        the model servers answering on this machine (model-servers.js), the Services rows a turn's
 *                       provider can be, and `provider`'s usual address
 *
 * Each item is {value, label, where}: "served here", "at <host>", or "not running here". A `url` is asked only when it
 * is the owner's own (loopback, the LAN, the tailnet — toolbox/http.js owned), so this is never a way to make the hub
 * fetch the open web. GET /api/services/choices (host, with the rest of /api/services).
 */
const portOf = url => require('./machines/use-ports').portOf(url);
const LOCAL = 'http://127.0.0.1';

const whereOf = (url, running) => {
  if (portOf(url)) return running ? 'served here' : 'not running here';
  try { return `at ${new URL(url).host}`; } catch { return ''; }
};

async function answers(url, path) {
  try { return (await fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

/** The speech rows that speak (tts) or hear (stt), each at its address here, and the address set now. */
async function addresses(kind) {
  const vs = require('./chat').loadVoiceServices();
  const rows = require('./services').INFERENCE_SERVICES.filter(s => (kind === 'tts' ? s.speech || /\bTTS\b/.test(s.label) : /\bSTT\b/.test(s.label)));
  const path = kind === 'tts' ? '/v1/audio/voices' : '/v1/models';
  const items = await Promise.all(rows.map(async s => {
    const url = `${LOCAL}:${s.port}`;
    return { value: url, label: s.label, where: whereOf(url, await answers(url, path)) };
  }));
  const now = kind === 'tts' ? vs.ttsUrl : vs.sttUrl;
  if (now && !items.some(i => portOf(i.value) && portOf(i.value) === portOf(now)))
    items.unshift({ value: now, label: 'Set now', where: whereOf(now, await answers(now, path)) });
  return { source: kind === 'tts' ? 'the speech services' : 'the speech-to-text services', items };
}

/** The models a speech service lists, and a speech row's own name for its model. */
async function models(kind, url) {
  const vs = require('./chat').loadVoiceServices();
  const at = String(url || (kind === 'tts' ? vs.ttsUrl : vs.sttUrl)).replace(/\/+$/, '');
  if (!require('./harness/toolbox/http').owned(at)) throw Object.assign(new Error('Only an address on this machine or your own network is asked.'), { status: 400 });
  const items = [];
  try {
    const r = await fetch(`${at}/v1/models`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) { const j = await r.json(); for (const m of j.data || j.models || []) { const id = typeof m === 'string' ? m : m.id || m.name; if (id) items.push({ value: id, where: whereOf(at, true) }); } }
  } catch { /* a service that does not list its models: the row's own name below, or whatever is typed */ }
  const row = require('./services').INFERENCE_SERVICES.find(s => s.speech && portOf(at) === s.port);
  if (row && !items.some(i => i.value === row.speech.model)) items.push({ value: row.speech.model, label: `${row.speech.model} — ${row.label}`, where: whereOf(at, false) });
  let host = at;
  try { host = new URL(at).host; } catch { /* as typed */ }
  return { source: host, items };
}

/** Model servers here and the Services rows a provider can be, and the provider's usual address. */
async function providerAddresses(provider) {
  const items = [];
  try {
    for (const s of (await require('./model-servers').status()).servers || []) items.push({ value: s.url, label: s.label, where: whereOf(s.url, true) });
  } catch { /* none answering */ }
  for (const s of require('./services').INFERENCE_SERVICES.filter(x => x.chat)) {
    const url = `${LOCAL}:${s.port}${s.apiPath || ''}`;
    if (!items.some(i => i.value === url)) items.push({ value: url, label: s.label, where: whereOf(url, await answers(url, '/models')) });
  }
  if (provider) {
    try {
      const ep = require('./harness/providers').endpoint(String(provider));
      if (ep.baseUrl && !items.some(i => i.value === ep.baseUrl)) items.push({ value: ep.baseUrl, label: `${ep.label || provider} — its usual address`, where: whereOf(ep.baseUrl, false) });
    } catch { /* not a provider we know */ }
  }
  return { source: 'this machine', items };
}

async function choices({ what, url, provider } = {}) {
  if (what === 'tts-url') return addresses('tts');
  if (what === 'stt-url') return addresses('stt');
  if (what === 'tts-model') return models('tts', url);
  if (what === 'stt-model') return models('stt', url);
  if (what === 'provider-url') return providerAddresses(provider);
  throw Object.assign(new Error('Which choices? tts-url, stt-url, tts-model, stt-model or provider-url.'), { status: 400 });
}

function mount(app) {
  app.get('/api/services/choices', async (req, res) => {
    try { res.json(await choices(req.query || {})); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { choices, mount };

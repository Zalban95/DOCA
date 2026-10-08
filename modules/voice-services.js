'use strict';

/**
 * Which voice services are on, and which voices use them (asked 2026-10-08: "one mask to set up the voice … that also
 * manages which models are switched on"). Settings → Voice draws, beside each chosen service, whether it runs and a
 * "Start it" through the Services route (the person's click, never here), and lists a voice service that runs while
 * no voice uses it, with a Stop that asks first (lib/machine-ask.js).
 *
 * A voice service is a row of the Services tab that speaks or hears: a speech row (speech-services.js, the expressive
 * voice) or a row named for text-to-speech or speech-to-text (Kokoro, Whisper). What uses one is read from the voices
 * that exist — the hive's speech services (voiceServices), the hive's `voice` (its screens' voice and each call's), the
 * asking person's layer and the own layer of this screen and of every screen heard from lately (screens/showing.js) —
 * each a plain sentence, so the card can say why a service is needed.
 *
 * GET /api/services/voices (host: starting and stopping a service is). Nothing here starts, stops or writes anything.
 */
const KIND_NAMES = { quick: 'Live call', deep: 'Deep call', ambient: 'Ambient’s assistant' };

const isVoiceRow = s => !!s.speech || /\b(TTS|STT)\b/.test(s.label || '');
const rows = () => require('./services').INFERENCE_SERVICES.filter(isVoiceRow);
const portOf = url => require('./machines/use-ports').portOf(url);

/** What starting it costs, from the row's own words: its "Needs …" sentence, else whether a CPU image exists. */
function needs(s) {
  const said = /Needs [^.]*\./.exec(s.description || '');
  if (said) return said[0];
  return s.cpuImage ? 'Runs on an NVIDIA GPU, or on the CPU (slower).' : 'Needs an NVIDIA GPU.';
}

/** The row an engine id speaks through: '' is the hive's speech service, a row when its address is one on this machine. */
function rowOfEngine(engine, vs = require('./chat').loadVoiceServices()) {
  if (!engine) { const p = portOf(vs.ttsUrl); return p ? rows().find(s => s.port === p)?.id || null : null; }
  if (String(engine).startsWith('hosted:')) return null;   // a voice from a service: not a machine here
  return rows().some(s => s.id === engine) ? engine : null;
}

/** The engine a call's slot speaks through, given the layer's own engine (call-voices.js pick, without the fallbacks). */
function slotEngine(slot, layerEngine) {
  if (slot.service === 'hive') return '';
  if (slot.service !== undefined && slot.service !== null) return String(slot.service);
  return layerEngine || '';
}

const said = q => q && typeof q === 'object' && (q.service || q.voice || Number(q.speed) > 0);

/** Sentences "<who>'s voice", "<who>'s Live call" for one `voice` value, added under the row each speaks through. */
function addLayer(uses, who, v, vs) {
  if (!v || typeof v !== 'object') return;
  const whose = who === 'your' ? 'your' : `${who}’s`;
  const add = (engine, what) => { const r = rowOfEngine(engine, vs); if (r) (uses[r] ||= []).push(`${whose} ${what}`); };
  if (v.engine || v.ttsVoice) add(v.engine || '', 'voice');
  for (const k of Object.keys(KIND_NAMES)) if (said(v[k])) add(slotEngine(v[k], v.engine), KIND_NAMES[k]);
}

/** Every voice that uses each voice row: {rowId: [sentences]}. `screen` and `userId`: who asks, counted too. */
function uses({ screen = null, userId = null } = {}) {
  const vs = require('./chat').loadVoiceServices();
  const out = {};
  const tts = rowOfEngine('', vs), sttPort = portOf(vs.sttUrl);
  if (tts) (out[tts] ||= []).push('the hive’s speech service');
  const stt = sttPort ? rows().find(s => s.port === sttPort) : null;
  if (stt) (out[stt.id] ||= []).push('the hive’s speech-to-text');
  addLayer(out, 'the hive', require('./utils').loadPrefs().voice, vs);
  const screens = require('./screens'), devices = require('./api-v1/devices');
  if (userId) addLayer(out, 'your', screens.personLayer(userId).voice, vs);
  let seen = [];
  try { seen = Object.keys(require('./screens/showing').all()); } catch { /* none heard from */ }
  for (const id of new Set([screen, ...seen].filter(Boolean))) {
    let name = 'a screen';
    try { name = devices.get(id)?.name || name; } catch { /* gone */ }
    addLayer(out, id === screen ? 'this screen' : name, screens.layer(id).voice, vs);
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
  return out;
}

/** Whether a row answers on this machine now. */
async function answers(s) {
  const path = s.speech || /TTS/.test(s.label) ? '/v1/audio/voices' : '/v1/models';
  try { return (await fetch(`http://127.0.0.1:${s.port}${path}`, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
}

/** The card's picture: each voice row with whether it runs, what starting it needs, and what uses it. */
async function list({ screen = null, userId = null } = {}) {
  const saved = require('./utils').loadPrefs().serviceSettings || {};
  const used = uses({ screen, userId });
  const vs = require('./chat').loadVoiceServices();
  const services = await Promise.all(rows().map(async s => ({
    id: s.id, label: s.label, port: s.port, url: `http://127.0.0.1:${s.port}`, running: await answers(s), needs: needs(s),
    gpu: saved[s.id]?.gpu || 'all', modelId: saved[s.id]?.modelId || '', speaks: !!s.speech || /TTS/.test(s.label), engine: !!s.speech, usedBy: used[s.id] || [],
  })));
  // The hive's speech service at an address that is not a row here (another machine): only whether it answers.
  const hiveRow = rowOfEngine('', vs);
  let hive = { url: vs.ttsUrl, row: hiveRow };
  if (!hiveRow) hive = { ...hive, running: await require('./tts-engines').answers({ ttsUrl: vs.ttsUrl }) };
  return { services, hive, unused: services.filter(s => s.running && !s.usedBy.length).map(s => s.id) };
}

function mount(app) {
  app.get('/api/services/voices', async (req, res) => {
    try {
      res.json(await list({ screen: req.auth?.session?.screen || req.auth?.session?.deviceId || null, userId: req.auth?.user?.id || null }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { list, uses, rowOfEngine, needs, isVoiceRow, mount, KIND_NAMES };

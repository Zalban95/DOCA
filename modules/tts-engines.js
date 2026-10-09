'use strict';

/**
 * The voices a screen can be answered in: the hive's speech service (Settings → Voice: Kokoro by default, or any
 * OpenAI-compatible server) and each speech service of the Services tab that this machine runs (speech-services.js:
 * the expressive voice). A screen picks one (its setting `voice.engine`, beside `ttsVoice` and `ttsSpeed`); empty is
 * the hive's.
 *
 * An engine has the fields tts-voices.js reads (ttsUrl, ttsModel, ttsVoice, ttsSpeed) and two of its own: `tags` —
 * how it takes a tone (voice-tags.js; null: it does not, and tags are dropped) — and `languages`, when it must be told
 * the language of what it speaks (speech-language.js).
 */

const local = port => `http://127.0.0.1:${port}`;

/** The speech rows of the Services tab. */
const rows = () => require('./services').INFERENCE_SERVICES.filter(s => s.speech);

/** What a speech row is as an engine. */
function fromRow(svc, vs = {}) {
  return { id: svc.id, label: svc.label, ttsUrl: local(svc.port), ttsModel: svc.speech.model, ttsVoice: svc.speech.voice,
    ttsSpeed: vs.ttsSpeed || 1.0, tags: svc.speech.tags || null, languages: svc.speech.languages || null };
}

/**
 * The hive's own: Settings → Voice. When its address is one of the speech rows on this machine it is that voice, and
 * takes tone and language as that voice does.
 */
function hive() {
  const vs = require('./chat').loadVoiceServices();
  let port = null, host = '';
  try { const u = new URL(vs.ttsUrl); port = Number(u.port); host = u.hostname; } catch { /* an address that does not parse is still the hive's */ }
  const svc = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(host) ? rows().find(s => s.port === port) : null;
  return { id: '', label: 'The hive\'s speech service', ...vs, tags: svc?.speech.tags || null, languages: svc?.speech.languages || null };
}

/** Every engine by id ('' is the hive's), whether or not it answers. */
function all() {
  const h = hive();
  return [h, ...rows().map(s => fromRow(s, h))];
}

/** The engine a screen's voice setting names, else the hive's — never a row that does not exist. */
function forVoice(mine = {}) {
  if (!mine.engine) return hive();
  const hosted = require('./hosted-voices').engine(mine);   // a voice from a service (hosted-voices/), when it chose one
  if (hosted) return hosted;
  const svc = rows().find(s => s.id === mine.engine);
  return svc ? fromRow(svc, hive()) : hive();
}

/** Whether an engine answers now (the Services row is started). */
async function answers(engine) {
  try { return (await fetch(`${engine.ttsUrl}/v1/audio/voices`, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
}

/**
 * What a screen can choose from: the hive's always, a speech service while it answers, and a voice from a service
 * whose key is kept and that this person may use (`host`: they hold host, or the admin opened the key to everyone).
 */
async function available({ host = true } = {}) {
  const list = all();
  const up = await Promise.all(list.map(e => (e.id ? answers(e) : true)));
  const hosted = require('./hosted-voices').list({ host }).filter(h => h.usable).map(h => ({ id: h.id, label: `${h.label} (a service)`, tags: true, hosted: true }));
  return [...list.filter((_, i) => up[i]).map(e => ({ id: e.id, label: e.label, tags: !!e.tags })), ...hosted];
}

/**
 * The request body for one sentence: its tags made into words or dropped (voice-tags.js), its language named when the
 * engine needs one and it can be told, and the speed asked or the engine's.
 */
function body(engine, text, { voice, speed, format = 'mp3' } = {}) {
  const { input, instructions } = require('./voice-tags').forVoice(text, engine.tags);
  const language = engine.languages ? require('./speech-language').guess(input, engine.languages) : null;
  return { model: engine.ttsModel, input, voice: voice || engine.ttsVoice, response_format: format,
    speed: Math.min(4, Math.max(0.25, Number(speed) > 0 ? Number(speed) : Number(engine.ttsSpeed) || 1)),   // the range Kokoro and vLLM-Omni take; past it, a 400
    ...(instructions ? { instructions } : {}), ...(language ? { language } : {}) };
}

module.exports = { hive, all, forVoice, available, answers, body, fromRow };

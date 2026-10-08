'use strict';

/**
 * The voices the speech service has, and a voice name made into one of them. A screen's voice was a free text field,
 * and "Heart" — what a person calls Kokoro's af_heart — was refused by the service on every sentence, so a call
 * answered only in text (2026-10-05, on a phone). Now a name is matched to the service's own list (exactly, ignoring
 * case, or as the part after a prefix: "heart" → af_heart), and one that matches nothing falls back to the hive's.
 */
const TTL = 10 * 60 * 1000;
const _cache = new Map();   // ttsUrl → {at, voices}

/** The service's voices (OpenAI-compatible servers that list them: Kokoro's /v1/audio/voices), or [] when it does not say. */
async function list(vs = require('./chat').loadVoiceServices(), { host = true } = {}) {
  if (vs.hosted) return (await named(vs, { host })).map(v => v.id);
  const hit = _cache.get(vs.ttsUrl);
  if (hit && Date.now() - hit.at < TTL) return hit.voices;
  let voices = [];
  try {
    const r = await fetch(`${vs.ttsUrl}/v1/audio/voices`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) { const j = await r.json(); voices = (Array.isArray(j) ? j : j.voices || []).map(v => (typeof v === 'string' ? v : v.id || v.name)).filter(Boolean); }
  } catch { /* a service that does not list them: names pass as given */ }
  _cache.set(vs.ttsUrl, { at: Date.now(), voices });
  return voices;
}

/** A voice service's voices as {id, name} (hosted-voices/: an ElevenLabs voice's id says nothing to a person), cached like the rest. */
async function named(vs, { host = true } = {}) {
  const at = `${vs.id}\u0000${host}`;
  const hit = _cache.get(at);
  if (hit && Date.now() - hit.at < TTL && hit.voices.length) return hit.voices;
  const voices = await require('./hosted-voices').voices(vs, { host });
  _cache.set(at, { at: Date.now(), voices });
  return voices;
}

/** `want` as one of `voices`, or null. */
function match(want, voices) {
  const w = String(want || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!w) return null;
  return voices.find(v => v.toLowerCase() === w) || voices.find(v => v.toLowerCase().split('_').slice(1).join('_') === w)
    || voices.find(v => v.toLowerCase().endsWith(`_${w}`)) || null;
}

/** The voice to send: the wanted one as the service names it, else the hive's — `fellBack` says when. */
async function resolve(want, vs = require('./chat').loadVoiceServices(), { host = true } = {}) {
  if (!want) return { voice: vs.ttsVoice, fellBack: false };
  const voices = await list(vs, { host });
  if (!voices.length) return { voice: want, fellBack: false };
  const m = match(want, voices);
  return m ? { voice: m, fellBack: false } : { voice: match(vs.ttsVoice, voices) || vs.ttsVoice, fellBack: true };
}

module.exports = { list, named, match, resolve };

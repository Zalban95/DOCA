'use strict';

/**
 * Speech → text through the hive's speech service (Settings → Voice), moved out of chat.js along its seam: the panel's
 * call, a device's call (realtime/pipeline.js), a channel's voice note and a prompt's spoken answer all come here.
 */
/**
 * Transcribe an audio buffer via the configured STT service.
 * Shared by the legacy chat endpoint and the /api/v1 voice escape hatch.
 * @returns {Promise<string>} transcript text
 */
// Whether this STT service takes faster-whisper's `vad_filter` (an OpenAI-shaped service may refuse an unknown field):
// learned from its first answer, per address.
const _vadSupport = new Map();

/**
 * Speech → text, without the words a speech model invents in silence (modules/stt-filter.js). `prompt` biases the
 * spelling (a wake word, a name). With faster-whisper's voice-activity filter a recording with no speech in it fails
 * (500): that is "nobody spoke", confirmed by asking once more without the filter and dropping a silence phrase.
 */
/** Words from a recording: `''` when nobody spoke (transcribeHeard says why). */
async function transcribeAudio(buffer, mimetype, filename, opts = {}) {
  return (await transcribeHeard(buffer, mimetype, filename, opts)).text;
}

/**
 * The same, saying why it came back empty (`filtered`: the silence phrase screened out, stt-filter.js) and in which
 * language (`language`, guessed from the words — lang-guess.js). `language` given: the transcriber is told it and does
 * not guess (a screen's `call.language`). `usual` given instead (the person's usual language, call-language.js): a
 * short transcript that came back in another language is asked for once more in the usual one — whisper's own guess
 * on a second or two of a noisy room is the weakest thing in a call (2026-10-08: "Что это?") — and kept when that
 * finds words; `heardAs` then says what the first answer was in.
 */
async function transcribeHeard(buffer, mimetype, filename, { prompt, language = null, usual = null } = {}) {
  const lang = require('./lang-guess');
  const first = await once(buffer, mimetype, filename, { prompt, language });
  const out = { ...first, language: language || lang.guess(first.text) };
  if (language || !usual || !first.text || !out.language || out.language === usual) return out;
  if (first.text.split(/\s+/).length > SHORT_WORDS) return out;   // a sentence long enough is whisper's to judge
  const again = await once(buffer, mimetype, filename, { prompt, language: usual }).catch(() => null);
  if (!again?.text) return out;   // nothing in the usual language: what it heard stands, and the agent is told to check it
  return { ...again, language: usual, heardAs: out.language };
}

// A transcript this short in another language than the person's is checked again in theirs.
const SHORT_WORDS = 5;

/** One request to the speech service — started first when it is stopped and starts when needed (service-life/). */
async function once(buffer, mimetype, filename, opts = {}) {
  const vs = require('./chat').loadVoiceServices();
  const life = require('./service-life');
  await life.ensure(vs.sttUrl, { role: 'stt' });
  return life.use(vs.sttUrl, () => ask1(vs, buffer, mimetype, filename, opts));
}

async function ask1(vs, buffer, mimetype, filename, { prompt, language } = {}) {
  const screened = text => (require('./stt-filter').isHallucination(text) ? { text: '', filtered: text || null } : { text, filtered: null });
  const ask = vad => {
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: mimetype || 'audio/webm' }), filename || 'audio.webm');
    formData.append('model', vs.sttModel);
    if (prompt) formData.append('prompt', String(prompt).slice(0, 200));
    if (language) formData.append('language', language);   // whisper's ISO 639-1 code: it then does not guess
    if (vad) formData.append('vad_filter', 'true');
    return fetch(`${vs.sttUrl}/v1/audio/transcriptions`, { method: 'POST', body: formData, signal: AbortSignal.timeout(30000) });
  };
  const tryVad = _vadSupport.get(vs.sttUrl) !== false;
  let resp = await ask(tryVad);
  if (tryVad && !resp.ok) {
    if (resp.status === 400 || resp.status === 422) _vadSupport.set(vs.sttUrl, false);   // it does not take the field
    const first = resp.status;
    resp = await ask(false);
    if (first >= 500 && resp.ok) {
      // The filter found no speech; the plain answer is kept only if it is more than a silence phrase.
      return screened(((await resp.json()).text || '').trim());
    }
  } else if (tryVad && resp.ok) _vadSupport.set(vs.sttUrl, true);
  if (!resp.ok) {
    // The service's own words are usually "Internal Server Error" and nothing
    // else, which sends the reader looking in this panel for a fault that is
    // not here. Name what was called, with what, and the two things that are
    // actually wrong when a speech service refuses a request it received.
    const err = (await resp.text()).trim();
    throw Object.assign(new Error(
      `STT error ${resp.status} from ${vs.sttUrl} (model ${vs.sttModel})`
      + `${err ? `: ${err.slice(0, 300)}` : ''}`
      + ' — the service received the audio and refused it. Check that the model name is one it has, and that '
      + `it accepts ${mimetype || 'this format'}; Settings → Voice has the URL.`), { status: resp.status });
  }
  return screened(((await resp.json()).text || '').trim());
}

/**
 * Words with their times, for a recording kept rather than spoken now (the Library, library/extract.js): the
 * OpenAI-shaped `verbose_json`, whose segments faster-whisper and OpenAI both return with start and end seconds. Long
 * recordings take long, so the wait is minutes, not a call's 30 s. Silence phrases are screened per segment.
 */
async function transcribeSegments(buffer, mimetype, filename, { timeoutMs = 900000, signal } = {}) {
  const vs = require('./chat').loadVoiceServices();
  if (!vs.sttUrl) throw Object.assign(new Error('No speech-to-text service is set (Settings → Voice).'), { status: 409 });
  const life = require('./service-life');
  await life.ensure(vs.sttUrl, { role: 'stt' });
  return life.use(vs.sttUrl, async () => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimetype || 'audio/wav' }), filename || 'audio.wav');
    form.append('model', vs.sttModel);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    const r = await fetch(`${vs.sttUrl}/v1/audio/transcriptions`, { method: 'POST', body: form, signal: signal || AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw Object.assign(new Error(`STT error ${r.status} from ${vs.sttUrl} (model ${vs.sttModel})`), { status: r.status });
    const j = await r.json();
    const bad = t => require('./stt-filter').isHallucination(t);
    const segments = (Array.isArray(j.segments) ? j.segments : [])
      .map(x => ({ start: Number(x.start) || 0, end: Number(x.end) || 0, text: String(x.text || '').trim() })).filter(x => x.text && !bad(x.text));
    if (!segments.length && j.text && !bad(j.text)) segments.push({ start: 0, end: Number(j.duration) || 0, text: String(j.text).trim() });
    return { text: segments.map(x => x.text).join(' '), language: j.language || null, duration: Number(j.duration) || null, segments };
  });
}

module.exports = { transcribeAudio, transcribeHeard, transcribeSegments };

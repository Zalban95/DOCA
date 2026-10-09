'use strict';

/**
 * The hive's own voice as a realtime adapter: speech-to-text, a turn and text-to-speech behind the same interface as
 * openai.js and gemini.js, so `serve()` and a device's call (`/api/v1/call`) are one thing whichever engine the hub has
 * (docs/design/watch-call.md). No provider and no key — the voice services of Settings → Voice.
 *
 * In: PCM16 mono 24 kHz. Speech is found by level against the room's own floor (20 ms frames): three times the floor,
 * and never under `MIN_LEVEL` — about -51 dBFS, low enough for a watch's microphone at arm's length (the old floor of
 * 400, -38 dBFS, let a quiet wrist talk to a call that never heard it, 2026-10-08). An utterance ends after `silenceMs`
 * of quiet, and one with less than 300 ms of speech in it is dropped (a blip is what Whisper turns into "Thank you.").
 * It is transcribed (chat.transcribeHeard, which screens silence phrases), emitted as `user`, and handed on as the
 * `doca` tool call — this engine has no model of its own, so everything said is a request to the hive.
 *
 * Nothing it drops is dropped in silence (asked 2026-10-08): `utterance`, `dropped` and `stt` say what each stage did
 * (realtime/call-log.js keeps them), and `notice` is for the caller — no words in what was said, the transcriber did not
 * answer, sound that never rose above the room. `stats` is the audio so far: frames, the loudest level, the floor.
 * `heard` is emitted the moment an utterance ends, before it is transcribed, so a client can say "heard you" at once.
 * Out: each sentence of an answer synthesized as raw PCM (`response_format: pcm`, 24 kHz) and sent as it comes;
 * `stream()` takes an answer while the model is still writing it, so its first sentence plays before the last exists.
 * Speech while it talks stops it (`interrupted`); the rest of that answer is dropped.
 *
 * **Its own voice is not a request** (asked 2026-10-09 from the Xiaomi Watch 5: "in the call the agent picks up its own
 * voice"). A device's speaker leaks the answer back into its microphone, echo canceller or not. An utterance that began
 * while the answer played (or within `SPEAKING_GRACE_MS` of its end) is held — no `heard` yet — until its words are
 * known; when most of them (`isEcho`: ≥ 60 %, as the panel's `_callIsEcho`) are in what this call just said, it is
 * dropped ("our own voice", in the call log) and nothing reaches the hive. Anything else goes on as before.
 */
const { EventEmitter } = require('events');

const RATE = 24000, FRAME = RATE / 50 * 2;   // 20 ms of PCM16
const MIN_VOICED_MS = 300, MAX_UTTERANCE_MS = 30000;
const MIN_LEVEL = 90;           // RMS of PCM16: about -51 dBFS
const ZEROS_NOTICE_MS = 10000;  // exact digital silence this long: a muted microphone (a gate or Opus's own silence is briefer)
// Sound over the room that never counts as speech, this much of it (decaying in quiet), before the caller is told it is
// too quiet. It was 400 ms, and a watch was told "too quietly" two seconds into a call it then heard fine (2026-10-09):
// the breath before speaking, a rustle, the room. Never counted while an utterance is gathered or being transcribed, nor
// while the answer plays (the device's own speaker); said once, and again only after speech was heard in between.
const QUIET_NOTICE_MS = 8000;
const SPEAKING_GRACE_MS = 1500; // after the answer's audio ends: its tail and the device's echo are not the room
/** The pause that ends what was said, when nothing is set (call-pause.js): a device's call, longer than the panel's
 *  900 ms of before, since a pause mid-sentence on a wrist let the turn start (2026-10-09). */
const DEFAULT_SILENCE_MS = 1400;
/** What was said is compared with an utterance that began this soon after it was spoken (the room, the relay's delay). */
const ECHO_LOOKBACK_MS = 3000;

/** Words of two letters or more, lower case — the panel's `_callIsEcho` tokens. */
const echoWords = t => String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);

/** Whether `words` heard are mostly the voice's own: at least 60 % of them in `said` (what the call just spoke). */
function isEcho(words, said) {
  const w = echoWords(words), own = new Set(echoWords(Array.isArray(said) ? said.join(' ') : said));
  return w.length > 0 && own.size > 0 && w.filter(x => own.has(x)).length / w.length >= 0.6;
}

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function rms(frame) {
  let s = 0;
  for (let i = 0; i + 1 < frame.length; i += 2) { const v = frame.readInt16LE(i); s += v * v; }
  return Math.sqrt(s / (frame.length / 2));
}

/** Words a person hears: no markdown marks, no code, no addresses read out letter by letter. */
function speakable(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, ' (code shown in the chat) ').replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, 'a link').replace(/[*_~]+/g, '').replace(/[#>|]+/g, ' ').replace(/\s+/g, ' ').replace(/ ([.,!?;:])/g, '$1').trim();
}

/**
 * Sentences out of text that arrives in pieces (a model's deltas): `push` returns the ones that are complete, `push(null)`
 * says a piece ended (a tool call follows: what came before is a whole thing to say), `rest()` is what is left.
 */
function gatherer() {
  let buf = '';
  return {
    push(delta) {
      if (delta === null) { const all = buf.trim(); buf = ''; return all ? [all] : []; }
      buf += delta;
      const m = /^[\s\S]*[.!?;:](?=\s)/.exec(buf);   // up to the last sentence end followed by a space
      if (!m || m[0].trim().length < 2) return [];
      buf = buf.slice(m[0].length);
      return [m[0].trim()];
    },
    rest() { const all = buf; buf = ''; return all; },
  };
}

const sentences = text => (speakable(text).match(/[^.!?;:]+[.!?;:]*\s*/g) || []).map(s => s.trim()).filter(s => s.length > 1);

/**
 * `voice` is the call's voice (call-voices.js pick: `{engine, voice, speed}` — a device's Live call voice); without
 * one, the hive's speech service as it is.
 */
function connect({ silenceMs = DEFAULT_SILENCE_MS, synth, transcribe, voice = null, language = {} } = {}) {
  const em = new EventEmitter();
  const chat = require('../chat');
  // `language`: {language, usual} for the device's screen and person (call-language.js).
  // A speech service DOCA stopped for being idle starts again, and the caller is told (service-life/demand.js).
  const ready = (url, role, stage) => require('../service-life').ensure(url, { role, onStarting: text => em.emit('notice', { stage, text }) });
  transcribe = transcribe || (async buf => {
    await ready(chat.loadVoiceServices().sttUrl, 'stt', 'stt');
    return chat.transcribeHeard(buf, 'audio/wav', 'call.wav', { language: language.language || null, usual: language.usual || null });
  });
  const speakWith = async (vs, text, v) => {
    const engines = require('../tts-engines');   // a tone tag becomes words for a voice that takes them, else goes
    if (!vs.hosted) await ready(vs.ttsUrl, 'speech', 'tts');
    const name = v?.voice ? (await require('../tts-voices').resolve(v.voice, vs)).voice : undefined;   // "Ryan" → ryan
    const r = await require('../service-life').use(vs.ttsUrl, () => fetch(`${vs.ttsUrl}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(engines.body(vs, text, { format: 'pcm', voice: name, speed: v?.speed })), signal: AbortSignal.timeout(30000) }));
    if (!r.ok) throw new Error(`text-to-speech (${vs.label || vs.id || 'the hive'}) answered ${r.status}${await r.text().then(t => `: ${t.slice(0, 120)}`, () => '')}`);
    const pcm = Buffer.from(await r.arrayBuffer());
    if (pcm.length < 2) throw new Error(`text-to-speech (${vs.label || vs.id || 'the hive'}) sent no audio`);
    return pcm.length % 2 ? pcm.subarray(0, pcm.length - 1) : pcm;   // PCM16: never half a sample
  };
  // The call's voice, and when it fails the hive's own: an answer said in another voice beats one never said. The
  // first failure is told to the caller (tts) and kept in the call log; later sentences go straight to the hive's.
  let voiceDown = null;
  synth = synth || (async text => {
    const engines = require('../tts-engines'), own = voice?.engine || engines.hive();
    if (!own.id || voiceDown) return speakWith(own.id ? engines.hive() : own, text, own.id ? null : voice);
    try { return await speakWith(own, text, voice); } catch (e) {
      if (!voiceDown) {   // sentences start together: the first failure is the one told
        voiceDown = e.message;
        em.emit('tts', { error: e.message, fallback: true });
        em.emit('notice', { stage: 'tts', text: `The call's voice (${own.label || own.id}) did not answer — speaking in the hive's voice.` });
      }
      return speakWith(engines.hive(), text, null);
    }
  });
  let closed = false, rest = Buffer.alloc(0), floor = null, utter = null, quietMs = 0, epoch = 0, speakingUntil = 0, ids = 0, overMs = 0;
  let speech = Promise.resolve(), nearMs = 0, toldQuiet = false, zeroMs = 0, toldZeros = false, deciding = 0;
  let spoken = [];   // {text, until}: what this call said lately, for telling its echo from a person (isEcho)
  const stats = { frames: 0, peak: 0, floor: null };

  const utterance = async (pcm, { overlapped = false, at = Date.now() } = {}) => {
    let heard = { text: '', filtered: null };
    const t0 = Date.now();
    deciding++;
    try {
      const r = await transcribe(wav(pcm));
      heard = typeof r === 'string' || r == null ? { text: String(r || ''), filtered: null } : r;
    } catch (e) {
      deciding--;
      em.emit('stt', { error: e.message, ms: Date.now() - t0 });
      em.emit('notice', { stage: 'stt', text: 'The transcriber did not answer — say it again in a moment.' });
      return em.emit('error', `speech-to-text: ${e.message}`);
    }
    deciding--;
    const text = String(heard.text || '').trim();
    if (text) { toldQuiet = false; nearMs = 0; }   // words came through: a later stretch of too-quiet sound is news again
    em.emit('stt', { words: text ? text.split(/\s+/).length : 0, filtered: heard.filtered || null, ms: Date.now() - t0, language: heard.language || null, heardAs: heard.heardAs || null });
    if (closed) return;
    if (overlapped) {
      const said = spoken.filter(x => x.until >= at - ECHO_LOOKBACK_MS).map(x => x.text);
      if (text && isEcho(text, said)) {
        const n = echoWords(text).length;
        return em.emit('dropped', `our own voice — ${n} word${n === 1 ? '' : 's'} heard back from the answer it was saying`);
      }
      em.emit('heard');   // held while the answer played: it is a person after all
    }
    if (!text) return em.emit('notice', { stage: 'stt', text: 'I didn\'t catch that — say it again?' });
    em.emit('user', text);
    em.emit('tool', { id: `p${++ids}`, name: 'doca', args: { request: text } });
  };

  const frame = f => {
    const level = rms(f);
    if (floor === null) floor = Math.min(level, 300);   // the first frame says roughly what the room is
    const voiced = level > Math.max(MIN_LEVEL, floor * 3);
    // The room, learned while nobody speaks — slowly from sound well over it (a voice too quiet to count must not
    // become the room before it can be told), at once from what is near the floor.
    const near = !voiced && level > Math.max(25, floor * 1.8);
    if (!voiced) { const k = near ? 0.004 : 0.02; floor = floor * (1 - k) + level * k; }
    stats.frames++; stats.floor = Math.round(floor); if (level > stats.peak) stats.peak = Math.round(level);
    // A watch whose call left the screen keeps sending — zeros: Android silences a background app's microphone
    // (seen 2026-10-08, a call recording "silenced" for an hour). Said once; the call's idle end follows (index.js).
    const playing = Date.now() < speakingUntil + SPEAKING_GRACE_MS;   // the answer is playing: a device may mute its microphone meanwhile
    zeroMs = level === 0 && !playing ? zeroMs + 20 : 0;
    if (zeroMs >= ZEROS_NOTICE_MS && !toldZeros) {
      toldZeros = true;
      em.emit('notice', { stage: 'audio', text: 'The microphone has sent only silence for a while — if you are talking, the device has muted it: keep the call on screen.' });
    } else if (level > 0) toldZeros = false;
    // Sound well over the room that never counts as speech, for a long stretch: a microphone too far or too quiet.
    // Said, not swallowed — but never while speech is being gathered or decided, nor while the answer plays.
    if (utter || deciding || playing) nearMs = 0;
    else if (!voiced) nearMs = near ? nearMs + 20 : Math.max(0, nearMs - 5);
    if (nearMs >= QUIET_NOTICE_MS && !toldQuiet) {
      toldQuiet = true; nearMs = 0;
      em.emit('notice', { stage: 'audio', text: 'I can hear sound, but too quietly to make out words — speak up or hold the microphone closer.' });
    }
    // While it talks, only ~0.3 s of steady speech is a person talking over it; a click or a cough is not.
    overMs = voiced && Date.now() < speakingUntil ? overMs + 20 : 0;
    if (overMs >= 300) { epoch++; speakingUntil = 0; overMs = 0; em.emit('interrupted'); }
    if (voiced && !utter) utter = { chunks: [], voicedMs: 0, ms: 0, peak: 0, at: Date.now(), overlapped: Date.now() < speakingUntil + SPEAKING_GRACE_MS };
    if (!utter) return;
    utter.chunks.push(f); utter.ms += 20; if (level > utter.peak) utter.peak = level;
    if (voiced) { utter.voicedMs += 20; quietMs = 0; } else quietMs += 20;
    if (quietMs >= silenceMs || utter.ms >= MAX_UTTERANCE_MS) {
      const u = utter; utter = null; quietMs = 0;
      if (u.voicedMs >= MIN_VOICED_MS) {
        nearMs = 0;
        em.emit('utterance', { ms: u.ms, voicedMs: u.voicedMs, peak: u.peak, overlapped: u.overlapped });
        if (!u.overlapped) em.emit('heard');   // over the answer: said once its words show it is not the answer's own
        utterance(Buffer.concat(u.chunks), { overlapped: u.overlapped, at: u.at });
      }
      else em.emit('dropped', `${u.voicedMs} ms of speech — under ${MIN_VOICED_MS} ms, a click or a breath`);
    }
  };

  /**
   * Each sentence spoken in order, as soon as it is synthesized; an interruption drops what is left. `mine` is the
   * epoch the answer began in (a part of an answer that arrives after the person talked over it is dropped too), and
   * `end: false` is a part of an answer still being written: no `turn` after it.
   */
  const answers = new Map();   // epoch → what this answer has said so far
  const speak = (text, { mine = epoch, end = true } = {}) => {
    if (end && String(text).trim() === '✓') { em.emit('agent', '✓'); em.emit('turn'); return; }   // an action done, not narrated: shown, not spoken
    const tally = answers.get(mine) || { sentences: 0, bytes: 0, failed: 0 };
    answers.set(mine, tally);
    for (const s of sentences(text)) {
      if (!require('../voice-tags').strip(s)) continue;   // a tag alone has nothing to say
      const t0 = Date.now();
      const pcm = synth(s).then(audio => { em.emit('tts', { ms: Date.now() - t0, bytes: audio?.length || 0 }); return audio; }, e => {   // all start at once, play in order
        tally.failed++;
        em.emit('tts', { error: e.message, ms: Date.now() - t0 });
        em.emit('notice', { stage: 'tts', text: 'The answer could not be spoken — it is in the conversation.' });
        em.emit('error', e.message); return null;
      });
      speech = speech.then(async () => {
        const audio = await pcm;
        if (!audio || closed || mine !== epoch) return;
        tally.sentences++; tally.bytes += audio.length;
        em.emit('agent', `${require('../voice-tags').strip(s)} `);   // what is shown: never the tags
        speakingUntil = Math.max(Date.now(), speakingUntil) + audio.length / (RATE * 2) * 1000;
        spoken = [...spoken.filter(x => x.until >= Date.now() - ECHO_LOOKBACK_MS * 4), { text: s, until: speakingUntil }].slice(-40);
        for (let i = 0; i < audio.length; i += RATE / 5) em.emit('audio', audio.subarray(i, i + RATE / 5));   // 100 ms frames
      });
    }
    if (end) speech = speech.then(() => {
      answers.delete(mine);
      // One line per answer: what was said and how much audio went out (2026-10-09: a call whose answer the watch never
      // played left the log saying nothing about the audio at all).
      if (!closed) em.emit('spoken', { sentences: tally.sentences, bytes: tally.bytes, ms: Math.round(tally.bytes / (RATE * 2) * 1000), failed: tally.failed, cut: mine !== epoch });
      if (!closed && mine === epoch) em.emit('turn');
    });
  };

  em.literal = true;   // what it is handed is said as written: serve() words its notices for a listener, not a model
  em.stats = stats;
  em.audio = buf => {
    if (closed) return;
    rest = Buffer.concat([rest, buf]);
    while (rest.length >= FRAME) { frame(rest.subarray(0, FRAME)); rest = rest.subarray(FRAME); }
  };
  em.toolResult = (_id, text) => speak(text);
  em.say = text => speak(text);
  /** One answer arriving in parts: `part` speaks what is written so far, `end` the rest and closes the answer. */
  em.stream = () => { const mine = epoch; return { part: t => speak(t, { mine, end: false }), end: t => speak(t, { mine }) }; };
  em.userText = text => { em.emit('user', text); em.emit('tool', { id: `p${++ids}`, name: 'doca', args: { request: String(text) } }); };
  em.close = () => { if (closed) return; closed = true; em.emit('closed', { code: 1000, reason: '' }); };
  setImmediate(() => { if (!closed) em.emit('ready'); });
  return em;
}

module.exports = { connect, RATE, MIN_LEVEL, DEFAULT_SILENCE_MS, QUIET_NOTICE_MS, wav, rms, speakable, sentences, gatherer, isEcho };

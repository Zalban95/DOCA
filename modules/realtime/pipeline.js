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
 */
const { EventEmitter } = require('events');

const RATE = 24000, FRAME = RATE / 50 * 2;   // 20 ms of PCM16
const MIN_VOICED_MS = 300, MAX_UTTERANCE_MS = 30000;
const MIN_LEVEL = 90;           // RMS of PCM16: about -51 dBFS
const ZEROS_NOTICE_MS = 10000;  // exact digital silence this long: a muted microphone (a gate or Opus's own silence is briefer)
const QUIET_NOTICE_MS = 400;    // this much sound over the room that never counted as speech is said, once a minute at most

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

function connect({ silenceMs = 900, synth, transcribe } = {}) {
  const em = new EventEmitter();
  const chat = require('../chat');
  transcribe = transcribe || (buf => chat.transcribeHeard(buf, 'audio/wav', 'call.wav'));
  synth = synth || (async text => {
    const engines = require('../tts-engines'), vs = engines.hive();   // a tone tag becomes words for a voice that takes them, else goes
    const r = await fetch(`${vs.ttsUrl}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(engines.body(vs, text, { format: 'pcm' })), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`text-to-speech answered ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  });
  let closed = false, rest = Buffer.alloc(0), floor = null, utter = null, quietMs = 0, epoch = 0, speakingUntil = 0, ids = 0, overMs = 0;
  let speech = Promise.resolve(), nearMs = 0, toldQuietAt = 0, zeroMs = 0, toldZeros = false;
  const stats = { frames: 0, peak: 0, floor: null };

  const utterance = async pcm => {
    let heard = { text: '', filtered: null };
    const t0 = Date.now();
    try {
      const r = await transcribe(wav(pcm));
      heard = typeof r === 'string' || r == null ? { text: String(r || ''), filtered: null } : r;
    } catch (e) {
      em.emit('stt', { error: e.message, ms: Date.now() - t0 });
      em.emit('notice', { stage: 'stt', text: 'The transcriber did not answer — say it again in a moment.' });
      return em.emit('error', `speech-to-text: ${e.message}`);
    }
    const text = String(heard.text || '').trim();
    em.emit('stt', { words: text ? text.split(/\s+/).length : 0, filtered: heard.filtered || null, ms: Date.now() - t0 });
    if (closed) return;
    if (!text) return em.emit('notice', { stage: 'stt', text: 'I didn\'t catch that — say it again?' });
    em.emit('user', text);
    em.emit('tool', { id: `p${++ids}`, name: 'doca', args: { request: text } });
  };

  const frame = f => {
    const level = rms(f);
    if (floor === null) floor = Math.min(level, 300);   // the first frame says roughly what the room is
    const voiced = level > Math.max(MIN_LEVEL, floor * 3);
    if (!voiced) floor = floor * 0.98 + level * 0.02;   // the room, learned while nobody speaks
    stats.frames++; stats.floor = Math.round(floor); if (level > stats.peak) stats.peak = Math.round(level);
    // A watch whose call left the screen keeps sending — zeros: Android silences a background app's microphone
    // (seen 2026-10-08, a call recording "silenced" for an hour). Said once; the call's idle end follows (index.js).
    zeroMs = level === 0 ? zeroMs + 20 : 0;
    if (zeroMs >= ZEROS_NOTICE_MS && !toldZeros) {
      toldZeros = true;
      em.emit('notice', { stage: 'audio', text: 'The microphone has sent only silence for a while — if you are talking, the device has muted it: keep the call on screen.' });
    } else if (level > 0) toldZeros = false;
    // Sound well over the room that never counts as speech: a microphone too far or too quiet. Said, not swallowed.
    if (!voiced) nearMs = level > Math.max(25, floor * 1.8) ? nearMs + 20 : Math.max(0, nearMs - 2);
    if (nearMs >= QUIET_NOTICE_MS && Date.now() - toldQuietAt > 60000) {
      toldQuietAt = Date.now(); nearMs = 0;
      em.emit('notice', { stage: 'audio', text: 'I can hear sound, but too quietly to make out words — speak up or hold the microphone closer.' });
    }
    // While it talks, only ~0.3 s of steady speech is a person talking over it; a click or a cough is not.
    overMs = voiced && Date.now() < speakingUntil ? overMs + 20 : 0;
    if (overMs >= 300) { epoch++; speakingUntil = 0; overMs = 0; em.emit('interrupted'); }
    if (voiced && !utter) utter = { chunks: [], voicedMs: 0, ms: 0, peak: 0 };
    if (!utter) return;
    utter.chunks.push(f); utter.ms += 20; if (level > utter.peak) utter.peak = level;
    if (voiced) { utter.voicedMs += 20; quietMs = 0; } else quietMs += 20;
    if (quietMs >= silenceMs || utter.ms >= MAX_UTTERANCE_MS) {
      const u = utter; utter = null; quietMs = 0;
      if (u.voicedMs >= MIN_VOICED_MS) { nearMs = 0; em.emit('utterance', { ms: u.ms, voicedMs: u.voicedMs, peak: u.peak }); em.emit('heard'); utterance(Buffer.concat(u.chunks)); }
      else em.emit('dropped', `${u.voicedMs} ms of speech — under ${MIN_VOICED_MS} ms, a click or a breath`);
    }
  };

  /**
   * Each sentence spoken in order, as soon as it is synthesized; an interruption drops what is left. `mine` is the
   * epoch the answer began in (a part of an answer that arrives after the person talked over it is dropped too), and
   * `end: false` is a part of an answer still being written: no `turn` after it.
   */
  const speak = (text, { mine = epoch, end = true } = {}) => {
    if (end && String(text).trim() === '✓') { em.emit('agent', '✓'); em.emit('turn'); return; }   // an action done, not narrated: shown, not spoken
    for (const s of sentences(text)) {
      if (!require('../voice-tags').strip(s)) continue;   // a tag alone has nothing to say
      const pcm = synth(s).catch(e => {   // all start at once, play in order
        em.emit('notice', { stage: 'tts', text: 'The answer could not be spoken — it is in the conversation.' });
        em.emit('error', e.message); return null;
      });
      speech = speech.then(async () => {
        const audio = await pcm;
        if (!audio || closed || mine !== epoch) return;
        em.emit('agent', `${require('../voice-tags').strip(s)} `);   // what is shown: never the tags
        speakingUntil = Math.max(Date.now(), speakingUntil) + audio.length / (RATE * 2) * 1000;
        for (let i = 0; i < audio.length; i += RATE / 5) em.emit('audio', audio.subarray(i, i + RATE / 5));   // 100 ms frames
      });
    }
    if (end) speech = speech.then(() => { if (!closed && mine === epoch) em.emit('turn'); });
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

module.exports = { connect, RATE, MIN_LEVEL, wav, rms, speakable, sentences, gatherer };

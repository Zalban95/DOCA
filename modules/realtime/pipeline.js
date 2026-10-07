'use strict';

/**
 * The hive's own voice as a realtime adapter: speech-to-text, a turn and text-to-speech behind the same interface as
 * openai.js and gemini.js, so `serve()` and a device's call (`/api/v1/call`) are one thing whichever engine the hub has
 * (docs/design/watch-call.md). No provider and no key — the voice services of Settings → Voice.
 *
 * In: PCM16 mono 24 kHz. Speech is found by level against the room's own floor (20 ms frames); an utterance ends after
 * `silenceMs` of quiet, and one with less than 300 ms of speech in it is dropped (a blip is what Whisper turns into
 * "Thank you."). It is transcribed (chat.transcribeAudio, which screens silence phrases), emitted as `user`, and handed
 * on as the `doca` tool call — this engine has no model of its own, so everything said is a request to the hive.
 * `heard` is emitted the moment an utterance ends, before it is transcribed, so a client can say "heard you" at once.
 * Out: each sentence of an answer synthesized as raw PCM (`response_format: pcm`, 24 kHz) and sent as it comes;
 * `stream()` takes an answer while the model is still writing it, so its first sentence plays before the last exists.
 * Speech while it talks stops it (`interrupted`); the rest of that answer is dropped.
 */
const { EventEmitter } = require('events');

const RATE = 24000, FRAME = RATE / 50 * 2;   // 20 ms of PCM16
const MIN_VOICED_MS = 300, MAX_UTTERANCE_MS = 30000;

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
  transcribe = transcribe || (buf => chat.transcribeAudio(buf, 'audio/wav', 'call.wav'));
  synth = synth || (async text => {
    const vs = chat.loadVoiceServices();
    const r = await fetch(`${vs.ttsUrl}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: vs.ttsModel, input: text, voice: vs.ttsVoice, response_format: 'pcm', speed: vs.ttsSpeed }), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`text-to-speech answered ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  });
  let closed = false, rest = Buffer.alloc(0), floor = 300, utter = null, quietMs = 0, epoch = 0, speakingUntil = 0, ids = 0, overMs = 0;
  let speech = Promise.resolve();

  const utterance = async pcm => {
    let text = '';
    try { text = String(await transcribe(wav(pcm)) || '').trim(); } catch (e) { return em.emit('error', `speech-to-text: ${e.message}`); }
    if (!text || closed) return;
    em.emit('user', text);
    em.emit('tool', { id: `p${++ids}`, name: 'doca', args: { request: text } });
  };

  const frame = f => {
    const level = rms(f), voiced = level > Math.max(400, floor * 3);
    if (!voiced) floor = floor * 0.98 + level * 0.02;   // the room, learned while nobody speaks
    // While it talks, only ~0.3 s of steady speech is a person talking over it; a click or a cough is not.
    overMs = voiced && Date.now() < speakingUntil ? overMs + 20 : 0;
    if (overMs >= 300) { epoch++; speakingUntil = 0; overMs = 0; em.emit('interrupted'); }
    if (voiced && !utter) utter = { chunks: [], voicedMs: 0, ms: 0 };
    if (!utter) return;
    utter.chunks.push(f); utter.ms += 20;
    if (voiced) { utter.voicedMs += 20; quietMs = 0; } else quietMs += 20;
    if (quietMs >= silenceMs || utter.ms >= MAX_UTTERANCE_MS) {
      const u = utter; utter = null; quietMs = 0;
      if (u.voicedMs >= MIN_VOICED_MS) { em.emit('heard'); utterance(Buffer.concat(u.chunks)); }
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
      const pcm = synth(s).catch(e => { em.emit('error', e.message); return null; });   // all start at once, play in order
      speech = speech.then(async () => {
        const audio = await pcm;
        if (!audio || closed || mine !== epoch) return;
        em.emit('agent', `${s} `);
        speakingUntil = Math.max(Date.now(), speakingUntil) + audio.length / (RATE * 2) * 1000;
        for (let i = 0; i < audio.length; i += RATE / 5) em.emit('audio', audio.subarray(i, i + RATE / 5));   // 100 ms frames
      });
    }
    if (end) speech = speech.then(() => { if (!closed && mine === epoch) em.emit('turn'); });
  };

  em.literal = true;   // what it is handed is said as written: serve() words its notices for a listener, not a model
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

module.exports = { connect, RATE, wav, rms, speakable, sentences, gatherer };

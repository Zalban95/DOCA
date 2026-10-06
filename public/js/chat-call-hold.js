/* Talking over the voice (asked 2026-10-05/06): a sustained sound while an answer plays — or in the gaps between its
   sentences — pauses it where it is; it is not a stop. The microphone is tapped as raw sound into a two-second ring
   (`_callTapStart`), so the decision hears the word that started it: the 0.8 s before the trigger and ~0.7 s after
   are transcribed at once. Real words end the answer for good — its request is aborted, so its turn stops — and the
   conversation keeps only what was heard (POST /api/chat/heard → harness/heard.js); then everything said from the
   trigger (pre-roll included) until a pause is sent as the next message. No words — a cough, a door, the room — and the
   voice goes on from exactly where it paused. */
let _callHold = null;       // {pcm: Float32Array[], words: bool|null, quietMs, timer}
let _callHeard = [];        // [{text, start, dur}]: the sentences of the current answer as they began to play
let _callHeardPending = null;
let _callTap = null, _callRing = [], _callRingLen = 0;   // the microphone as samples, the last two seconds

/** A sentence starts playing (chat-call-voice.js). */
function _callHeardMark(buf) { if (_callPlayCtx) _callHeard.push({ text: buf._docaText || '', start: _callPlayCtx.currentTime, dur: buf.duration || 0 }); }
/** A new answer begins (chat-call.js _callAnswer). */
function _callHeardReset() { _callHeard = []; }

/** Tap the call's microphone source: a ring of the last two seconds, and the hold's own copy while it decides. */
function _callTapStart(source) {
  const ctx = source.context;
  _callTap = ctx.createScriptProcessor(4096, 1, 1);
  _callRing = []; _callRingLen = 0;
  _callTap.onaudioprocess = e => {
    const x = new Float32Array(e.inputBuffer.getChannelData(0));
    _callRing.push(x); _callRingLen += x.length;
    while (_callRingLen - _callRing[0].length > ctx.sampleRate * 2) _callRingLen -= _callRing.shift().length;
    if (_callHold) _callHold.pcm.push(x);
  };
  source.connect(_callTap);
  _callTap.connect(ctx.destination);   // a processor runs only when connected; its output is silence
}

function _callTapStop() { try { _callTap?.disconnect(); } catch { /* gone */ } _callTap = null; _callRing = []; _callRingLen = 0; }

function _callHoldStart() {
  if (_callHold || !_callPlayCtx || !_callAudioCtx) return;
  _callPlayCtx.suspend().catch(() => {});   // paused exactly where it is: currentTime stops too
  const rate = _callAudioCtx.sampleRate, pre = [];
  let need = rate * 0.8;   // the word that started it
  for (let i = _callRing.length - 1; i >= 0 && need > 0; i--) { pre.unshift(_callRing[i]); need -= _callRing[i].length; }
  _callHold = { pcm: pre, words: null, quietMs: 0, rate };
  _callHold.timer = setTimeout(() => _callHoldDecide(), 700);
}

/** Speech went quiet while a hold collects: after the call's pause, what was said is the next message. */
function _callHoldQuiet(dt, loud) {
  const h = _callHold;
  if (!h || h.words !== true) return;
  h.quietMs = loud ? 0 : h.quietMs + dt;
  if (h.quietMs >= Math.min(_callSilenceMs, 1500)) {
    _callHold = null;
    _callProcessAudio(_callWav(h.pcm, h.rate), 'speech.wav');
  }
}

async function _callHoldDecide() {
  const h = _callHold;
  if (!h) return;
  let words = '';
  try {
    const form = new FormData();
    form.append('audio', _callWav(h.pcm, h.rate), 'probe.wav');
    words = String((await (await fetch('/api/chat/transcribe', { method: 'POST', body: form, signal: _callAbort?.signal })).json()).text || '').trim();
  } catch { /* undecided reads as noise: the answer goes on */ }
  if (_callHold !== h || !_callActive || !_callPlayCtx) return;
  if (/[\p{L}\p{N}]/u.test(words)) {   // a person said something: the answer ends where they stopped listening
    h.words = true;
    const heard = _callHeardText();
    _callAnswerCtrl?.abort();   // its turn stops too: what it would still say is not an answer any more
    _callStopPlayback();
    _callEpoch++; if (_callStats) _callStats.bargeIns++;
    _callPlayCtx.resume().catch(() => {});
    _callSetStatus('Listening…', 'listening');
    _callSendHeard(heard);
  } else {
    _callHold = null;
    _callPlayCtx.resume().catch(() => {});
    if (!_callCurrentSrc && _callPlayQueue.length) _callPlayNext();   // a sentence that arrived during the pause
    _callSetStatus('Speaking…', 'speaking');
  }
}

/** Float32 chunks → a 16-bit mono WAV blob. */
function _callWav(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0), buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true);
  buf.setUint16(22, 1, true); buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  str(36, 'data'); buf.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) buf.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

/** What was heard of the current answer: the sentences played to the end, and the share of words of the one cut. */
function _callHeardText() {
  const t = _callPlayCtx.currentTime, parts = [];
  for (const s of _callHeard) {
    if (t >= s.start + s.dur) parts.push(s.text);
    else if (t > s.start && s.dur > 0) { const w = s.text.split(/\s+/); parts.push(w.slice(0, Math.round(w.length * (t - s.start) / s.dur)).join(' ')); }
  }
  return parts.join(' ').trim();
}

async function _callSendHeard(heard) {
  if (!heard) return;
  chatAppendMsg('system', `Interrupted after “…${heard.split(/\s+/).slice(-6).join(' ')}” — the rest was not heard.`);
  try { if (!(await apiFetch('/api/chat/heard', { method: 'POST', body: { heard } })).cut) _callHeardPending = heard; }
  catch { /* the transcript keeps the whole answer */ }
}

/** The answer's turn ended after the interruption: its row exists now, so cut it. */
function _callHeardRetry() {
  const heard = _callHeardPending;
  _callHeardPending = null;
  if (heard) apiFetch('/api/chat/heard', { method: 'POST', body: { heard } }).catch(() => {});
}

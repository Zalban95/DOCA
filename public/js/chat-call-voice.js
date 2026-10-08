/* The live call's voice (chat-call.js): each sentence of an answer synthesized, queued and played in order; an
   interruption drops what was queued. Split from chat-call.js along its seam: the microphone half stays there. */

// At most two sentences are synthesized at once: a browser holds six connections to the hub, and a long answer's
// sentences all fetched together left none for the transcription that decides whether the person talked over it.
let _callSynthSlots = 2;
const _callSynthWaiting = [];
const _callSynthSlot = () => (_callSynthSlots > 0 ? (_callSynthSlots--, Promise.resolve()) : new Promise(r => _callSynthWaiting.push(r)));
const _callSynthFree = () => { const next = _callSynthWaiting.shift(); if (next) next(); else _callSynthSlots++; };
let _callSynthSeq = 0, _callSynthNext = 0, _callSynthGen = 0;
const _callSynthReady = new Map();
const CALL_SYNTH_TIMEOUT_MS = 30000;   // a speech service that never answers must not leave a sentence "coming" forever

/** A new call starts with nothing of an earlier one's voice counted: a sentence still being made for a call that
 *  ended used to keep `_callSynthPending` above 0, which reads as "the voice is playing" to the microphone loop. */
function _callSynthReset() {
  _callSynthGen++;
  _callSynthPending = 0; _callSynthSeq = 0; _callSynthNext = 0;
  _callSynthReady.clear();
}

async function _callEnqueueSynth(text) {
  if (!_callActive) return;
  const epoch = _callEpoch;   // said before an interruption: dropped when it arrives after one (barge-in)
  const gen = _callSynthGen;   // this call's: a reset leaves it out of the counts
  _callSynthPending++;
  const seq = _callSynthSeq++;   // played in the order said, whichever synthesis finishes first
  let ready = null;
  await _callSynthSlot();
  try {
    if (gen !== _callSynthGen) return;
    const AS = typeof AbortSignal !== 'undefined' ? AbortSignal : {};
    const limit = AS.timeout ? AS.timeout(CALL_SYNTH_TIMEOUT_MS) : null;
    const res = await fetch('/api/chat/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, call: _callAssistant ? (_callAmbient ? 'ambient' : 'quick') : 'deep' }),   // the Live call's voice (the face), Ambient's assistant's, or the Deep call's (the chat's 🎙)
      signal: limit && AS.any && _callAbort ? AS.any([_callAbort.signal, limit]) : (_callAbort?.signal || limit || undefined),
    });
    if (!res.ok) throw new Error(`speech service answered ${res.status}${await res.text().then(t => `: ${t.slice(0, 120)}`).catch(() => '')}`);
    if (res.status === 204) return;   // only a tone tag: nothing to say

    const arrayBuf = await res.arrayBuffer();
    if (!_callActive || !_callPlayCtx) return;
    if (_callPlayCtx.state === 'suspended' && !_callHold) await _callPlayCtx.resume().catch(() => {});   // a hold keeps it paused
    const audioBuf = await _callPlayCtx.decodeAudioData(arrayBuf);
    if (epoch !== _callEpoch) { _callStats && _callStats.dropped++; return; }
    audioBuf._docaText = text;   // what it says: the face shows a concept it names (face/concept-engine.js)
    ready = audioBuf;
  } catch (e) {
    // Once per call: a voice that fails silently reads as a call that answers only in text.
    const lost = e.name === 'TimeoutError' || (e.name !== 'AbortError' && gen === _callSynthGen);
    if (lost && _callActive) _callUnspokenSay(text, e.name === 'TimeoutError' ? 'the speech service did not answer' : e.message);
  } finally {
    _callSynthFree();
    if (gen !== _callSynthGen) return;   // an earlier call's sentence: nothing here counts it any more
    _callSynthReady.set(seq, ready);
    while (_callSynthReady.has(_callSynthNext)) {
      const b = _callSynthReady.get(_callSynthNext);
      _callSynthReady.delete(_callSynthNext++);
      if (b && _callActive) { _callPlayQueue.push(b); if (!_callCurrentSrc && !_callHold) _callPlayNext(); }
    }
    _callSynthPending = Math.max(0, _callSynthPending - 1);
    if (_callActive && !_callSynthPending && !_callCurrentSrc && !_callPlayQueue.length && !_callProcessing) _callSetStatus('Listening…', 'listening');
  }
}

/** A sentence the voice could not say is still the answer: the chat has it — and where the chat is not on screen (the
 *  face, Ambient), the answer is written where the call shows its state. */
let _callUnspoken = '';
function _callUnspokenSay(text, why) {
  const chatShown = typeof chatOpen !== 'undefined' && chatOpen && !(typeof assistantIsOpen === 'function' && assistantIsOpen()) && !(typeof ambientIsOpen === 'function' && ambientIsOpen());
  if (chatShown) {
    if (!_callTtsWarned) { _callTtsWarned = true; _callNotice('tts', `The answer could not be spoken (${why}) — it is in the chat.`); }
    return;
  }
  _callUnspoken = `${_callUnspoken} ${typeof voiceTagsStrip === 'function' ? voiceTagsStrip(text) : text}`.trim();
  const shown = _callUnspoken.length > 280 ? `…${_callUnspoken.slice(-280)}` : _callUnspoken;
  if (!_callTtsWarned) { _callTtsWarned = true; _callReport('notice', { where: 'tts', text: `the answer could not be spoken (${why}); it is shown instead` }); }
  _callNotice('tts', `Not spoken (${why}): ${shown}`, { quiet: true });
}

function _callPlayNext() {
  if (!_callActive || !_callPlayCtx || _callPlayQueue.length === 0) {
    _callCurrentSrc = null;
    if (_callActive && !_callProcessing) _callSetStatus('Listening…', 'listening');
    return;
  }

  const buf = _callPlayQueue.shift();
  const src = _callPlayCtx.createBufferSource();
  src.buffer = buf;
  src.connect(_callOutAnalyser || _callPlayCtx.destination);
  src.onended = () => {
    _callCurrentSrc = null;
    _callPlayNext();
  };
  _callCurrentSrc = src;
  _callSetStatus('Speaking…', 'speaking');
  src.start();
  // The voice's audio held (a phone may suspend it when the call's microphone opens): woken, and the log says so —
  // a sentence "played" into audio that is not running is one nobody heard (2026-10-08).
  if (_callPlayCtx.state !== 'running') _callPlayCtx.resume?.().catch(() => {});
  _callReport('played', { n: 1, audio: _callPlayCtx.state });
  _callHeardMark(buf);   // what is heard, for a cut (chat-call-hold.js)
  if (typeof faceConceptSay === 'function') faceConceptSay(buf._docaText, buf.duration);
}

function _callStopPlayback() {
  _callPlayQueue = [];
  if (_callCurrentSrc) {
    try { _callCurrentSrc.stop(); } catch {}
    _callCurrentSrc = null;
  }
}

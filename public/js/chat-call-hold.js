/* Talking over the voice (asked 2026-10-05): a sustained sound while an answer plays pauses it where it is — not a
   stop. The first ~1.2 s of what was said is transcribed at once: real words stop the answer for good, and what the
   person heard is all the conversation keeps of it (POST /api/chat/heard → harness/heard.js); no words — a cough, a
   door, the room — and the voice goes on from exactly where it paused. The full utterance is recorded meanwhile by the
   call's own recorder (chat-call.js) and sent as the next message when the person stops talking. */
let _callHold = null;       // {rec, timer}: paused, deciding
let _callHoldDiscard = 0;   // when a hold decided "noise": the recording that started with it is not a message
let _callHeard = [];        // [{text, start, dur}]: the sentences of the current answer as they began to play
let _callHeardPending = null;

/** A sentence starts playing (chat-call-voice.js). */
function _callHeardMark(buf) { if (_callPlayCtx) _callHeard.push({ text: buf._docaText || '', start: _callPlayCtx.currentTime, dur: buf.duration || 0 }); }
/** A new answer begins (chat-call.js _callAnswer). */
function _callHeardReset() { _callHeard = []; }

function _callHoldStart() {
  if (_callHold || !_callPlayCtx || !_callStream) return;
  _callPlayCtx.suspend().catch(() => {});   // paused exactly where it is: currentTime stops too
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const rec = new MediaRecorder(_callStream, { mimeType }), chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => _callHoldDecide(new Blob(chunks, { type: mimeType }));
  rec.start();
  _callHold = { rec, timer: setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 1200) };
}

async function _callHoldDecide(blob) {
  let words = '';
  try {
    const form = new FormData();
    form.append('audio', blob, 'probe.webm');
    words = String((await (await fetch('/api/chat/transcribe', { method: 'POST', body: form, signal: _callAbort?.signal })).json()).text || '').trim();
  } catch { /* undecided reads as noise: the answer goes on */ }
  _callHold = null;
  if (!_callActive || !_callPlayCtx) return;
  if (/[\p{L}\p{N}]/u.test(words)) {   // a person said something: the answer ends where they stopped listening
    const heard = _callHeardText();
    _callStopPlayback();
    _callEpoch++; if (_callStats) _callStats.bargeIns++;
    _callPlayCtx.resume().catch(() => {});
    _callSetStatus('Listening…', 'listening');
    _callSendHeard(heard);
  } else {
    if (_callRecorder) _callHoldDiscard = Date.now();
    _callPlayCtx.resume().catch(() => {});
    _callSetStatus('Speaking…', 'speaking');
  }
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

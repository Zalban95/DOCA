/* The live call's voice (chat-call.js): each sentence of an answer synthesized, queued and played in order; an
   interruption drops what was queued. Split from chat-call.js along its seam: the microphone half stays there. */

async function _callEnqueueSynth(text) {
  if (!_callActive) return;
  const epoch = _callEpoch;   // said before an interruption: dropped when it arrives after one (barge-in)
  _callSynthPending++;
  try {
    const res = await fetch('/api/chat/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: _callAbort?.signal,
    });
    if (!res.ok) throw new Error(`speech service answered ${res.status}${await res.text().then(t => `: ${t.slice(0, 120)}`).catch(() => '')}`);

    const arrayBuf = await res.arrayBuffer();
    if (!_callActive || !_callPlayCtx) return;
    if (_callPlayCtx.state === 'suspended') await _callPlayCtx.resume().catch(() => {});
    const audioBuf = await _callPlayCtx.decodeAudioData(arrayBuf);
    if (epoch !== _callEpoch) { _callStats && _callStats.dropped++; return; }
    _callPlayQueue.push(audioBuf);
    if (!_callCurrentSrc) _callPlayNext();
  } catch (e) {
    // Once per call: a voice that fails silently reads as a call that answers only in text.
    if (e.name !== 'AbortError' && _callActive && !_callTtsWarned) { _callTtsWarned = true; chatAppendMsg('system', `The answer could not be spoken: ${e.message}`); }
  } finally {
    _callSynthPending = Math.max(0, _callSynthPending - 1);
    if (_callActive && !_callSynthPending && !_callCurrentSrc && !_callPlayQueue.length && !_callProcessing) _callSetStatus('Listening…', 'listening');
  }
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
}

function _callStopPlayback() {
  _callPlayQueue = [];
  if (_callCurrentSrc) {
    try { _callCurrentSrc.stop(); } catch {}
    _callCurrentSrc = null;
  }
}

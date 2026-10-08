/* A recording of the live call becomes words, then a turn (chat-call.js _callAnswer). Out of chat-call.js along its
   seam: the microphone and the answer stay there. Every way this can come to nothing is said (chat-call-report.js):
   the transcriber not answering, no words in what was said, only a silence phrase. */

async function _callProcessAudio(audioBlob, name = 'recording.webm') {
  if (!_callActive) return;
  _callProcessing++;
  _callSetStatus('Transcribing…', 'processing');
  let told = false;
  const notice = (stage, text) => { told = true; _callNotice(stage, text); };   // left on the status line

  try {
    const form = new FormData();
    form.append('audio', audioBlob, name);
    if (_callHint) form.append('prompt', _callHint);
    if (_callLogId) form.append('call', _callLogId);   // the hub keeps what the transcriber made of it (panel-call.js)
    let transcribeRes;
    try { transcribeRes = await fetch('/api/chat/transcribe', { method: 'POST', body: form, signal: _callAbort?.signal }); }
    catch (e) { if (e.name !== 'AbortError') notice('stt', `The transcriber could not be reached (${e.message}) — say it again in a moment.`); return; }
    const transcribeData = await transcribeRes.json().catch(() => ({}));
    if (!transcribeRes.ok) {   // it used to read as "nothing said" — a call that just went quiet
      notice('stt', `The transcriber did not answer: ${String(transcribeData.error || transcribeRes.status).slice(0, 160)}`);
      return;
    }
    // The hint alone is what a transcriber can make of a breath when it was told the name: not something said.
    const bare = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (_callHint && bare(transcribeData.text) === bare(_callHint)) transcribeData.text = '';
    if (!transcribeData.text || !transcribeData.text.trim()) {
      notice('stt', 'I didn’t catch that — say it again?');
      return;   // the finally below counts it done
    }

    _callLastActive = performance.now();   // words were heard
    if (typeof callAskAnswer === 'function' && await callAskAnswer(transcribeData.text.trim())) return;   // a yes or a no to the question waiting (chat-call-ask.js)
    await _callAnswer(transcribeData.text.trim());
  } catch (e) {
    if (e.name !== 'AbortError') notice('stt', `Voice error: ${e.message}`);
  } finally {
    _callProcessing = Math.max(0, _callProcessing - 1);
    if (_callActive && !told && !_callCurrentSrc && _callPlayQueue.length === 0 && !_callSynthPending && !_callProcessing) _callSetStatus('Listening…', 'listening');
  }
}

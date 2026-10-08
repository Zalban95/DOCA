/* A call paused for a phone call (asked 2026-10-08: "if a phone call comes through, the microphone has to be freed").
   DocaMobile says when the phone rings or another app takes the microphone (lib/mic-keep.js); the call gives the
   microphone up — its tracks stopped, so the phone call has it — and stops speaking, but stays a call: what it was
   about to say waits, and when the phone call ends it opens the microphone again and carries on where it was. */

let _callPausedFor = '';   // the words on screen while paused, or ''

/** Whether the call is paused now (a call that ended meanwhile is not). */
const _callIsPaused = () => !!(_callPausedFor && _callActive && !_callStream);

function _callPause(words = 'Paused') {
  if (!_callActive || _callIsPaused()) return;
  _callPausedFor = words;
  _callReport('paused', { why: words });
  if (_callVadRafId) { (typeof micFrameCancel === 'function' ? micFrameCancel : cancelAnimationFrame)(_callVadRafId); _callVadRafId = null; }
  clearTimeout(_callSilenceTimer); _callSilenceTimer = null; _callSpeaking = false;
  // What was being said by the person is dropped (half a sentence is not a message); nothing is sent.
  if (_callRecorder && _callRecorder.state !== 'inactive') { _callRecorder.onstop = null; _callRecorder.stop(); }
  _callRecorder = null;
  _callTapStop();
  if (_callHold?.timer) clearTimeout(_callHold.timer);
  // The voice stops where it is and nothing more is played: a hold is what keeps playback waiting (chat-call-voice.js
  // plays and resumes only without one), so the pause is a hold that decides nothing until the phone call ends.
  _callHold = { pcm: [], words: false, quietMs: 0, paused: true };
  if (_callCurrentSrc) { try { _callCurrentSrc.onended = null; _callCurrentSrc.stop(); } catch { /* ended */ } _callCurrentSrc = null; }
  _callPlayCtx?.suspend().catch(() => {});
  _callStream.getTracks().forEach(t => t.stop());
  _callStream = null; _callAnalyser = null;
  _callSetStatus(`${words} — the call goes on when it ends.`, 'paused');
}

/** The phone call ended: the microphone again, the voice where it stopped, listening. */
async function _callResume() {
  if (!_callIsPaused()) { _callPausedFor = ''; return; }
  let stream;
  try { stream = await micOpen({ echoCancellation: true, noiseSuppression: true }); }
  catch (e) {
    _callPausedFor = '';
    chatAppendMsg('system', `The call could not go on after the pause — the microphone did not open: ${e.message}`);
    return _callStop('the microphone did not come back after a pause');
  }
  if (!_callActive) { stream.getTracks().forEach(t => t.stop()); _callPausedFor = ''; return; }
  _callPausedFor = '';
  _callStream = stream;
  _callReport('resumed', { why: 'the microphone came back after a pause' });
  await _callAudioCtx?.resume().catch(() => {});
  const source = _callAudioCtx.createMediaStreamSource(_callStream);
  _callAnalyser = _callAudioCtx.createAnalyser();
  _callAnalyser.fftSize = 512;
  source.connect(_callAnalyser);
  _callTapStart(source);
  _callHold = null;
  await _callPlayCtx?.resume().catch(() => {});
  _callLastActive = performance.now();
  if (_callPlayQueue.length && !_callCurrentSrc) _callPlayNext();
  else _callSetStatus('Listening…', 'listening');
  _callVadLoop();
}

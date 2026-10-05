/* ═══════════════════════════════════════════════════════
   VOICE CALL MODE
   ═══════════════════════════════════════════════════════ */

let _callActive       = false;
let _callStream       = null;   // MediaStream
let _callAudioCtx     = null;   // AudioContext for VAD
let _callAnalyser     = null;   // AnalyserNode
let _callRecorder     = null;   // MediaRecorder
let _callSpeaking     = false;  // user is currently speaking
let _callSilenceTimer = null;   // timeout after silence
let _callProcessing   = 0;      // utterances being transcribed and answered (more than one with barge-in)
let _callPlayQueue    = [];     // queued audio buffers to play
let _callCurrentSrc   = null;   // currently playing AudioBufferSourceNode
let _callPlayCtx      = null;   // AudioContext for playback
let _callAbort        = null;   // AbortController for in-flight requests
let _callVadRafId     = null;   // requestAnimationFrame id

// Barge-in (experiments.bargeIn; docs/experiments/barge-in.md, TODO H8.3): speak over a working agent — what you say
// is recorded and sent while its turn runs (the turn reads it before its next step: harness/inbox.js), and what it
// was about to say when you interrupted is dropped. Off: the call waits for the turn, as it always did.
let _callBargeIn = false, _callEpoch = 0, _callStats = null;
// The face follows the call (experiments.faceVoice; docs/experiments/face-voice.md, TODO H8.2): the agent's voice moves
// its mouth, yours makes it listen — levels read from the two analysers the call already has, once a frame.
let _callFaceVoice = false, _callOutAnalyser = null;

// How a call listens is this screen's (the setting `call`; Settings → Voice → Live call), read when a call starts.
let _callSilenceMs = 2000;
let _callThreshold = 15;
// A recording is sent only with this much audio over the threshold in it: a click, a cough or a door is shorter, and
// Whisper turns such a blip into "Thank you." (the hub screens those phrases too: modules/stt-filter.js).
const CALL_MIN_VOICED_MS = 300;
let _callVoicedMs = 0, _callLastFrame = 0, _callSynthPending = 0, _callTtsWarned = false, _callLastActive = 0, _callOverMs = 0;
/** How long nobody has spoken and nothing has been said or worked on (assistant mode's idle timer). */
const _callIdleMs = () => (_callActive && _callLastActive ? performance.now() - _callLastActive : 0);

function _callSetStatus(text, state) {
  const el = document.getElementById('chat-call-status');
  const mic = document.getElementById('chat-call-mic-icon');
  if (el) el.textContent = text;
  if (typeof _assistantSay === 'function' && typeof assistantIsOpen === 'function' && assistantIsOpen() && _callActive) _assistantSay(text);
  if (mic) mic.className = `chat-call-mic-icon ${state || ''}`;
}

/** `assistant`: started from the face (face/assistant.js) — the face follows the call's voice whatever faceVoice says. */
async function chatToggleCall({ assistant = false } = {}) {
  if (_callActive) {
    _callStop();
    return;
  }
  // Both audio contexts are made here, inside the tap, before anything is awaited: a context made later is no longer
  // the tap's, and a phone's WebView keeps it suspended — the answer is synthesized and never heard.
  _callAudioCtx = new AudioContext();
  _callPlayCtx = new AudioContext();
  _callAudioCtx.resume().catch(() => {}); _callPlayCtx.resume().catch(() => {});
  const giveUp = () => { _callAudioCtx.close().catch(() => {}); _callPlayCtx.close().catch(() => {}); _callAudioCtx = _callPlayCtx = null; };
  // A realtime speech model, when the owner set one up (chat-realtime.js; experiments.realtimeVoice).
  if (typeof realtimeAvailable === 'function' && await realtimeAvailable()) { giveUp(); return realtimeStart(); }

  _callSetStatus('Checking services…', '');
  try {
    const status = await apiFetch('/api/chat/call-status');
    if (!status.stt || !status.tts) {
      const missing = [];
      if (!status.stt) missing.push(`STT (${status.sttUrl})`);
      if (!status.tts) missing.push(`TTS (${status.ttsUrl})`);
      chatAppendMsg('system', `Voice services unreachable: ${missing.join(', ')}. Configure in Settings → Voice Services.`);
      return giveUp();
    }
  } catch (e) {
    chatAppendMsg('system', `Cannot check voice services: ${e.message}`);
    return giveUp();
  }

  try { const ex = (await screenLoad(true)).experiments || {}; _callBargeIn = !!ex.bargeIn; _callFaceVoice = !!ex.faceVoice || assistant; }
  catch { _callBargeIn = false; _callFaceVoice = assistant; }
  if (typeof wakeWordPause === 'function') wakeWordPause();   // the call has the microphone now
  _callStats = { at: Date.now(), bargeIns: 0, dropped: 0 };
  try { const c = (await screenPrefs()).call || {}; _callSilenceMs = c.silenceMs >= 300 ? c.silenceMs : 2000; _callThreshold= c.sensitivity >= 1 ? c.sensitivity : 15; }
  catch { /* the defaults */ }
  try {
    // Echo cancellation keeps the agent's own voice from reading as yours — which matters most with barge-in on.
    _callStream = await micOpen({ echoCancellation: true, noiseSuppression: true });
  } catch (e) {
    chatAppendMsg('system', `The microphone did not open: ${e.message}`);
    return giveUp();
  }

  _callActive = true;
  _callAbort = new AbortController();

  document.getElementById('chat-panel').classList.add('call-active');
  document.getElementById('chat-call-toggle').classList.add('active');
  document.getElementById('chat-input-row').style.display = 'none';
  document.getElementById('chat-call-bar').style.display = 'flex';

  _callTtsWarned = false; _callSynthPending = 0; _callLastActive = performance.now();
  const source = _callAudioCtx.createMediaStreamSource(_callStream);
  _callAnalyser = _callAudioCtx.createAnalyser();
  _callAnalyser.fftSize = 512;
  source.connect(_callAnalyser);

  if (_callFaceVoice) { _callOutAnalyser = _callPlayCtx.createAnalyser(); _callOutAnalyser.fftSize = 256; _callOutAnalyser.connect(_callPlayCtx.destination); }

  _callSetStatus('Listening…', 'listening');
  _callVadLoop();
  return true;
}

function _callStop() {
  if (typeof _rt !== 'undefined' && _rt) return realtimeStop();   // a realtime call (chat-realtime.js)
  _callActive = false;
  // With barge-in on, the call says how it went — the experiment's measure (docs/experiments/barge-in.md).
  if (_callBargeIn && _callStats) chatAppendMsg('system', `Call: ${Math.max(1, Math.round((Date.now() - _callStats.at) / 60000))} min, interrupted ${_callStats.bargeIns}×, ${_callStats.dropped} stale sentence${_callStats.dropped === 1 ? '' : 's'} not spoken.`);
  _callStats = null;

  if (_callAbort) { _callAbort.abort(); _callAbort = null; }
  if (_callVadRafId) { cancelAnimationFrame(_callVadRafId); _callVadRafId = null; }
  clearTimeout(_callSilenceTimer);
  _callSilenceTimer = null;

  if (_callRecorder && _callRecorder.state !== 'inactive') _callRecorder.stop();
  _callRecorder = null;

  if (_callStream) { _callStream.getTracks().forEach(t => t.stop()); _callStream = null; }
  if (_callAudioCtx) { _callAudioCtx.close().catch(() => {}); _callAudioCtx = null; }
  _callAnalyser = null;

  _callStopPlayback();
  if (_callPlayCtx) { _callPlayCtx.close().catch(() => {}); _callPlayCtx = null; }
  _callOutAnalyser = null;

  _callSpeaking = false;
  _callProcessing = 0;
  _callPlayQueue = [];

  document.getElementById('chat-panel').classList.remove('call-active');
  document.getElementById('chat-call-toggle').classList.remove('active');
  document.getElementById('chat-input-row').style.display = 'flex';
  document.getElementById('chat-call-bar').style.display = 'none';
  if (typeof wakeWordApply === 'function') wakeWordApply();   // the face listens for its name again
}

function _callVadLoop() {
  if (!_callActive || !_callAnalyser) return;

  const data = new Uint8Array(_callAnalyser.frequencyBinCount);
  _callAnalyser.getByteFrequencyData(data);
  const energy = data.reduce((a, b) => a + b, 0) / data.length;
  const now = performance.now(), dt = _callLastFrame ? Math.min(100, now - _callLastFrame) : 0;
  _callLastFrame = now;
  // Activity is an exchange — something sent, worked on or spoken — never mere sound, or a noisy room keeps it awake.
  if (_callCurrentSrc || _callProcessing || _callSynthPending || (_callSpeaking && _callVoicedMs >= CALL_MIN_VOICED_MS)) _callLastActive = now;
  if (_callFaceVoice && typeof faceCornerVoice === 'function') {
    if (_callCurrentSrc && _callOutAnalyser) {
      const out = new Uint8Array(_callOutAnalyser.frequencyBinCount);
      _callOutAnalyser.getByteFrequencyData(out);
      faceCornerVoice('speaking', out.reduce((a, b) => a + b, 0) / out.length / 80);
    } else if (energy > _callThreshold) faceCornerVoice('listening', energy / 80);
  }

  // While the voice plays it keeps the floor: a cough, a door or the room is not a person talking over it. Only with
  // barge-in on does a sustained sound well over the threshold (≈0.35 s) interrupt it.
  const playing = !!_callCurrentSrc && !_callHold;
  _callOverMs = playing && energy > _callThreshold * 1.6 + 5 ? _callOverMs + dt : 0;
  if (playing) { if (_callOverMs >= 350) _callHoldStart(); }   // paused, then decided by the first words (chat-call-hold.js)
  else if (energy > _callThreshold) {
    // Speech detected
    if (!_callSpeaking && (!_callProcessing || _callBargeIn || _callHold)) {
      _callSpeaking = true;
      _callVoicedMs = 0;
      _callStartRecording();
      _callSetStatus('Listening…', 'listening');
    }
    if (_callSpeaking) _callVoicedMs += dt;

    clearTimeout(_callSilenceTimer);
    _callSilenceTimer = null;
  } else if (_callSpeaking && !_callSilenceTimer) {
    _callSilenceTimer = setTimeout(() => {
      _callSpeaking = false;
      _callSilenceTimer = null;
      _callStopRecording();
    }, _callSilenceMs);
  }

  _callVadRafId = requestAnimationFrame(_callVadLoop);
}

function _callStartRecording() {
  if (_callRecorder) return;

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  _callRecorder = new MediaRecorder(_callStream, { mimeType });
  const chunks = [];
  _callRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  _callRecorder.onstop = () => {
    _callRecorder = null;
    if (_callVoicedMs < CALL_MIN_VOICED_MS) return;   // a blip, not speech: nothing is sent
    if (_callHoldDiscard && Date.now() - _callHoldDiscard < 8000) { _callHoldDiscard = 0; return; }   // a hold heard no words in it
    if (chunks.length && _callActive) {
      const blob = new Blob(chunks, { type: mimeType });
      _callProcessAudio(blob);
    }
  };
  _callRecorder.start();
}

function _callStopRecording() {
  if (_callRecorder && _callRecorder.state !== 'inactive') {
    _callRecorder.stop();
  }
}

async function _callProcessAudio(audioBlob) {
  if (!_callActive) return;
  _callProcessing++;
  _callSetStatus('Transcribing…', 'processing');

  try {
    // 1. Transcribe audio → text
    const form = new FormData();
    form.append('audio', audioBlob, 'recording.webm');
    const transcribeRes = await fetch('/api/chat/transcribe', {
      method: 'POST',
      body: form,
      signal: _callAbort?.signal,
    });
    const transcribeData = await transcribeRes.json();
    if (!transcribeData.text || !transcribeData.text.trim()) {
      _callSetStatus('Listening…', 'listening');
      return;   // the finally below counts it done
    }

    await _callAnswer(transcribeData.text.trim());
  } catch (e) {
    if (e.name !== 'AbortError') chatAppendMsg('system', `Voice error: ${e.message}`);
  } finally {
    _callProcessing = Math.max(0, _callProcessing - 1);
    if (_callActive && !_callCurrentSrc && _callPlayQueue.length === 0 && !_callSynthPending) _callSetStatus('Listening…', 'listening');
  }
}

/** What was said, sent as a turn and spoken back — from the microphone, or the words after a wake word (wake-word.js). */
async function _callAnswer(userText) {
  if (!_callActive) return;
  _callProcessing++;
  _callHeardReset();
  try {
    chatAppendMsg('user', userText);

    // 2. Send to chat and stream response
    _callSetStatus('Thinking…', 'processing');
    const container = document.getElementById('chat-messages');
    let sentenceBuf  = '';
    let inThinking   = false;
    agentWorkingOpen(container);
    const stream = createThinkStream({
      mount: node => { agentFoldMount(container, node); _chatScroll(); },
      makeText: () => chatAppendMsg('assistant', ''),
      scroll: _chatScroll,
    });
    stream.startWaiting();
    // The same sink as a typed turn — approvals, warnings and pictures included — and speaking on the side:
    // spoken text skips `<think>` blocks (a character scan, so tags split across chunks still drop cleanly).
    const callSink = agentEventSink({
      stream,
      fold: (kind, body, name, opts) => _chatAppendFold(kind, body, name, opts),
      note: (kind, text) => chatAppendMsg(kind === 'waiting' ? 'waiting' : 'failover', text),
      image: img => _chatAppendImage(img),
      approval: evt => _chatApproval(evt, container),
      error: msg => chatAppendMsg('system', `Error: ${msg}`),
      onText: chunk => {
        for (let i = 0; i < chunk.length; i++) {
          const remaining = chunk.slice(i);
          if (!inThinking && remaining.startsWith('<think>')) { inThinking = true; i += 6; continue; }
          if (inThinking && remaining.startsWith('</think>')) { inThinking = false; i += 7; continue; }
          if (!inThinking) sentenceBuf += chunk[i];
        }
        if (inThinking) return;
        const sentenceEnd = sentenceBuf.search(/[.!?;:\n]\s*/);
        if (sentenceEnd < 0) return;
        const sentence = sentenceBuf.slice(0, sentenceEnd + 1).trim();
        sentenceBuf = sentenceBuf.slice(sentenceEnd + 1);
        if (sentence.length > 1) _callEnqueueSynth(sentence);
      },
    });
    const chatRes = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userText }),
      signal: _callAbort?.signal,
    });

    const reader  = chatRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!_callActive) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          callSink.onEvent(JSON.parse(line.slice(6)));   // what it means: agent-ui/event-sink.js; speaking: onText above
        } catch {}
      }
      _chatScroll();
    }

    callSink.finish();
    _callHeardRetry();   // an interruption came before this answer's row was written
    closeFolds(container);

    // Synthesize any remaining text
    if (sentenceBuf.trim().length > 1 && _callActive) {
      _callEnqueueSynth(sentenceBuf.trim());
    }

  } catch (e) {
    if (e.name !== 'AbortError') {
      chatAppendMsg('system', `Voice error: ${e.message}`);
    }
  } finally {
    agentWorkingClose(document.getElementById('chat-messages'));
    _callProcessing = Math.max(0, _callProcessing - 1);
    if (_callActive && !_callCurrentSrc && _callPlayQueue.length === 0 && !_callSynthPending) {
      _callSetStatus('Listening…', 'listening');
    }
  }
}

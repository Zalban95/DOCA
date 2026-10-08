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
let _callAnswerCtrl = null;   // the answer being made: aborted when the person talks over it
let _callCutWhy = '';         // why the answer in flight was cut, said once it stops (chat-call-hold.js sets it)
let _callPlayQuietMs = 0;     // quiet since the voice began: talking over it counts only after a pause (chat-call-hold.js)
let _callRecPeak = 0, _callVoicedMs = 0, _callLastFrame = 0, _callSynthPending = 0, _callTtsWarned = false, _callLastActive = 0, _callOverMs = 0, _callAnswering = 0;
/** How long nobody has spoken and nothing has been said or worked on (assistant mode's idle timer). */
const _callIdleMs = () => (_callActive && _callLastActive ? performance.now() - _callLastActive : 0);

function _callSetStatus(text, state) {
  // A notice just said stays a few seconds: "Listening…" changes only the microphone's look meanwhile (chat-call-report.js).
  if (text === 'Listening…' && typeof _callNoticeUntil !== 'undefined' && performance.now() < _callNoticeUntil) text = null;
  const el = document.getElementById('chat-call-status');
  const mic = document.getElementById('chat-call-mic-icon');
  if (el && text !== null) el.textContent = text;
  if (text !== null && typeof _assistantSay === 'function' && typeof assistantIsOpen === 'function' && assistantIsOpen() && _callActive) _assistantSay(text);
  if (text !== null && typeof ambientSay === 'function' && _callActive) ambientSay(text, state);   // the ambient screen's own line (ambient.js)
  if (mic) mic.className = `chat-call-mic-icon ${state || ''}`;
}

/** `assistant`: started from the face (face/assistant.js) — the face follows the call's voice whatever faceVoice says. */
let _callAssistant = false;   // this call came from the face (assistant mode): quicker, shorter, its own style
let _callAmbient = false;     // …from the Ambient page: Ambient's assistant, spoken in its own voice (call-voices.js `ambient`)
let _callStarting = false;   // between the tap and the microphone: nothing else may take the microphone then (wake-word.js)
async function chatToggleCall({ assistant = false, ambient = false } = {}) {
  if (_callActive) {
    _callStop('the person ended the call');
    return;
  }
  // _callStart's first part runs now, inside the tap (its audio contexts must), and the flag holds until it settles.
  _callStarting = true; _callNotStarted = '';
  try { return await _callStart({ assistant, ambient }); }
  catch (e) {
    // Never a call that just does not happen: until 2026-10-08 a throw here (the wake word letting go) left "Checking
    // services…" on screen, nothing on the hub, and Ambient's galaxy falling back a second after it rose.
    if (_callActive) {
      try { _callStop('the call could not start'); } catch { /* as far as it got */ }
      chatAppendMsg('system', `The call did not start: ${e.message}`); _callSetStatus(`The call did not start: ${e.message}`, '');
    } else {
      try { _callAudioCtx?.close().catch(() => {}); _callPlayCtx?.close().catch(() => {}); } catch { /* gone */ } _callAudioCtx = _callPlayCtx = null;
      _callRefuse(`The call did not start: ${e.message}`, assistant);   // said where the person looks, and logged (chat-call-report.js)
    }
    return false;
  } finally { _callStarting = false; }
}

/** The name a person calls the hive by, as the transcriber's spelling hint: Whisper has never heard an invented name
 *  ("Doca" came back as "Madoka" inside calls, 2026-10-06). */
let _callHint = '';

async function _callStart({ assistant, ambient = false }) {
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
      if (!status.stt) missing.push(`speech-to-text at ${status.sttUrl}`);
      if (!status.tts) missing.push(`text-to-speech at ${status.ttsUrl}`);
      _callRefuse(`No speech service: set one up in Settings → Voice. (${missing.join(' and ')} ${missing.length > 1 ? 'do' : 'does'} not answer.)`, assistant);
      return giveUp();
    }
  } catch (e) {
    _callRefuse(`Cannot check the speech services: ${e.message}`, assistant);
    return giveUp();
  }

  // Assistant mode always drives the face by voice: there the face is the conversation (docs/experiments/face-voice.md).
  try { const ex = (await screenLoad(true)).experiments || {}; _callBargeIn = !!ex.bargeIn; _callFaceVoice = !!ex.faceVoice || assistant; _callAssistant = assistant; }
  catch { _callBargeIn = false; _callFaceVoice = assistant; _callAssistant = assistant; }
  // Ambient's: started by its page, or by the wake word while the Ambient page shows.
  _callAmbient = assistant && (ambient || (typeof currentTab !== 'undefined' && currentTab === 'ambient'));
  if (typeof wakeWordPause === 'function') wakeWordPause();   // the call has the microphone now: its stream is handed over (lib/mic.js)
  _callStats = { at: Date.now(), bargeIns: 0, dropped: 0 };
  try { const c = (await screenPrefs()).call || {}; _callHint = String(c.wakeWord || '').trim() || (typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA'; _callSilenceMs = c.silenceMs >= 300 ? c.silenceMs : 2000; _callThreshold= c.sensitivity >= 1 ? c.sensitivity : 15; }
  catch { /* the defaults */ }
  try {
    // Echo cancellation keeps the agent's own voice from reading as yours — which matters most with barge-in on.
    _callStream = await micOpen(MIC_SPEECH);
  } catch (e) {
    _callRefuse(`The microphone did not open: ${e.message}`, assistant);
    return giveUp();
  }

  _callActive = true;
  _callAbort = new AbortController();
  _callSynthReset();   // nothing of an earlier call's voice is still counted as playing (chat-call-voice.js)
  _callReportStart(assistant);   // the hub keeps each stage of this call (chat-call-report.js)

  document.getElementById('chat-panel').classList.add('call-active');
  document.getElementById('chat-call-toggle').classList.add('active');
  document.getElementById('chat-input-row').style.display = 'none';
  document.getElementById('chat-call-bar').style.display = 'flex';

  _callTtsWarned = false; _callSynthPending = 0; _callLastActive = performance.now();
  const source = _callAudioCtx.createMediaStreamSource(_callStream);
  _callAnalyser = _callAudioCtx.createAnalyser();
  _callAnalyser.fftSize = 512;
  source.connect(_callAnalyser);
  _callTapStart(source);   // raw samples, so talking over an answer is heard from its first word (chat-call-hold.js)

  if (_callFaceVoice) { _callOutAnalyser = _callPlayCtx.createAnalyser(); _callOutAnalyser.fftSize = 256; _callOutAnalyser.connect(_callPlayCtx.destination); }

  _callSetStatus('Listening…', 'listening');
  _callMicWatchStart(); _callMicTouchWake(true);   // the first seconds watched: a microphone that gives nothing is said (chat-call-mic.js)
  _callVadLoop();
  return true;
}

function _callStop(why = 'the person ended the call') {
  if (typeof _rt !== 'undefined' && _rt) return realtimeStop();   // a realtime call (chat-realtime.js)
  // Hanging up stops the answer being made, as Stop does — said, so it does not read as a call that broke.
  if (_callAnswering) chatAppendMsg('system', 'The call ended while the answer was being made, so it was stopped.');
  _callReportEnd(_callAnswering ? `${why}, while an answer was being made` : why);
  _callActive = false; if (typeof callAskReset === 'function') callAskReset();
  if (typeof callThinkSet === 'function') callThinkSet('auto');   // the call's 💭 lasts the call (agent-ui/think-toggle.js)
  // With barge-in on, the call says how it went — the experiment's measure (docs/experiments/barge-in.md).
  if (_callBargeIn && _callStats) chatAppendMsg('system', `Call: ${Math.max(1, Math.round((Date.now() - _callStats.at) / 60000))} min, interrupted ${_callStats.bargeIns}×, ${_callStats.dropped} stale sentence${_callStats.dropped === 1 ? '' : 's'} not spoken.`);
  _callStats = null;

  if (_callAbort) { _callAbort.abort(); _callAbort = null; }
  if (_callVadRafId) { (typeof micFrameCancel === 'function' ? micFrameCancel : cancelAnimationFrame)(_callVadRafId); _callVadRafId = null; }
  clearTimeout(_callSilenceTimer);
  _callSilenceTimer = null;

  if (_callRecorder && _callRecorder.state !== 'inactive') _callRecorder.stop();
  _callRecorder = null;

  _callMicWatchStop(); _callMicTouchWake(false);
  // Handed over, not stopped: the wake word resting after this call, or the next call, takes it live (lib/mic.js).
  if (_callStream) { micHandOff(_callStream, MIC_SPEECH); _callStream = null; }
  if (_callAudioCtx) { _callAudioCtx.close().catch(() => {}); _callAudioCtx = null; }
  _callAnalyser = null;

  _callTapStop(); _callHold = null;
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
  // Activity is words: something heard as words, answered or spoken — never sound, or a noisy room never lets it rest.
  if (_callCurrentSrc || _callAnswering || _callSynthPending) _callLastActive = now;
  if (_callFaceVoice && typeof faceCornerVoice === 'function') {
    if (_callCurrentSrc && _callOutAnalyser) {
      const out = new Uint8Array(_callOutAnalyser.frequencyBinCount);
      _callOutAnalyser.getByteFrequencyData(out);
      faceCornerVoice('speaking', out.reduce((a, b) => a + b, 0) / out.length / 80);
    } else if (energy > _callThreshold) faceCornerVoice('listening', energy / 80);
  }

  // While the voice plays it keeps the floor: a cough, a door or the room is not a person talking over it, and neither
  // are the person's own last words running on as the answer begins, nor the voice heard back through the microphone
  // (2026-10-08: a call's answer cut by them, and the call silent after). Only sound that starts after a pause in what
  // was heard, and goes on well over the threshold (≈0.35 s), pauses the voice to listen (chat-call-hold.js).
  const playing = (!!_callCurrentSrc || _callPlayQueue.length > 0 || _callSynthPending > 0) && !_callHold;
  const loud = energy > _callThreshold;
  _callPlayQuietMs = !playing ? 0 : loud ? _callPlayQuietMs : _callPlayQuietMs + dt;
  _callOverMs = playing && energy > _callThreshold * 1.3 + 3 ? _callOverMs + dt : 0;
  if (_callHold) _callHoldQuiet(dt, loud);
  if (playing && !_callSpeaking && _callPlayQuietMs >= 250 && _callOverMs >= 350) _callHoldStart(_callOverMs);
  _callReportLevel(energy);
  _callMicWatchFrame();
  if (loud) {
    // Speech: a recording starts when nothing is playing (over the voice, a hold records for itself).
    if (!playing && !_callSpeaking && !_callHold && (!_callProcessing || _callBargeIn || (typeof callAskWaiting === 'function' && callAskWaiting()))) {   // a question waits: its answer is heard
      _callSpeaking = true;
      _callVoicedMs = 0; _callRecPeak = 0;
      _callStartRecording();
      _callSetStatus('Hearing you…', 'listening');
      _callReport('speech', { level: energy });
    }
    if (_callSpeaking) { _callVoicedMs += dt; _callRecPeak = Math.max(_callRecPeak, energy); }
    clearTimeout(_callSilenceTimer);
    _callSilenceTimer = null;
  } else if (_callSpeaking && !_callSilenceTimer) {
    // The pause that ends what was said — counted while the voice plays too, or a recording begun just before an
    // answer would run on through all of it.
    _callSilenceTimer = setTimeout(() => {
      _callSpeaking = false;
      _callSilenceTimer = null;
      _callStopRecording();
    }, _callSilenceMs);
  }

  // A frame while the page shows; a worker's tick while it is hidden, so a call kept in the background goes on (lib/mic-keep.js).
  _callVadRafId = typeof micFrame === 'function' ? micFrame(_callVadLoop) : requestAnimationFrame(_callVadLoop);
}

function _callStartRecording() {
  if (_callRecorder) return;

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  _callRecorder = new MediaRecorder(_callStream, { mimeType });
  const chunks = [];
  _callRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  const startedAt = performance.now();
  _callRecorder.onstop = () => {
    _callRecorder = null;
    const ms = Math.round(performance.now() - startedAt), voicedMs = Math.round(_callVoicedMs);
    if (voicedMs < CALL_MIN_VOICED_MS) {   // a blip, not speech: nothing is sent
      _callReport('dropped', { why: `${voicedMs} ms of speech, under ${CALL_MIN_VOICED_MS} ms` });
      if (_callActive && !_callProcessing && !_callCurrentSrc) _callSetStatus('Listening…', 'listening');
      return;
    }
    if (chunks.length && _callActive) {
      _callReport('sent', { ms, voicedMs, peak: _callRecPeak });
      _callProcessAudio(new Blob(chunks, { type: mimeType }));   // chat-call-hear.js
    }
  };
  _callRecorder.start();
}

function _callStopRecording() {
  if (_callRecorder && _callRecorder.state !== 'inactive') {
    _callRecorder.stop();
  }
}

/** What was said, sent as a turn and spoken back — from the microphone, or the words after a wake word (wake-word.js). */
async function _callAnswer(userText) {
  if (!_callActive) return;
  _callProcessing++; _callAnswering++;
  _callHeardReset(); _callCutWhy = ''; _callUnspoken = '';
  let finished = false;
  try {
    chatAppendMsg('user', userText);

    // 2. Send to chat and stream response
    _callSetStatus('Thinking…', 'processing');
    const container = document.getElementById('chat-messages');
    let sentenceBuf  = '', said = '';
    let inThinking   = false;
    agentWorkingOpen(container);
    const stream = createThinkStream({
      mount: node => { agentFoldMount(container, node); _chatScroll(); },
      makeText: () => chatAppendMsg('assistant', ''),
      scroll: _chatScroll,
      voiceTags: true,   // "[whispers]" is for the voice, not the eye (lib/voice-tags.js)
    });
    stream.startWaiting();
    // The same sink as a typed turn — approvals, warnings and pictures included — and speaking on the side:
    // spoken text skips `<think>` blocks (a character scan, so tags split across chunks still drop cleanly).
    const callSink = agentEventSink({
      stream,
      fold: (kind, body, name, opts) => _chatAppendFold(kind, body, name, opts),
      note: (kind, text) => chatAppendMsg(kind === 'waiting' ? 'waiting' : 'failover', text),
      image: img => _chatAppendImage(img),
      approval: evt => { _chatApproval(evt, container); if (typeof callAskEvent === 'function') callAskEvent(evt); },   // said in the call too (chat-call-ask.js)
      error: msg => chatAppendMsg('system', `Error: ${msg}`),
      onText: chunk => {
        for (let i = 0; i < chunk.length; i++) {
          const remaining = chunk.slice(i);
          if (!inThinking && remaining.startsWith('<think>')) { inThinking = true; i += 6; continue; }
          if (inThinking && remaining.startsWith('</think>')) { inThinking = false; i += 7; continue; }
          if (!inThinking) { sentenceBuf += chunk[i]; said += chunk[i]; }
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
      body: JSON.stringify({ message: userText, voice: _callAssistant ? 'assistant' : 'call', ...(_callAmbient ? { speaks: 'ambient' } : {}), call: _callLogId, ...(typeof callThinkBody === 'function' ? callThinkBody(_callAssistant) : {}) }),   // the hub shapes a spoken answer, and logs the turn
      // Its own stop as well as the call's: words spoken over it end this answer and its turn (chat-call-hold.js).
      signal: (_callAnswerCtrl = new AbortController(), AbortSignal.any ? AbortSignal.any([_callAbort.signal, _callAnswerCtrl.signal]) : _callAbort?.signal),
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
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'done') finished = true;
          callSink.onEvent(evt);   // what it means: agent-ui/event-sink.js; speaking: onText above
        } catch {}
      }
      _chatScroll();
    }

    callSink.finish();
    // The stream ended without the hub's "done": the connection dropped mid-answer. Said, and the call listens on.
    if (!finished && _callActive) _callNotice('turn', 'The answer stopped before it finished — the connection dropped. Say it again?');
    // "✓" alone: an action done, not narrated (assistant.reply) — nothing is spoken, the face shows the check.
    if (said.trim() === '✓') { if (typeof faceConceptSay === 'function') faceConceptSay('completed', 1.6); _callSetStatus('Done ✓', 'listening'); }
    _callHeardRetry();   // an interruption came before this answer's row was written
    closeFolds(container);

    // Synthesize any remaining text
    if (sentenceBuf.trim().length > 1 && _callActive) {
      _callEnqueueSynth(sentenceBuf.trim());
    }

  } catch (e) {
    if (e.name !== 'AbortError') _callNotice('turn', `The answer failed: ${e.message}`);
    // Cut by the call itself (the person talked over it): say so and listen. A hang-up says so in _callStop.
    else if (_callActive && _callCutWhy && _callCutWhy !== 'told') _callNotice('turn', 'The answer was cut — go on, I\u2019m listening.');
  } finally {
    agentWorkingClose(document.getElementById('chat-messages'));
    _callAnswering = Math.max(0, _callAnswering - 1); _callProcessing = Math.max(0, _callProcessing - 1);
    if (_callActive && !_callCurrentSrc && _callPlayQueue.length === 0 && !_callSynthPending) {
      _callSetStatus('Listening…', 'listening');
    }
  }
}

/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — FLOATING CHAT (agent)
   ═══════════════════════════════════════════════════════ */

let chatLoaded = false;

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-panel').classList.toggle('open', chatOpen);
  document.getElementById('chat-fab').classList.toggle('active', chatOpen);
  if (chatOpen && !chatLoaded) {
    chatLoaded = true;
    chatLoadHistory();
  }
  if (chatOpen) document.getElementById('chat-input').focus();
  if (!chatOpen && _callActive) _callStop();
}

async function chatLoadHistory() {
  try {
    const data = await apiFetch('/api/chat/history');
    const msgs = data.messages || [];
    if (msgs.length) {
      const container = document.getElementById('chat-messages');
      container.innerHTML = '';
      msgs.forEach(m => chatAppendMsg(m.role, m.content));
    }
  } catch {}
}

function chatAppendMsg(role, text) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

function chatSend() {
  const input   = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  chatAppendMsg('user', message);

  const responseEl = chatAppendMsg('assistant', '');
  responseEl.classList.add('pulse');

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  }).then(res => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    responseEl.textContent = '';
    responseEl.classList.remove('pulse');

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) return;
        const text = decoder.decode(value);
        text.split('\n').forEach(line => {
          if (!line.startsWith('data: ')) return;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'text') {
              responseEl.textContent += evt.text;
            } else if (evt.type === 'stderr') {
              responseEl.textContent += evt.text;
            }
          } catch {}
        });
        document.getElementById('chat-messages').scrollTop =
          document.getElementById('chat-messages').scrollHeight;
        read();
      });
    }
    read();
  }).catch(e => {
    responseEl.classList.remove('pulse');
    responseEl.textContent = `Error: ${e.message}`;
    responseEl.style.color = 'var(--red)';
  });
}

function chatClear() {
  appConfirm('Clear chat history?', async () => {
    try {
      await apiFetch('/api/chat/clear', { method: 'POST' });
      const container = document.getElementById('chat-messages');
      container.innerHTML = '<div class="chat-msg system">Chat cleared. Send a message to start a new conversation.</div>';
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

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
let _callProcessing   = false;  // transcribe+chat+synth in progress
let _callPlayQueue    = [];     // queued audio buffers to play
let _callCurrentSrc   = null;   // currently playing AudioBufferSourceNode
let _callPlayCtx      = null;   // AudioContext for playback
let _callAbort        = null;   // AbortController for in-flight requests
let _callVadRafId     = null;   // requestAnimationFrame id

const CALL_SILENCE_MS     = 2000;
const CALL_ENERGY_THRESH  = 15;

function _callSetStatus(text, state) {
  const el = document.getElementById('chat-call-status');
  const mic = document.getElementById('chat-call-mic-icon');
  if (el) el.textContent = text;
  if (mic) mic.className = `chat-call-mic-icon ${state || ''}`;
}

async function chatToggleCall() {
  if (_callActive) {
    _callStop();
    return;
  }

  _callSetStatus('Checking services…', '');
  try {
    const status = await apiFetch('/api/chat/call-status');
    if (!status.stt || !status.tts) {
      const missing = [];
      if (!status.stt) missing.push(`STT (${status.sttUrl})`);
      if (!status.tts) missing.push(`TTS (${status.ttsUrl})`);
      chatAppendMsg('system', `Voice services unreachable: ${missing.join(', ')}. Configure in Settings → Voice Services.`);
      return;
    }
  } catch (e) {
    chatAppendMsg('system', `Cannot check voice services: ${e.message}`);
    return;
  }

  try {
    _callStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    chatAppendMsg('system', `Microphone access denied: ${e.message}`);
    return;
  }

  _callActive = true;
  _callAbort = new AbortController();

  document.getElementById('chat-panel').classList.add('call-active');
  document.getElementById('chat-call-toggle').classList.add('active');
  document.getElementById('chat-input-row').style.display = 'none';
  document.getElementById('chat-call-bar').style.display = 'flex';

  _callAudioCtx = new AudioContext();
  const source = _callAudioCtx.createMediaStreamSource(_callStream);
  _callAnalyser = _callAudioCtx.createAnalyser();
  _callAnalyser.fftSize = 512;
  source.connect(_callAnalyser);

  _callPlayCtx = new AudioContext();

  _callSetStatus('Listening…', 'listening');
  _callVadLoop();
}

function _callStop() {
  _callActive = false;

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

  _callSpeaking = false;
  _callProcessing = false;
  _callPlayQueue = [];

  document.getElementById('chat-panel').classList.remove('call-active');
  document.getElementById('chat-call-toggle').classList.remove('active');
  document.getElementById('chat-input-row').style.display = 'flex';
  document.getElementById('chat-call-bar').style.display = 'none';
}

function _callVadLoop() {
  if (!_callActive || !_callAnalyser) return;

  const data = new Uint8Array(_callAnalyser.frequencyBinCount);
  _callAnalyser.getByteFrequencyData(data);
  const energy = data.reduce((a, b) => a + b, 0) / data.length;

  if (energy > CALL_ENERGY_THRESH) {
    // Speech detected
    if (_callCurrentSrc) {
      _callStopPlayback();
      _callSetStatus('Listening…', 'listening');
    }

    if (!_callSpeaking && !_callProcessing) {
      _callSpeaking = true;
      _callStartRecording();
      _callSetStatus('Listening…', 'listening');
    }

    clearTimeout(_callSilenceTimer);
    _callSilenceTimer = null;
  } else if (_callSpeaking && !_callSilenceTimer) {
    _callSilenceTimer = setTimeout(() => {
      _callSpeaking = false;
      _callSilenceTimer = null;
      _callStopRecording();
    }, CALL_SILENCE_MS);
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
  _callProcessing = true;
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
      _callProcessing = false;
      _callSetStatus('Listening…', 'listening');
      return;
    }

    const userText = transcribeData.text.trim();
    chatAppendMsg('user', userText);

    // 2. Send to chat and stream response
    _callSetStatus('Thinking…', 'processing');
    const responseEl = chatAppendMsg('assistant', '');
    responseEl.classList.add('pulse');

    const chatRes = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userText }),
      signal: _callAbort?.signal,
    });

    const reader  = chatRes.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let sentenceBuf  = '';
    let inThinking   = false;
    responseEl.textContent = '';
    responseEl.classList.remove('pulse');
    _callSetStatus('Speaking…', 'speaking');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!_callActive) break;

      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'text') {
            const chunk = evt.text;

            // Detect thinking blocks: <think>...</think>
            for (let i = 0; i < chunk.length; i++) {
              const remaining = chunk.slice(i);
              if (!inThinking && remaining.startsWith('<think>')) {
                inThinking = true;
                i += 6; // skip <think>
                continue;
              }
              if (inThinking && remaining.startsWith('</think>')) {
                inThinking = false;
                i += 7; // skip </think>
                continue;
              }
              if (!inThinking) {
                fullResponse += chunk[i];
                sentenceBuf  += chunk[i];
              }
            }

            responseEl.textContent = fullResponse;

            // Synthesize complete sentences
            if (!inThinking) {
              const sentenceEnd = sentenceBuf.search(/[.!?;:\n]\s*/);
              if (sentenceEnd >= 0) {
                const sentence = sentenceBuf.slice(0, sentenceEnd + 1).trim();
                sentenceBuf = sentenceBuf.slice(sentenceEnd + 1);
                if (sentence.length > 1) _callEnqueueSynth(sentence);
              }
            }
          }
        } catch {}
      }
      document.getElementById('chat-messages').scrollTop =
        document.getElementById('chat-messages').scrollHeight;
    }

    // Synthesize any remaining text
    if (sentenceBuf.trim().length > 1 && _callActive) {
      _callEnqueueSynth(sentenceBuf.trim());
    }

  } catch (e) {
    if (e.name !== 'AbortError') {
      chatAppendMsg('system', `Voice error: ${e.message}`);
    }
  } finally {
    _callProcessing = false;
    if (_callActive && !_callCurrentSrc && _callPlayQueue.length === 0) {
      _callSetStatus('Listening…', 'listening');
    }
  }
}

async function _callEnqueueSynth(text) {
  if (!_callActive) return;
  try {
    const res = await fetch('/api/chat/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: _callAbort?.signal,
    });
    if (!res.ok) return;

    const arrayBuf = await res.arrayBuffer();
    if (!_callActive || !_callPlayCtx) return;
    const audioBuf = await _callPlayCtx.decodeAudioData(arrayBuf);
    _callPlayQueue.push(audioBuf);
    if (!_callCurrentSrc) _callPlayNext();
  } catch {}
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
  src.connect(_callPlayCtx.destination);
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

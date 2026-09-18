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
      msgs.forEach(m => {
        if (m.role === 'assistant') {
          (m.images || []).forEach(_chatAppendImage);
          if (m.content) _chatAppendContent(m.content);
        }
        else chatAppendMsg(m.role, m.content);
      });
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

/** A picture the agent showed. */
function _chatAppendImage(image) {
  const container = document.getElementById('chat-messages');
  if (!container || !image?.name) return;
  container.appendChild(agentImageEl(image, _chatScroll));
  _chatScroll();
}
function _chatScroll() {
  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function _chatAppendFold(kind, text, label, opts = {}) {
  const container = document.getElementById('chat-messages');
  if (!container) return null;
  const fold = agentFold({
    kind,
    label: kind === 'thinking' ? (label || 'Thinking')
      : kind === 'tool-call'   ? `Command · ${label || 'tool'}`
      : `Result · ${label || 'tool'}`,
    body: kind === 'tool-call' ? _chatPrettyArgs(text) : (text == null ? '' : String(text)),
    active: !!opts.active,
    open: !!opts.open,
  });
  agentFoldMount(container, fold.el);
  _chatScroll();
  return fold;
}

function _chatPrettyArgs(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object') return JSON.stringify(raw, null, 2);
  const s = String(raw);
  try { return JSON.stringify(JSON.parse(s), null, 2); }
  catch { return s; }
}

function _chatAppendContent(content) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  renderThoughtfulContent(content || '', {
    mount: node => agentFoldMount(container, node),
    makeText: text => { if (text) chatAppendMsg('assistant', text); },
  });
  _chatScroll();
}

/* ── Attachments ───────────────────────────────────────
   Attached files are uploaded to the panel and what the agent gets is the
   path, not the bytes. That is why there is no size negotiation and no
   image handling here: a CSV, a log and a photo are the same thing to this
   code, and the model opens whichever of them it can make sense of. */

let chatPending = [];   // attachment records waiting to be sent with the message

/* The turn in flight, if any. Stop hangs up on the stream; the server ties the
   response closing to the turn's own AbortController, so the turn stops with
   it. The step already in flight still finishes — abort cancels our fetch, not
   the request the provider has already accepted — so Stop ends the *next* step
   and the tokens already spent stay spent. The button says so. */
let chatTurn = null;

function _chatBusy(on) {
  chatTurn = on ? chatTurn : null;
  const send = document.getElementById('chat-send');
  const stop = document.getElementById('chat-stop');
  if (send) send.style.display = on ? 'none' : '';
  if (stop) stop.style.display = on ? '' : 'none';
}

function chatStop() {
  if (!chatTurn) return;
  chatTurn.abort();
  _chatBusy(false);
}

function chatAttachPick() { document.getElementById('chat-file').click(); }

async function chatAttachFiles(files) {
  for (const file of [...files]) {
    const chip = _chatChip({ name: file.name, bytes: file.size, pending: true });
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await fetch('/api/attachments', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      chatPending.push(data);
      chip.replaceWith(_chatChip(data));
    } catch (e) {
      chip.classList.add('bad');
      chip.title = e.message;
      chip.querySelector('em').textContent = '✕';
    }
  }
}

function _chatChip(a) {
  const row = document.getElementById('chat-attachments');
  const el  = document.createElement('span');
  el.className = `chat-chip${a.pending ? ' pending' : ''}`;
  el.title = a.path || a.name;
  el.innerHTML = `<span></span><em>${a.pending ? '…' : '×'}</em>`;
  el.firstChild.textContent = `${a.name} · ${_chatBytes(a.bytes)}`;
  if (!a.pending) el.querySelector('em').onclick = () => {
    chatPending = chatPending.filter(x => x.name !== a.name);
    el.remove();
  };
  row.appendChild(el);
  row.style.display = '';
  return el;
}

function _chatBytes(n) {
  if (!(n >= 0)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1e6)  return `${Math.round(n / 1024)} KB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}

function _chatClearChips() {
  chatPending = [];
  const row = document.getElementById('chat-attachments');
  row.innerHTML = '';
  row.style.display = 'none';
}

function chatSend() {
  const input   = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  const attachments = chatPending.map(a => a.name);
  input.value = '';
  chatAppendMsg('user', message + (attachments.length
    ? `\n📎 ${chatPending.map(a => a.name).join(', ')}` : ''));
  _chatClearChips();

  const container = document.getElementById('chat-messages');
  let pendingCall = null;
  // One row, rewritten in place while a provider stays silent, because the
  // alternative is a page that shows nothing for as long as it is quiet and
  // reads as broken rather than as slow.
  let waitingRow  = null;
  const stream = createThinkStream({
    mount: node => { agentFoldMount(container, node); _chatScroll(); },
    makeText: () => chatAppendMsg('assistant', ''),
    scroll: _chatScroll,
  });
  stream.startWaiting();

  chatTurn = new AbortController();
  _chatBusy(true);

  sseStream('/api/chat', { message, attachments }, {
    signal: chatTurn.signal,
    onEvent: evt => {
      if (evt.type === 'text') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        if (waitingRow) { waitingRow.remove(); waitingRow = null; }
        stream.feed(evt.text);
      } else if (evt.type === 'waiting') {
        const note = `${evt.provider} has not sent a token yet — ${evt.seconds}s`
          + (evt.frames ? `, ${evt.frames} keep-alive frames` : '')
          + (evt.timeoutMs ? ` of ${Math.round(evt.timeoutMs / 1000)}s` : '');
        if (waitingRow) waitingRow.textContent = note;
        else waitingRow = chatAppendMsg('waiting', note);
      } else if (evt.type === 'failover') {
        // The answer that follows is not from the model that was chosen. Saying
        // so is the whole point of the chain: a switch nobody is told about is
        // worse than the outage it was covering for.
        if (waitingRow) { waitingRow.remove(); waitingRow = null; }
        chatAppendMsg('failover', evt.text);
        stream.startWaiting();
      } else if (evt.type === 'tool_call') {
        if (waitingRow) { waitingRow.remove(); waitingRow = null; }
        stream.finish();
        stream.resetText();
        if (pendingCall) pendingCall.setActive(false);
        pendingCall = _chatAppendFold('tool-call', JSON.stringify(evt.args ?? {}), evt.name, { active: true });
      } else if (evt.type === 'image') {
        _chatAppendImage(evt.image);
      } else if (evt.type === 'tool_result') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        _chatAppendFold('tool-result', evt.result, evt.name);
        stream.startWaiting();
      } else if (evt.type === 'stderr') {
        stream.finish();
        const el = chatAppendMsg('assistant', evt.text);
        el.style.color = 'var(--red)';
      }
    },
    onError: e => {
      if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
      stream.finish();
      const el = chatAppendMsg('assistant', `Error: ${e.message}`);
      el.style.color = 'var(--red)';
    },
  }).then(() => {
    if (pendingCall) pendingCall.setActive(false);
    stream.finish();
    if (chatTurn?.signal.aborted) chatAppendMsg('system', 'Stopped. The step already running finishes on its own.');
    _chatBusy(false);
  });
}

function chatClear() {
  appConfirm('Clear chat history?', async () => {
    try {
      await apiFetch('/api/chat/clear', { method: 'POST' });
      const container = document.getElementById('chat-messages');
      container.innerHTML = '<div class="chat-msg system">Chat cleared. Send a message to start a new conversation.</div>';
    } catch (e) { appAlert(`Error: ${e.message}`); }
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
    const container = document.getElementById('chat-messages');
    let sentenceBuf  = '';
    let inThinking   = false;
    let pendingCall  = null;
    const stream = createThinkStream({
      mount: node => { agentFoldMount(container, node); _chatScroll(); },
      makeText: () => chatAppendMsg('assistant', ''),
      scroll: _chatScroll,
    });
    stream.startWaiting();
    _callSetStatus('Speaking…', 'speaking');

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
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'text') {
            if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
            stream.feed(evt.text);

            // Spoken text skips `<think>` blocks (character scan so tags
            // split across SSE chunks still drop cleanly).
            const chunk = evt.text;
            for (let i = 0; i < chunk.length; i++) {
              const remaining = chunk.slice(i);
              if (!inThinking && remaining.startsWith('<think>')) {
                inThinking = true;
                i += 6;
                continue;
              }
              if (inThinking && remaining.startsWith('</think>')) {
                inThinking = false;
                i += 7;
                continue;
              }
              if (!inThinking) sentenceBuf += chunk[i];
            }
            if (!inThinking) {
              const sentenceEnd = sentenceBuf.search(/[.!?;:\n]\s*/);
              if (sentenceEnd >= 0) {
                const sentence = sentenceBuf.slice(0, sentenceEnd + 1).trim();
                sentenceBuf = sentenceBuf.slice(sentenceEnd + 1);
                if (sentence.length > 1) _callEnqueueSynth(sentence);
              }
            }
          } else if (evt.type === 'tool_call') {
            stream.finish();
            stream.resetText();
            if (pendingCall) pendingCall.setActive(false);
            pendingCall = _chatAppendFold('tool-call', JSON.stringify(evt.args ?? {}), evt.name, { active: true });
          } else if (evt.type === 'tool_result') {
            if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
            _chatAppendFold('tool-result', evt.result, evt.name);
            stream.startWaiting();
          }
        } catch {}
      }
      _chatScroll();
    }

    if (pendingCall) pendingCall.setActive(false);
    stream.finish();

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

/* ═══════════════════════════════════════════════════════
   DOCA PANEL — FLOATING CHAT (agent)
   ═══════════════════════════════════════════════════════ */

let chatLoaded = false;

function toggleChat(keepCall) {
  chatOpen = !chatOpen;
  document.getElementById('chat-panel').classList.toggle('open', chatOpen);
  document.getElementById('chat-fab').classList.toggle('active', chatOpen);
  if (chatOpen && !chatTurn) {
    chatLoaded = true;
    chatLoadHistory();
  }
  if (chatOpen) { chatRestoreGeom(); document.getElementById('chat-input').focus(); }
  if (!chatOpen && _callActive && keepCall !== true) _callStop('the chat was closed');   // the face hides the chat and keeps the call
}

async function chatLoadHistory() {
  try {
    const data = await apiFetch('/api/chat/history');
    if (chatTurn) return;
    const msgs = data.messages || [];
    {
      const container = document.getElementById('chat-messages');
      container.innerHTML = '';
      msgs.forEach(m => {
        if (m.role === 'assistant') {
          for (const step of m.working || []) {
            const fold = _chatAppendFold(step.kind, step.body, step.label);
            if (step.at) fold.el.dataset.at = step.at;
          }
          (m.images || []).forEach(_chatAppendImage);
          if (m.content) _chatAppendContent(m.content);
        }
        else {
          chatAppendMsg(m.role, m.content);
          // What the user attached is drawn or played again on reload, the same
          // as when it was sent; anything that is not media stays a name.
          for (const name of m.attachments || []) {
            if (_mediaKindOf('', name)) _chatAppendImage({ name });
          }
        }
      });
      collapseFoldRuns(container);
    }
    // How full the window already is, before this panel sends anything. Absent
    // for a harness that does not report one, which is what '' draws.
    _chatContext(data.context);
    _chatLoadApproval();
  } catch {}
}

/** Draw the context ring in the header. */
function _chatContext(u) {
  const el = document.getElementById('chat-context');
  if (el) el.innerHTML = contextRingHtml(u);
}

/**
 * A blocked tool call, in the floating chat.
 *
 * The same three states the console handles, and for the same reasons: the
 * card leaves the working fold (which collapses, and would hide the question
 * the turn is stopped on) and settles itself when the answer came from the
 * other chat.
 */
function _chatApproval(evt, container) {
  // Its three states are decided once, for every chat (agent-ui/event-sink.js).
  agentApprovalEvent(evt, container, { note: text => chatAppendMsg('system', text), onSettle: () => _chatLoadApproval(), scroll: _chatScroll });
}

/** The Auto / Manual pill in the chat header. It is one global setting, so
 *  this and the console's pill are two views of the same switch. */
async function _chatLoadApproval() {
  const slot = document.getElementById('chat-approval');
  if (!slot) return;
  try {
    const a = await apiFetch('/api/harness/approval');
    if (!slot.firstChild) slot.appendChild(approvalModeEl());
    slot.firstChild.render(a.mode);
  } catch { /* no pill rather than a broken header */ }
}

function chatAppendMsg(role, text, opts = {}) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  // The agent's words are markdown, rendered; everything else (the user's words, status, errors) is literal: `plain`.
  if (role === 'assistant' && !opts.plain) mdInto(el, text);
  else if (role === 'user' && typeof formHelpTextInto === 'function') formHelpTextInto(el, text); else el.textContent = text;
  if (role === 'user') container.appendChild(el);
  else agentWorkingMount(container, el);
  container.scrollTop = container.scrollHeight;
  return el;
}

/** A picture the agent showed. */
function _chatAppendImage(image) {
  const container = document.getElementById('chat-messages');
  if (!container || !image?.name) return;
  // The sentence the picture is shown under comes out of the turn's account
  // first, so the picture lands below it rather than below the whole turn —
  // see `agentWorkingGiveBack`. A no-op on a reload, which has no open block.
  agentWorkingGiveBack(container);
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

/* ── A voice message ──────────────────────────────────
   Press to record, press again to send. The recording is an ordinary
   attachment, so it lands in the transcript and on disk like every other file;
   what makes it a *voice message* is that the panel transcribes it and asks for
   the answer out loud. The call mode below is a different thing: that one holds
   the microphone open and talks back continuously. */
let _chatRec = null;          // { recorder, chunks, stream }

async function chatVoiceNote() {
  const btn = document.getElementById('chat-mic');
  if (_chatRec) return _chatVoiceStop();

  try {
    const stream = await micOpen(true);
    // webm/opus is what every browser that has MediaRecorder can write, and
    // what the STT service is already fed by call mode.
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => _chatVoiceSend(new Blob(chunks, { type: 'audio/webm' }));
    recorder.start();
    _chatRec = { recorder, stream };
    if (btn) { btn.classList.add('btn-red'); btn.textContent = '■'; btn.title = 'Stop and send'; }
  } catch (e) {
    appAlert(`The microphone did not open: ${e.message}`);
  }
}

function _chatVoiceStop() {
  const { recorder, stream } = _chatRec || {};
  _chatRec = null;
  const btn = document.getElementById('chat-mic');
  if (btn) { btn.classList.remove('btn-red'); btn.textContent = '🎤'; btn.title = 'Record a voice message'; }
  try { recorder?.stop(); } catch {}
  try { stream?.getTracks().forEach(t => t.stop()); } catch {}
}

/**
 * A recording as 16 kHz mono WAV, which is what speech services actually take.
 *
 * MediaRecorder writes WebM/Opus in Chrome and MP4/AAC in Safari, and a Whisper
 * server given either commonly answers `500 Internal Server Error` — observed,
 * and the reason a voice message failed the first time it was tried. Decoding
 * is the browser's job anyway (`decodeAudioData` reads both), and WAV at 16 kHz
 * mono is both the format every STT accepts and a smaller upload than the
 * original: one channel, the sample rate speech models resample to regardless.
 * It is also the format that plays back in every browser, so the attachment in
 * the transcript is the same file that was transcribed.
 */
async function _chatWav(blob) {
  const bytes = await blob.arrayBuffer();
  const decoded = await new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(bytes);

  const rate = 16000;
  const off  = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src  = off.createBufferSource();
  src.buffer = decoded;                       // downmixed to mono by the 1-channel destination
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);

  const buf  = new ArrayBuffer(44 + mono.length * 2);
  const view = new DataView(buf);
  const ascii = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + mono.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Upload the recording, transcribe it, and send it as the message.
 *
 * The agent reads words, so the transcript is the message and the recording
 * rides along as the attachment — the file is there to be listened to, and
 * because a transcript is a guess about what was said. `spoken` is what makes
 * the answer come back out loud.
 */
async function _chatVoiceSend(recorded) {
  const input = document.getElementById('chat-input');
  const name  = `voice-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
  const chip  = _chatChip({ name, bytes: recorded.size, pending: true });
  try {
    const blob = await _chatWav(recorded);
    const fd = new FormData();
    fd.append('file', new File([blob], name, { type: 'audio/wav' }));
    const up = await fetch('/api/attachments', { method: 'POST', body: fd });
    const rec = await up.json();
    if (!up.ok) throw new Error(rec.error || `HTTP ${up.status}`);
    chatPending.push(rec);
    chip.replaceWith(_chatChip(rec));

    const fd2 = new FormData();
    fd2.append('audio', new File([blob], name, { type: 'audio/wav' }));
    const st = await fetch('/api/chat/transcribe', { method: 'POST', body: fd2 });
    const data = await st.json();
    if (!st.ok) throw new Error(data.error || `HTTP ${st.status}`);

    const text = (data.text || '').trim();
    if (!text) { appAlert('Nothing was heard in that recording.'); return; }
    if (input) input.value = text;
    chatSend({ spoken: true });
  } catch (e) {
    chip.classList.add('bad');
    chip.title = e.message;
    chip.querySelector('em').textContent = '✕';
    appAlert(`Voice message failed: ${e.message}`);
  }
}

/** Read an answer out loud, through the same TTS the call mode uses. */
async function _chatSpeak(text) {
  const say = String(text || '').trim();
  if (!say) return;
  try {
    const res = await fetch('/api/chat/synthesize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: say.slice(0, 4000) }),
    });
    if (!res.ok) return;                       // no TTS configured is not an error worth a modal
    const url = URL.createObjectURL(await res.blob());
    const el = new Audio(url);
    el.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
    el.play().catch(() => URL.revokeObjectURL(url));
  } catch { /* the answer is on screen either way */ }
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

function chatSend({ spoken = false } = {}) {
  const input   = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  const attachments = chatPending.map(a => a.name);
  const shown = chatPending.filter(a => /^(image|audio|video)\//.test(a.mime || ''));
  const named = chatPending.filter(a => !shown.includes(a));
  input.value = '';
  chatAppendMsg('user', message + (named.length ? `\n📎 ${named.map(a => a.name).join(', ')}` : ''));
  // Media is shown rather than named: a picture reads as a picture, a voice message plays back.
  for (const a of shown) _chatAppendImage({ name: a.name, mime: a.mime });
  _chatClearChips();

  // The agent is told how this arrived: "answer out loud" is a fact about the request, not a setting. The panel
  // does the speaking; this stops a spoken question being answered with three screens of prose.
  const sent = (typeof formHelpAttach === 'function' ? formHelpAttach : m => m)(spoken
    ? `${message}\n\n[Sent as a voice message; the text above is its transcript, and the recording is attached. `
      + 'Answer as if speaking: a few sentences, no markdown, no lists, no code — unless the message itself asks '
      + 'for something else. Your answer is read aloud as well as shown.]'
    : message);

  // Working already: it waits and is read at the next step, or starts the next turn (agent-ui/queued-send.js).
  if (chatTurn) {
    agentQueuedSend('/api/chat', { message: sent, attachments }, { mark: agentQueuedTag(document.getElementById('chat-messages').lastElementChild),
      startTurn: async () => { while (chatTurn) await new Promise(r => setTimeout(r, 50)); return _chatTurnUi(spoken); } });
    return;
  }
  const ui = _chatTurnUi(spoken);
  sseStream('/api/chat', { message: sent, attachments }, { signal: chatTurn.signal, onEvent: ui.onEvent, onError: ui.onError }).then(ui.finish);
}

/** One turn drawn in the floating chat (everything in one block that becomes one line when it ends). */
function _chatTurnUi(spoken) {
  const container = document.getElementById('chat-messages');
  agentWorkingOpen(container);
  const stream = createThinkStream({
    mount: node => { agentFoldMount(container, node); _chatScroll(); },
    makeText: () => chatAppendMsg('assistant', ''),
    scroll: _chatScroll,
  });
  stream.startWaiting();

  const turn = chatTurn = new AbortController();   // this turn's own, so its end cannot clear the next one's
  _chatBusy(true);

  // Kept so a spoken question can be answered out loud once the answer is whole.
  let reply = '';
  // What each event means is decided once (agent-ui/event-sink.js); this is how the floating chat draws it.
  const sink = agentEventSink({
    stream,
    fold: (kind, body, name, opts) => _chatAppendFold(kind, body, name, opts),
    note: (kind, text) => chatAppendMsg(kind === 'waiting' ? 'waiting' : 'failover', text),
    image: img => _chatAppendImage(img),
    approval: evt => _chatApproval(evt, container),
    error: msg => { const el = chatAppendMsg('assistant', `Error: ${msg}`, { plain: true }); el.style.color = 'var(--red)'; },
    context: evt => _chatContext(evt),
    onText: t => { reply += t; },
    userAdded: evt => chatAppendMsg('user', evt.text),
  });
  return { onEvent: sink.onEvent, onError: sink.onError, finish: () => {
    sink.finish();
    // The turn is over, so the rows it left open close: the account of a
    // finished run is a few short lines rather than a wall of command bodies.
    closeFolds(container);
    agentWorkingClose(container);
    // After the fold closes, so the rate is the last thing under the answer
    // rather than a line the collapsing run swallows.
    const rate = tokenRateEl(sink.spend);
    if (rate) { container.appendChild(rate); _chatScroll(); }
    // Spoken to, speak back — after the answer is on screen, so a TTS that is
    // not configured costs nothing but silence.
    if (spoken && !turn.signal.aborted) _chatSpeak(reply);
    if (chatTurn === turn && !turn.stopping) _chatBusy(false);   // a Stop clears it itself, once the hub says it ended (chat-stop.js)
  } };
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

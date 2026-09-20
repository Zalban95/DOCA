/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — FLOATING CHAT (agent)
   ═══════════════════════════════════════════════════════ */

let chatLoaded = false;

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-panel').classList.toggle('open', chatOpen);
  document.getElementById('chat-fab').classList.toggle('active', chatOpen);
  if (chatOpen && !chatTurn) {
    chatLoaded = true;
    chatLoadHistory();
  }
  if (chatOpen) { chatRestoreGeom(); document.getElementById('chat-input').focus(); }
  if (!chatOpen && _callActive) _callStop();
}

/* ── Moving and resizing the window ─────────────────────
   The panel used to be nailed to the bottom-right corner of the desktop
   layout. It can be dragged by its header and resized from its corner instead,
   and it remembers where it was left.

   Desktop only. Below 769px the responsive rules make this a full-screen sheet
   with its own geometry, and inline left/top/width/height would fight them —
   so the gesture handlers refuse, and flipping the window across the boundary
   hands the panel back to the stylesheet. DocaDesk is a WebView2 around this
   same page, so it gets this for nothing. */

const CHAT_GEOM_KEY = 'doca.chat.geom';
const CHAT_MIN_W = 320;
const CHAT_MIN_H = 260;
const CHAT_DESKTOP = '(min-width: 769px)';

const _chatIsDesktop = () => window.matchMedia(CHAT_DESKTOP).matches;

/** Where the window was left, or null. Never throws: site data can be blocked. */
function _chatGeomRead() {
  try {
    const g = JSON.parse(localStorage.getItem(CHAT_GEOM_KEY) || 'null');
    return g && ['x', 'y', 'w', 'h'].every(k => typeof g[k] === 'number') ? g : null;
  } catch { return null; }
}

function _chatGeomWrite(g) {
  try { localStorage.setItem(CHAT_GEOM_KEY, JSON.stringify(g)); } catch { /* private window */ }
}

/**
 * Keep the window on screen and no smaller than it can usefully be.
 *
 * The margin is a header's worth of pixels, not the whole window: a panel that
 * could be pushed completely off an edge could never be grabbed again, and
 * there is no title bar to double-click to bring it back.
 */
function _chatClamp(g) {
  const w = Math.max(CHAT_MIN_W, Math.min(g.w, window.innerWidth - 16));
  const h = Math.max(CHAT_MIN_H, Math.min(g.h, window.innerHeight - 16));
  return {
    w, h,
    x: Math.max(16 - w + 90, Math.min(g.x, window.innerWidth - 90)),
    y: Math.max(0, Math.min(g.y, window.innerHeight - 40)),
  };
}

function _chatApplyGeom(panel, g) {
  panel.style.left   = `${Math.round(g.x)}px`;
  panel.style.top    = `${Math.round(g.y)}px`;
  panel.style.width  = `${Math.round(g.w)}px`;
  panel.style.height = `${Math.round(g.h)}px`;
  // left/top win, and leaving right/bottom set would keep stretching it.
  panel.style.right  = 'auto';
  panel.style.bottom = 'auto';
}

/** Hand the panel back to the stylesheet, for the mobile sheet layout. */
function _chatDropGeom(panel) {
  for (const p of ['left', 'top', 'width', 'height', 'right', 'bottom'])
    panel.style.removeProperty(p);
}

/** Put the window back where it was left, if it was moved at all. */
function chatRestoreGeom() {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  if (!_chatIsDesktop()) { _chatDropGeom(panel); return; }
  const g = _chatGeomRead();
  if (g) _chatApplyGeom(panel, _chatClamp(g));
}

/**
 * One gesture — a move or a resize — from pointerdown to pointerup.
 *
 * The position is re-read from the element at the start of every gesture
 * rather than accumulated across them, so a window that has been dragged
 * around all day is still measured against the truth. Pointer events, so a
 * mouse, a trackpad and a touchscreen are one code path.
 */
function _chatGesture(panel, ev, mode) {
  if (ev.button !== 0 || !_chatIsDesktop()) return;
  ev.preventDefault();

  const handle = ev.currentTarget;
  const r0 = panel.getBoundingClientRect();
  const from = { px: ev.clientX, py: ev.clientY, x: r0.left, y: r0.top, w: r0.width, h: r0.height };
  try { handle.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
  document.body.classList.add(mode === 'move' ? 'chat-dragging' : 'chat-resizing');

  const onMove = e => {
    const dx = e.clientX - from.px;
    const dy = e.clientY - from.py;
    _chatApplyGeom(panel, _chatClamp(mode === 'move'
      ? { x: from.x + dx, y: from.y + dy, w: from.w, h: from.h }
      : { x: from.x, y: from.y, w: from.w + dx, h: from.h + dy }));
  };
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('chat-dragging', 'chat-resizing');
    try { handle.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    const r = panel.getBoundingClientRect();
    _chatGeomWrite({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

/** Grab the header to move the window. */
function chatDragStart(ev) {
  const panel = document.getElementById('chat-panel');
  // A press on a control in the header is a press on that control.
  if (!panel || ev.target.closest('button, a, input, textarea, select')) return;
  _chatGesture(panel, ev, 'move');
}

/** Grab the corner grip to resize it. */
function chatResizeStart(ev) {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  ev.stopPropagation();
  _chatGesture(panel, ev, 'size');
}

// A window that changes size can leave the panel outside it, and a window that
// crosses the mobile boundary hands it back to the stylesheet.
window.addEventListener('resize', chatRestoreGeom);
try {
  window.matchMedia(CHAT_DESKTOP).addEventListener('change', chatRestoreGeom);
} catch { /* older WebView2 */ }

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
  if (!container) return;
  agentWorkingGiveBack(container);
  if (evt.state === 'refused') {
    chatAppendMsg('system', `Not run — ${evt.tool} needs approval and a mission has nobody to ask.`);
    return;
  }
  if (evt.state === 'answered') {
    container.querySelector(`[data-approval-id="${CSS.escape(evt.id)}"]`)?.settleFrom?.(evt.decision);
    approvalPopupClose(evt.id);
    _chatScroll();
    return;
  }
  const card = approvalCardEl(evt, () => _chatLoadApproval());
  container.appendChild(card);
  approvalPopup(evt, d => { card.settleFrom?.(d); _chatLoadApproval(); });
  _chatScroll();
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
  // What the agent said is markdown, so it is rendered rather than shown as
  // its own punctuation. Everything else in this transcript — the user's own
  // words, a status line, an error, raw stderr — is literal text, and `plain`
  // is how a caller says so.
  if (role === 'assistant' && !opts.plain) mdInto(el, text);
  else el.textContent = text;
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    appAlert(`No microphone: ${e.message}`);
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
  // Media is shown rather than named: a picture the user sent reads as a
  // picture, and a voice message can be played back out of the transcript.
  for (const a of shown) _chatAppendImage({ name: a.name, mime: a.mime });
  _chatClearChips();

  // The agent is told how this arrived and what to do about it, because
  // "answer out loud" is a fact about the request rather than a setting. The
  // panel still does the speaking; this is what stops a spoken question being
  // answered with three screens of prose and a code block.
  const sent = spoken
    ? `${message}\n\n[Sent as a voice message; the text above is its transcript, and the recording is attached. `
      + 'Answer as if speaking: a few sentences, no markdown, no lists, no code — unless the message itself asks '
      + 'for something else. Your answer is read aloud as well as shown.]'
    : message;

  const container = document.getElementById('chat-messages');
  let pendingCall = null;
  // One row, rewritten in place while a provider stays silent, because the
  // alternative is a page that shows nothing for as long as it is quiet and
  // reads as broken rather than as slow.
  let waitingRow  = null;
  // Everything this turn does goes in one block that shows its current row and
  // becomes one line when the turn ends.
  agentWorkingOpen(container);
  const stream = createThinkStream({
    mount: node => { agentFoldMount(container, node); _chatScroll(); },
    makeText: () => chatAppendMsg('assistant', ''),
    scroll: _chatScroll,
  });
  stream.startWaiting();

  chatTurn = new AbortController();
  _chatBusy(true);

  // Kept so a spoken question can be answered out loud once the answer is whole.
  let reply = '';
  // The last step's account of the turn: the ring follows it while the turn
  // runs, and the rate under the answer is read off it once the turn ends.
  let spend = null;
  sseStream('/api/chat', { message: sent, attachments }, {
    signal: chatTurn.signal,
    onEvent: evt => {
      if (evt.type === 'thinking') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        if (waitingRow) { waitingRow.remove(); waitingRow = null; }
        stream.feedThinking(evt.text);
      } else if (evt.type === 'text') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        if (waitingRow) { waitingRow.remove(); waitingRow = null; }
        reply += evt.text;
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
      } else if (evt.type === 'usage') {
        spend = evt;
        _chatContext(evt);
      } else if (evt.type === 'approval') {
        _chatApproval(evt, container);
      } else if (evt.type === 'image') {
        _chatAppendImage(evt.image);
      } else if (evt.type === 'tool_result') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        _chatAppendFold('tool-result', evt.result, evt.name);
        stream.startWaiting();
      } else if (evt.type === 'stderr') {
        stream.finish();
        const el = chatAppendMsg('assistant', evt.text, { plain: true });
        el.style.color = 'var(--red)';
      }
    },
    onError: e => {
      if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
      stream.finish();
      const el = chatAppendMsg('assistant', `Error: ${e.message}`, { plain: true });
      el.style.color = 'var(--red)';
    },
  }).then(() => {
    if (pendingCall) pendingCall.setActive(false);
    stream.finish();
    // The turn is over, so the rows it left open close: the account of a
    // finished run is a few short lines rather than a wall of command bodies.
    closeFolds(container);
    agentWorkingClose(container);
    // After the fold closes, so the rate is the last thing under the answer
    // rather than a line the collapsing run swallows.
    const rate = tokenRateEl(spend);
    if (rate) { container.appendChild(rate); _chatScroll(); }
    if (chatTurn?.signal.aborted) chatAppendMsg('system', 'Stopped. The step already running finishes on its own.');
    // Spoken to, speak back — after the answer is on screen, so a TTS that is
    // not configured costs nothing but silence.
    if (spoken && !chatTurn?.signal.aborted) _chatSpeak(reply);
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
    agentWorkingOpen(container);
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
          if (evt.type === 'thinking') {
            if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
            stream.feedThinking(evt.text);
          } else if (evt.type === 'text') {
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

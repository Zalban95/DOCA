/* In a call, in the Focused view: the Live call (the face's call — chat-call.js with `assistant`, the Quick voice)
   drawn calmly. The points large, what they are doing (Listening, Thinking, Speaking), what was heard (muted) and what
   is said (bright), the newest thing done as a card with its Undo, and Mute · Chat · End. On a phone it fills the
   screen; on a desk it sits beside the conversation. The call itself is the panel's own: its microphone, its voice,
   its turns into the person's conversation — this only draws it (focusedCallSay and focusedVoice are called where the
   call already tells the face and Ambient what it is doing). */
let _fcCall = null;   // {at, el, dots, obs, timer, muted, side}

const _fcInCall = () => (typeof _callActive !== 'undefined' && _callActive) || (typeof _rt !== 'undefined' && !!_rt);
const _fcWide = () => window.matchMedia('(min-width: 900px)').matches;

/** Talk: start the Live call inside the tap (its audio must start there), then draw it. */
function fcCallStart() {
  const started = !_fcInCall() && typeof chatToggleCall === 'function' ? chatToggleCall({ assistant: true }) : null;
  if (!_fcCall) _fcCall = { at: Date.now(), muted: false };
  if (_fcWide()) { if (_fcScreen !== 'chat') fcGo('chat'); else fcCallSideDraw(); }
  else _fcCallSheet();
  if (started) started.then(ok => { if (!ok && !_fcInCall()) { _fcCallLine('label', typeof _callNotStarted === 'string' && _callNotStarted ? _callNotStarted : 'The call did not start.'); setTimeout(() => fcCallEnd(true), 3500); } });
  clearInterval(_fcCall.timer);
  _fcCall.timer = setInterval(_fcCallTick, 1000);
  _fcCallWatch();
}

/** The call's own body: shared by the phone's sheet and the desk's side. */
function _fcCallBody(size) {
  return `<div class="fc-call-top"><span class="fc-lab">In a call</span><span class="fc-mono fc-muted fc-small" data-call="clock">00:00</span></div>
    <div class="fc-call-dots" data-call="dots" style="width:${size}px;height:${size}px"></div>
    <div class="fc-lab fc-call-label" data-call="label">Connecting…</div>
    <p class="fc-muted fc-call-heard" data-call="heard"></p>
    <p class="fc-bright fc-call-said" data-call="said"></p>
    <div class="fc-call-card" data-call="card"></div>
    <div class="fc-call-acts">
      <div><button type="button" class="fc-round" data-call="mute" onclick="fcCallMute()" aria-label="Mute">${fcIcon('mic')}</button><div class="fc-cap">Mute</div></div>
      <div class="fc-call-chat"><button type="button" class="fc-round" onclick="fcCallToChat()" aria-label="Show the conversation">${fcIcon('chat')}</button><div class="fc-cap">Chat</div></div>
      <div><button type="button" class="fc-round fc-end" onclick="fcCallEnd()" aria-label="End the call">${fcIcon('end')}</button><div class="fc-cap">End</div></div>
    </div>`;
}

function _fcCallSheet() {
  let el = document.getElementById('fc-call');
  if (!el) {
    el = Object.assign(document.createElement('section'), { id: 'fc-call', className: 'fc-call-sheet' });
    el.setAttribute('aria-label', 'In a call');
    el.innerHTML = `<div class="fc-call-brand"><span class="fc-pt" aria-hidden="true"></span><span class="fc-bright fc-strong fc-call-name">${escHtml(fcProduct())}</span><span class="fc-mono fc-muted fc-small" data-call="clock">00:00</span></div>${_fcCallBody(300)}`;
    document.getElementById('focused')?.append(el);
  }
  el.hidden = false;
  _fcCallMount(el, 300);
}

/** On a desk: beside the conversation, while a call is on (the chat screen calls this when it draws). */
function fcCallSideDraw() {
  const side = document.getElementById('fc-call-side');
  if (!side || !_fcCall) return;
  side.hidden = false;
  side.className = 'fc-call-side fc-card';
  side.innerHTML = _fcCallBody(240);
  _fcCallMount(side, 240);
  fcOwn(() => { _fcCall?.dots?.stop(); if (_fcCall) _fcCall.dots = null; });
}

function _fcCallMount(el, size) {
  _fcCall.el = el;
  _fcCall.dots?.stop();
  _fcCall.dots = fcDots(el.querySelector('[data-call="dots"]'), size);
  _fcCallTick(); _fcCallRead();
  if (!_fcCall) return;   // the tick found the call already over
  if (_fcCall.state) focusedCallSay(_fcCall.status, _fcCall.state);
  el.querySelector('[data-call="mute"]')?.setAttribute('aria-pressed', String(!!_fcCall.muted));
}

function _fcCallLine(key, text) { const n = _fcCall?.el?.querySelector(`[data-call="${key}"]`); if (n) n.textContent = text; return n; }

function _fcCallTick() {
  if (!_fcCall) return;
  const s = Math.floor((Date.now() - _fcCall.at) / 1000);
  _fcCallLine('clock', `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  if (s > 4 && !_fcInCall() && !(typeof _callStarting !== 'undefined' && _callStarting)) fcCallEnd(true);   // ended elsewhere (the hub, a hang-up)
}

/** What the call says it is doing (chat-call.js _callSetStatus): Listening, Thinking, Speaking. */
function focusedCallSay(text, state) {
  if (!_fcCall) return;
  _fcCall.status = text; _fcCall.state = state;
  if (_fcCall.muted && state === 'listening') return;   // muted says so until unmuted
  _fcCallLine('label', String(text || state || '').replace(/…$/, ''));
}

/** What was heard and what is said: the newest of each in the call's own transcript (the floating chat's). */
function _fcCallWatch() {
  const box = document.getElementById('chat-messages');
  if (!box || _fcCall.obs) return;
  _fcCall.obs = new MutationObserver(() => _fcCallRead());
  _fcCall.obs.observe(box, { childList: true, subtree: true, characterData: true });
}
function _fcCallRead() {
  const box = document.getElementById('chat-messages');
  if (!box || !_fcCall) return;
  const last = sel => [...box.querySelectorAll(sel)].pop();
  const heard = last('.chat-msg.user')?.textContent?.trim();
  const said = last('.chat-msg.assistant')?.textContent?.trim();
  if (heard) _fcCallLine('heard', `“${heard.slice(0, 220)}”`);
  if (said) _fcCallLine('said', said.length > 280 ? `${said.slice(0, 280)}…` : said);
  const card = _fcCall.el?.querySelector('[data-call="card"]');
  const newest = [...document.querySelectorAll('#fc-msgs .fc-result')].pop();
  if (card && newest && !card.contains(newest)) card.replaceChildren(newest.cloneNode(true)), _fcCallRebind(card, newest);
}
/** A cloned card keeps its buttons working: each one clicks the original's. */
function _fcCallRebind(clone, orig) {
  const a = clone.querySelectorAll('button'), b = orig.querySelectorAll('button');
  a.forEach((btn, i) => { btn.onclick = () => b[i]?.click(); });
}

/** Mute: the microphone's track is switched off and on; the call goes on. */
function fcCallMute() {
  if (!_fcCall) return;
  _fcCall.muted = !_fcCall.muted;
  try { (typeof _callStream !== 'undefined' && _callStream?.getAudioTracks() || []).forEach(t => { t.enabled = !_fcCall.muted; }); } catch { /* no stream */ }
  const b = _fcCall.el?.querySelector('[data-call="mute"]');
  if (b) { b.setAttribute('aria-pressed', String(_fcCall.muted)); b.innerHTML = fcIcon(_fcCall.muted ? 'micOff' : 'mic'); }
  _fcCallLine('label', _fcCall.muted ? 'Muted' : 'Listening');
}

/** Chat: the conversation; the call goes on (a desk shows it beside). */
function fcCallToChat() {
  document.getElementById('fc-call')?.setAttribute('hidden', '');
  fcGo('chat');
}

/** End the call (`quiet`: it already ended elsewhere) and put the call view away. */
function fcCallEnd(quiet) {
  if (!quiet && _fcInCall() && typeof _callStop === 'function') _callStop('the person ended the call');
  if (!_fcCall) return;
  clearInterval(_fcCall.timer);
  _fcCall.obs?.disconnect();
  _fcCall.dots?.stop();
  _fcCall = null;
  document.getElementById('fc-call')?.remove();
  const side = document.getElementById('fc-call-side');
  if (side) { side.hidden = true; side.replaceChildren(); }
}

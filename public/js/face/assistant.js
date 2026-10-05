/* Assistant mode (asked 2026-10-05): tapping the face is talking to the hive, not opening a chat. The face fills the
   screen, a live call starts at once and answers aloud, and the chat stays out of the way. After `call.assistantIdleSec`
   with nobody speaking and nothing being said, a screen that listens for its wake word (experiment wakeWord,
   call.listenWithFace) ends the call and waits for the name; otherwise the call keeps listening. The wake word opens
   this mode too. ✕ or Back closes it and ends the call; a tap on the face while it waits talks at once. The 🎙 in the
   chat is still the plain call, with its transcript. */
let _assistant = null;   // {el, face, closeFeed, back, timer, status}

function assistantIsOpen() { return !!_assistant; }

const _assistantInCall = () => (typeof _callActive !== 'undefined' && _callActive) || (typeof _rt !== 'undefined' && !!_rt);

/** Open (or bring back) assistant mode and talk; `first` is a first message (the words after a wake word). */
async function assistantOpen(first) {
  // The call is started before anything else, inside the tap, so its audio may play (chat-call.js).
  const started = _assistantInCall() ? null : chatToggleCall({ assistant: true });
  if (!_assistant) _assistantBuild();
  _assistantSay('Listening…');
  const ok = (started && await started) || _assistantInCall();
  if (!ok) { _assistantSay('The call did not start — the chat says why.'); return; }
  if (first && typeof _callAnswer === 'function') _callAnswer(first);
}

function _assistantBuild() {
  const el = document.createElement('div');
  el.id = 'face-assistant';
  el.className = 'face-assistant';
  el.innerHTML = `<canvas></canvas><div class="face-assistant-status" id="face-assistant-status"></div>
    <button class="face-assistant-close" title="Close (ends the call)" aria-label="Close">✕</button>`;
  document.body.appendChild(el);
  const a = { el, face: { set() {}, level() {}, stop() {} }, closeFeed: () => {} };
  _assistant = a;
  el.querySelector('.face-assistant-close').onclick = e => { e.stopPropagation(); assistantClose(); };
  el.querySelector('canvas').onclick = () => { if (!_assistantInCall()) assistantOpen(); };   // waiting for the name: a tap talks now
  a.back = typeof overlayBack === 'function' ? overlayBack(() => assistantClose(true)) : () => {};
  faceSpec().then(spec => {
    if (_assistant !== a) return;
    a.face = faceMount(el.querySelector('canvas'), { ...spec, hud: false });
    a.closeFeed = faceFeed(s => { if (Date.now() > _faceVoiceUntil) a.face.set(s.state, s.detail); });
  });
  a.timer = setInterval(_assistantIdle, 1000);
}

/** The call's level drives this face as it drives the corner's (faceCornerVoice). */
function assistantVoice(state, level) {
  if (!_assistant?.face?.level) return;
  _assistant.face.set(state);
  _assistant.face.level(level);
}

function _assistantSay(text) { const s = document.getElementById('face-assistant-status'); if (s) s.textContent = text; }

/** Quiet for long enough: wait for the name where this screen listens for it, else keep the call listening. */
async function _assistantIdle() {
  if (!_assistant || !_callActive || typeof _callIdleMs !== 'function') return;
  let c = {}, ex = {};
  try { const s = await screenLoad(); c = s.settings?.call || {}; ex = s.experiments || {}; } catch { /* defaults */ }
  if (_callIdleMs() < (c.assistantIdleSec >= 5 ? c.assistantIdleSec : 12) * 1000) return;
  if (!(ex.wakeWord && c.listenWithFace)) return;   // no name to wait for: keep listening
  _callStop();   // which starts the wake word listening again (wake-word.js)
  const word = String(c.wakeWord || '').trim() || (typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA';
  _assistantSay(`Say “${word}” to talk — or tap the face.`);
}

function assistantClose(fromBack) {
  const a = _assistant;
  if (!a) return;
  _assistant = null;
  clearInterval(a.timer);
  if (_assistantInCall()) _callStop();
  a.face.stop(); a.closeFeed(); a.el.remove();
  if (!fromBack) a.back();
  if (typeof wakeWordApply === 'function') wakeWordApply();
}

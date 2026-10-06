/* The face in the panel's corner (TODO H8.1), for screens that switch it on (Settings → General → Appearance; per
   screen, kept in this browser). Its own circle beside the chat button, which keeps its ⬡ and its ✕ — drawn inside
   the button it covered the one control that opens and closes the chat. A tap opens assistant mode (the face full
   screen, talking — face/assistant.js); during a call started from the chat it shows or hides the chat. It used to open /face, which in a phone app's WebView replaced the panel and ended the call —
   the full-screen face is in Settings → General → Appearance. */
let _faceCorner = null;
let _faceVoiceUntil = 0;   // while a call drives the face (faceCornerVoice), the hive's own feed waits

/** A voice call drives the corner face for a moment: its state and how loud (experiments.faceVoice, chat-call.js). */
function faceCornerVoice(state, level) {
  _faceVoiceUntil = Date.now() + 1500;
  if (typeof assistantVoice === 'function') assistantVoice(state, Math.max(0, Math.min(1, level)));
  if (typeof ambientVoice === 'function') ambientVoice(state, Math.max(0, Math.min(1, level)));
  if (!_faceCorner?.face?.level) return;
  _faceCorner.face.set(state);
  _faceCorner.face.level(Math.max(0, Math.min(1, level)));
}

/** A tap: assistant mode when no call is on (face/assistant.js — the call is made inside the tap, so its audio may
    play); during a call started from the chat, the chat shown or hidden. */
function faceCornerTap() {
  const inCall = (typeof _callActive !== 'undefined' && _callActive) || (typeof _rt !== 'undefined' && _rt);
  if (!inCall && typeof assistantOpen === 'function') return assistantOpen();
  if (typeof toggleChat === 'function') toggleChat(true);
}

function faceCornerOn() { try { return localStorage.getItem('doca.face.corner') === '1'; } catch { return false; } }

async function faceCornerApply() {
  if (!document.getElementById('chat-fab')) return;
  if (!faceCornerOn()) {
    if (_faceCorner) { _faceCorner.face.stop(); _faceCorner.close(); _faceCorner.el?.remove(); _faceCorner = null; }
    return;
  }
  if (_faceCorner) return;
  _faceCorner = { face: { stop() {} }, close() {} };   // claimed before the await, so two calls make one face
  const spec = await faceSpec();
  if (!faceCornerOn()) { _faceCorner = null; return; }   // switched off while it loaded
  const el = document.createElement('button');
  el.id = 'face-corner';
  el.className = 'face-corner';
  el.type = 'button';
  el.title = 'Talk to the hive — during a call, show or hide the chat';
  el.onclick = faceCornerTap;
  const canvas = document.createElement('canvas');
  el.appendChild(canvas);
  document.body.appendChild(el);
  const face = faceMount(canvas, { ...spec, dots: 200, hud: false, grain: false });
  _faceCorner = { el, face, close: faceFeed(s => { if (Date.now() > _faceVoiceUntil) face.set(s.state, s.detail); }) };
}

/** Draw the corner face again with the screen's current spec (after the face editor saves). */
function faceCornerReload() {
  if (_faceCorner) { _faceCorner.face.stop(); _faceCorner.close(); _faceCorner.el?.remove(); _faceCorner = null; }
  faceCornerApply();
}

function faceCornerToggle(on) {
  try { localStorage.setItem('doca.face.corner', on ? '1' : '0'); } catch { /* a private window: this session only */ }
  faceCornerApply();
  if (typeof wakeWordApply === 'function') wakeWordApply();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', faceCornerApply);

/** Settings → General → Appearance: the switch for this screen, and the full-screen page. */
function faceSettingsRender() {
  const status = document.getElementById('theme-status');
  if (!status || document.getElementById('face-settings')) return;
  const row = document.createElement('div');
  row.id = 'face-settings';
  row.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;font-size:12px';
  row.innerHTML = `<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" ${faceCornerOn() ? 'checked' : ''}
      onchange="faceCornerToggle(this.checked)"> The face in the corner, on this screen</label>
    <a href="/face" target="_blank" rel="noopener">Open the face full screen ↗</a>
    <span style="color:var(--muted)">Dots that gather into a face when the hive is listening, thinking, working or asking you.</span>`;
  status.before(row);
}

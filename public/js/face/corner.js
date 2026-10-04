/* The face in the panel's corner (TODO H8.1): in place of the ⬡ on the chat button, for screens that switch it
   on (Settings → General → Appearance; per screen, kept in this browser). The button still opens the chat. */
let _faceCorner = null;

function faceCornerOn() { try { return localStorage.getItem('doca.face.corner') === '1'; } catch { return false; } }

function faceCornerApply() {
  const fab = document.getElementById('chat-fab');
  if (!fab) return;
  if (!faceCornerOn()) {
    if (_faceCorner) { _faceCorner.face.stop(); _faceCorner.close(); _faceCorner = null; }
    fab.classList.remove('chat-fab-face');
    if (!fab.textContent.trim()) fab.textContent = '⬡';
    return;
  }
  if (_faceCorner) return;
  fab.textContent = '';
  fab.classList.add('chat-fab-face');
  const canvas = document.createElement('canvas');
  fab.appendChild(canvas);
  let spec = {};
  try { spec = JSON.parse(localStorage.getItem('doca.face.spec') || '{}'); } catch { /* the default */ }
  const face = faceMount(canvas, { ...spec, dots: 90, hud: false, grain: false });
  _faceCorner = { face, close: faceFeed(s => face.set(s.state, s.detail)) };
}

function faceCornerToggle(on) {
  try { localStorage.setItem('doca.face.corner', on ? '1' : '0'); } catch { /* a private window: this session only */ }
  faceCornerApply();
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

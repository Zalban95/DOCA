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

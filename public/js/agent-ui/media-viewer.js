/* ═══════════════════════════════════════════════════════
   Opening a picture, a video or a sound — in the chats, the Files tab and the
   previews — in the page, full screen, instead of navigating away from it
   (asked 2026-10-04). On the phone a tapped image used to open as a page of
   its own: no zoom, and Back reloaded the panel instead of closing the image.

   - Pinch to zoom, drag to pan, double-tap to zoom in and out (and the wheel
     on a desktop). Video and sound get their players.
   - Back closes it: opening adds a history entry, so the phone's Back button —
     and a browser's — closes the viewer and stays on the page. The document
     and plan windows use the same guard (overlayBack).
   - Download and open-in-a-tab buttons are there for when that is what you meant.
   ═══════════════════════════════════════════════════════ */

/**
 * Make an overlay close on Back. Pushes one history entry; Back pops it and
 * calls `close`. Returns `release(fromBack)`: call it when the overlay closes
 * any other way, and the entry is taken back off so the history stays clean.
 */
function overlayBack(close) {
  const tag = `ov${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let done = false;
  try { history.pushState({ ...(history.state || {}), overlay: tag }, ''); } catch { return () => {}; }
  const onPop = () => { if (done) return; done = true; window.removeEventListener('popstate', onPop); close(); };
  window.addEventListener('popstate', onPop);
  return () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', onPop);
    if (history.state?.overlay === tag) history.back();
  };
}

let _mediaViewer = null;

/** @param {{ src: string, kind?: 'image'|'video'|'audio', name?: string, download?: string }} m */
function mediaViewerOpen(m) {
  mediaViewerClose();
  const kind = m.kind || 'image';
  const ov = document.createElement('div');
  ov.className = 'media-viewer';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', m.name || 'Media');
  const bar = document.createElement('div');
  bar.className = 'media-viewer-bar';
  const title = Object.assign(document.createElement('span'), { className: 'media-viewer-title', textContent: m.name || '' });
  const btn = (text, label, fn) => Object.assign(document.createElement('button'), { className: 'media-viewer-btn', textContent: text, title: label, ariaLabel: label, onclick: fn });
  const stage = document.createElement('div');
  stage.className = 'media-viewer-stage';
  let el;
  if (kind === 'video' || kind === 'audio') {
    el = Object.assign(document.createElement(kind), { src: m.src, controls: true, autoplay: kind === 'video', preload: 'metadata' });
  } else {
    el = Object.assign(document.createElement('img'), { src: m.src, alt: m.name || '', draggable: false });
    _mediaZoom(stage, el);
  }
  stage.appendChild(el);
  const actions = document.createElement('span');
  if (m.download) actions.appendChild(Object.assign(document.createElement('a'), { className: 'media-viewer-btn', href: m.download, textContent: '⬇', title: 'Download', download: m.name || '' }));
  actions.appendChild(Object.assign(document.createElement('a'), { className: 'media-viewer-btn', href: m.src, target: '_blank', rel: 'noopener', textContent: '↗', title: 'Open in a new tab' }));
  actions.appendChild(btn('✕', 'Close', () => mediaViewerClose()));
  bar.append(title, actions);
  ov.append(bar, stage);
  document.body.appendChild(ov);
  const release = overlayBack(() => mediaViewerClose(true));
  const onKey = e => { if (e.key === 'Escape') mediaViewerClose(); };
  document.addEventListener('keydown', onKey);
  _mediaViewer = { ov, release, onKey };
}

/** Close the viewer; `fromBack` when Back already popped its history entry. */
function mediaViewerClose(fromBack = false) {
  if (!_mediaViewer) return;
  const { ov, release, onKey } = _mediaViewer;
  _mediaViewer = null;
  ov.querySelectorAll('video,audio').forEach(v => { try { v.pause(); } catch {} });
  document.removeEventListener('keydown', onKey);
  ov.remove();
  if (!fromBack) release();
}

/** Pinch, drag, double-tap and wheel zoom on one image, by CSS transform. */
function _mediaZoom(stage, img) {
  let scale = 1, x = 0, y = 0, lastTap = 0;
  const pts = new Map();
  let start = null;
  const apply = () => {
    if (scale <= 1) { scale = 1; x = 0; y = 0; }
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    stage.classList.toggle('zoomed', scale > 1);
  };
  const zoomAt = (s, cx, cy) => {
    const r = stage.getBoundingClientRect();
    const ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2;
    const next = Math.min(8, Math.max(1, s));
    x = ox - (ox - x) * (next / scale); y = oy - (oy - y) * (next / scale);
    scale = next; apply();
  };
  stage.style.touchAction = 'none';
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300) { zoomAt(scale > 1 ? 1 : 2.5, e.clientX, e.clientY); lastTap = 0; return; }
      lastTap = now;
    }
    const [a, b] = [...pts.values()];
    start = { scale, x, y, px: e.clientX, py: e.clientY, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, mid: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null };
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pts.values()];
    if (b && start.dist) {
      const s = start.scale * Math.hypot(a.x - b.x, a.y - b.y) / start.dist;
      scale = start.scale; x = start.x; y = start.y;
      zoomAt(s, start.mid.x, start.mid.y);
    } else if (scale > 1) {
      x = start.x + (e.clientX - start.px); y = start.y + (e.clientY - start.py); apply();
    }
  });
  const end = e => { pts.delete(e.pointerId); start = pts.size ? { scale, x, y, px: [...pts.values()][0].x, py: [...pts.values()][0].y, dist: 0 } : null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
}

// Its styles travel with it (index.html and components.css are at their line ceilings).
if (typeof document !== 'undefined' && typeof document.createElement === 'function' && document.head) {
  const css = document.createElement('style');
  css.textContent = `
.media-viewer { position: fixed; inset: 0; z-index: 10000; background: #000; display: flex; flex-direction: column; }
.media-viewer-bar { display: flex; align-items: center; gap: 8px; padding: max(8px, env(safe-area-inset-top)) 12px 8px; color: #ddd; }
.media-viewer-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.media-viewer-btn { background: rgba(255,255,255,.1); color: #fff; border: 0; border-radius: 6px; min-width: 40px; height: 40px; margin-left: 6px;
  font-size: 18px; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; cursor: pointer; }
.media-viewer-stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding-bottom: env(safe-area-inset-bottom); }
.media-viewer-stage img { max-width: 100%; max-height: 100%; transform-origin: center; user-select: none; -webkit-user-drag: none; transition: transform .05s; }
.media-viewer-stage.zoomed img { cursor: grab; }
.media-viewer-stage video { max-width: 100%; max-height: 100%; }
.media-viewer-stage audio { width: min(560px, 92vw); }
.agent-media-expand { margin-top: 4px; }`;
  document.head.appendChild(css);
}

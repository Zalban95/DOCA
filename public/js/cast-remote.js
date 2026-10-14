/* A cast screen answers a remote (asked 2026-10-14: "nothing on screen about the remote, just respond to the real
   one"): on the cast screen (body.cast-view, solo.js) a press — the TV's own remote when its keys reach the page, or
   a key sent through the hub (POST /api/cast/remote, modules/cast/remote.js: for a device's own remote later) — moves a
   large focus outline to the nearest thing in that direction and OK presses it; Back answers an open question with its
   own "Not now" or ✕. With nothing further that way, the page scrolls.
   A cast screen never stops on a question it cannot answer: lib/switch-ask.js only notes it there (castRemoteNote). */

const CR_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Escape: 'back', Backspace: 'back', GoBack: 'back', BrowserBack: 'back' };
const CR_SEL = 'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"]),[onclick]';

/* ── On the cast screen ── */

const _crVisible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]'); };

/** What can be reached: inside the open question when there is one, else the page. */
function _crScope() {
  const open = [...document.querySelectorAll('.app-confirm-backdrop.open, .model3d-full, [role="dialog"]')].filter(_crVisible);
  return open.at(-1) || document.querySelector('main.content') || document.body;
}

function _crMove(dir) {
  const els = [...(_crScope()).querySelectorAll(CR_SEL)].filter(_crVisible);
  if (!els.length) return _crScroll(dir);
  const cur = els.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) return _crFocus(els[0]);
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of els) {
    if (el === cur || cur.contains(el) || el.contains(cur)) continue;
    const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const main = { up: ay - by, down: by - ay, left: ax - bx, right: bx - ax }[dir];
    if (main <= 4) continue;
    const side = dir === 'up' || dir === 'down' ? Math.abs(bx - ax) : Math.abs(by - ay);
    const score = main + side * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) _crFocus(best); else _crScroll(dir);
}

function _crFocus(el) {
  if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.tabIndex = 0;   // a tile drawn with onclick only
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function _crScroll(dir) {
  const y = { up: -0.6, down: 0.6 }[dir] || 0, x = { left: -0.6, right: 0.6 }[dir] || 0;
  const box = document.querySelector('main.content') || document.scrollingElement;
  box.scrollBy({ top: y * innerHeight, left: x * innerWidth, behavior: 'smooth' });
}

function _crBack() {
  const scope = _crScope();
  if (scope === document.querySelector('main.content') || scope === document.body) return;
  const btn = [...scope.querySelectorAll('button')].filter(_crVisible).find(b => /^(not now|close|cancel|✕|no)$/i.test(b.textContent.trim()));
  if (btn) return btn.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function castRemotePress(key) {
  if (key === 'ok') return document.activeElement && document.activeElement !== document.body ? document.activeElement.click() : _crMove('down');
  if (key === 'back') return _crBack();
  return _crMove(key);
}

/** A question a cast screen cannot answer: a line at its foot that goes by itself, never a dialog in the way. */
function castRemoteNote(text) {
  let n = document.getElementById('cast-view-note');
  if (!n) { n = Object.assign(document.createElement('div'), { id: 'cast-view-note', className: 'cast-view-note' }); document.body.append(n); }
  n.textContent = text;
  clearTimeout(n._t); n._t = setTimeout(() => n.remove(), 12000);
}

const castViewOn = () => typeof document !== 'undefined' && document.body?.classList.contains('cast-view');

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    if (typeof liveOn === 'function') liveOn('screen', c => { if (c.what === 'key' && castViewOn()) castRemotePress(c.key); });
    // The TV's own remote, when its keys reach the page: Enter on a native control presses it already.
    document.addEventListener('keydown', e => {
      if (!castViewOn()) return;
      const key = CR_KEYS[e.key] || (e.keyCode === 461 ? 'back' : null);   // 461: Back on some TVs
      if (!key || (key === 'ok' && document.activeElement?.matches('button,a[href],input,select,textarea'))) return;
      if (key === 'back' && e.key === 'Backspace' && /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
      e.preventDefault();
      castRemotePress(key);
    });
  });
}

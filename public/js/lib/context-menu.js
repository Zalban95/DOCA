/* ═══════════════════════════════════════════════════════
   One context menu for the file trees and lists (asked 2026-10-12: "a right click for the major functions to the file
   navigation, that is also used in projects"). Right-click on a desk, a long press on a touch screen, or the keyboard
   (the context-menu key, Shift+F10) opens it; arrows move, Enter chooses, Escape or Tab closes and gives the focus
   back. One menu at a time. On a phone it is a sheet at the bottom, full width.

   ctxMenuOpen(x, y, items, { title, opener })   items: [{ label, icon, fn, danger, hint } | { sep: true } | null]
   ctxMenuClose()
   ctxMenuKey(ev)                                 true for the context-menu key and Shift+F10
   ctxLongPress(el, onPress)                      the touch screen's right-click, on one element or by delegation
   fileMenuItems(o)                               the file actions, in one order, from the page's own functions:
     o = { abs, isDir, api, open, rename, duplicate, newFile, newFolder, upload, remove, extra }
   ═══════════════════════════════════════════════════════ */

let _ctxOpener = null;

function ctxMenuClose(giveBack = false) {
  const menu = document.getElementById('fm-ctx-menu');
  if (!menu) return;
  menu.remove();
  document.getElementById('ctx-menu-shade')?.remove();
  document.removeEventListener('pointerdown', _ctxOutside, true);
  window.removeEventListener('resize', _ctxResize);
  if (giveBack && _ctxOpener?.isConnected) { try { _ctxOpener.focus({ preventScroll: true }); } catch { /* gone */ } }
  _ctxOpener = null;
}

function _ctxOutside(ev) { if (!ev.target.closest?.('#fm-ctx-menu')) ctxMenuClose(); }
function _ctxResize() { ctxMenuClose(); }

function ctxMenuKey(ev) { return ev.key === 'ContextMenu' || (!!ev.shiftKey && ev.key === 'F10'); }

function ctxMenuOpen(x, y, items, opts = {}) {
  ctxMenuClose();
  _ctxOpener = opts.opener || document.activeElement;
  const list = [];
  for (const it of (items || []).filter(Boolean)) if (!it.sep || (list.length && !list[list.length - 1].sep)) list.push(it);
  while (list.length && list[list.length - 1].sep) list.pop();
  const sheet = window.matchMedia?.('(max-width: 600px)').matches;
  const menu = document.createElement('div');
  menu.id = 'fm-ctx-menu';
  menu.className = `ctx-menu${sheet ? ' ctx-sheet' : ''}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', opts.title || 'Actions');
  if (opts.title) {
    const head = document.createElement('div');
    head.className = 'ctx-title';
    head.textContent = opts.title;
    menu.appendChild(head);
  }
  for (let it of list) {
    if (it.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; s.setAttribute('role', 'separator'); menu.appendChild(s); continue; }
    // A host's own entry written as "⇄ Compare…" gets its symbol in the icon column, like the rest.
    const split = !it.icon && /^([^\p{L}\p{N}\s]{1,3})\s+(.+)$/u.exec(it.label || '');
    if (split) it = { ...it, icon: split[1], label: split[2] };
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ctx-item${it.danger ? ' danger' : ''}`;
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    b.innerHTML = `<span class="ctx-icon" aria-hidden="true">${escHtml(it.icon || '')}</span><span class="ctx-label"></span>${it.hint ? `<span class="ctx-hint">${escHtml(it.hint)}</span>` : ''}`;
    b.querySelector('.ctx-label').textContent = it.label;
    b.onclick = () => { ctxMenuClose(true); it.fn?.(); };
    menu.appendChild(b);
  }
  if (sheet) {
    const shade = Object.assign(document.createElement('div'), { id: 'ctx-menu-shade', className: 'ctx-shade' });
    shade.onclick = () => ctxMenuClose(true);
    document.body.appendChild(shade);
  }
  document.body.appendChild(menu);
  if (!sheet) {
    const r = menu.getBoundingClientRect(), m = 8;
    menu.style.left = `${Math.max(m, Math.min(x, innerWidth - r.width - m))}px`;
    menu.style.top = `${Math.max(m, Math.min(y, innerHeight - r.height - m))}px`;
  }
  const buttons = () => [...menu.querySelectorAll('.ctx-item')];
  menu.onkeydown = ev => {
    const all = buttons(), i = all.indexOf(document.activeElement);
    const go = n => { ev.preventDefault(); all[(n + all.length) % all.length]?.focus(); };
    if (ev.key === 'ArrowDown') go(i + 1);
    else if (ev.key === 'ArrowUp') go(i < 0 ? all.length - 1 : i - 1);
    else if (ev.key === 'Home') go(0);
    else if (ev.key === 'End') go(all.length - 1);
    else if (ev.key === 'Escape' || ev.key === 'Tab' || ctxMenuKey(ev)) { ev.preventDefault(); ev.stopPropagation(); ctxMenuClose(true); }
  };
  buttons()[0]?.focus({ preventScroll: true });
  // Later than this event: the click (or touch end) that opened it must not close it.
  setTimeout(() => { document.addEventListener('pointerdown', _ctxOutside, true); window.addEventListener('resize', _ctxResize); }, 0);
  return menu;
}

/** A long press (550 ms, the finger still) is the touch screen's right-click. `pick(ev)` → element or null, for delegation. */
function ctxLongPress(el, onPress, pick = () => el) {
  let timer = null, start = null;
  el.addEventListener('touchstart', ev => {
    const t = ev.touches[0], target = pick(ev);
    if (!target || ev.touches.length > 1) return;
    start = { x: t.clientX, y: t.clientY };
    timer = setTimeout(() => { timer = null; onPress(target, start.x, start.y); }, 550);
  }, { passive: true });
  el.addEventListener('touchmove', ev => {
    const t = ev.touches[0];
    if (timer && start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) { clearTimeout(timer); timer = null; }
  }, { passive: true });
  for (const n of ['touchend', 'touchcancel']) el.addEventListener(n, () => { clearTimeout(timer); timer = null; }, { passive: true });
}

/** Where a menu opened from the keyboard goes: under the element it is for. */
function ctxMenuAt(el) {
  const r = el?.getBoundingClientRect?.();
  return r ? [r.left + Math.min(24, r.width / 2), r.bottom] : [innerWidth / 2, innerHeight / 3];
}

/** The chat, with a line about this path in the box — the person's to finish, never sent by itself. */
function ctxAskAgent(abs, isDir) {
  if (typeof chatOpen !== 'undefined' && !chatOpen && typeof toggleChat === 'function') toggleChat();
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.value = `About the ${isDir ? 'folder' : 'file'} ${abs}: `;
  input.focus();
  input.setSelectionRange?.(input.value.length, input.value.length);
}

/** The Files page, open at this path's folder (from Projects). */
async function ctxShowInFiles(abs, isDir) {
  const dir = isDir ? abs : (abs.slice(0, abs.lastIndexOf('/')) || '/');
  if (typeof FM_MACHINE !== 'undefined' && FM_MACHINE && typeof fmUseMachine === 'function') await fmUseMachine(null);
  nav('files');
  for (let i = 0; i < 40 && !document.getElementById('fm-bookmarks-list')?.children.length; i++) await new Promise(r => setTimeout(r, 75));
  fmNavigate(dir);
}

/** The file actions, one order everywhere. Each entry is there only when the page gave the function behind it. */
function fileMenuItems(o) {
  const { abs, isDir, api = '/api/files' } = o;
  const name = abs.split(/[\\/]/).pop() || abs;
  const dir = isDir ? abs : (abs.slice(0, abs.lastIndexOf('/')) || '/');
  const media = !isDir && typeof fmMediaType === 'function' ? fmMediaType(name) : null;
  const raw = `${api}/raw?path=${encodeURIComponent(abs)}`;
  const download = () => {
    const a = document.createElement('a');
    a.download = name;
    a.href = `${api}/download/${encodeURIComponent(name)}?path=${encodeURIComponent(abs)}`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const copyPath = () => (navigator.clipboard?.writeText(abs) || Promise.reject()).then(() => typeof undoToast === 'function' && undoToast('Path copied', null, { ms: 2500 })).catch(() => appAlert(abs));
  return [
    o.open && { icon: isDir ? '→' : '✏', label: 'Open', fn: () => o.open(abs) },
    media && typeof mediaViewerOpen === 'function' && { icon: '👁', label: 'Preview', fn: () => mediaViewerOpen({ src: raw, kind: media, name, download: `${api}/download/${encodeURIComponent(name)}?path=${encodeURIComponent(abs)}` }) },
    !isDir && { icon: '↗', label: 'Open in a new tab', fn: () => window.open(raw, '_blank', 'noopener') },
    { sep: true },
    o.rename && { icon: '↩', label: 'Rename', hint: 'F2', fn: () => o.rename(abs) },
    o.duplicate && { icon: '⧉', label: 'Duplicate', fn: () => o.duplicate(abs) },
    !isDir && { icon: '⬇', label: 'Download', fn: download },
    { icon: '⎘', label: 'Copy path', fn: copyPath },
    { sep: true },
    o.newFile && { icon: '+', label: isDir ? 'New file here' : 'New file beside it', fn: () => o.newFile(dir) },
    o.newFolder && { icon: '+', label: isDir ? 'New folder here' : 'New folder beside it', fn: () => o.newFolder(dir) },
    o.upload && { icon: '⬆', label: isDir ? 'Upload here' : 'Upload beside it', fn: () => o.upload(dir) },
    { sep: true },
    ...(o.extra || []),
    api === '/api/files' && typeof currentTab !== 'undefined' && currentTab !== 'files' && typeof fmNavigate === 'function'
      && { icon: '📁', label: 'Show in Files', fn: () => ctxShowInFiles(abs, isDir) },
    { icon: '✨', label: 'Ask the agent about this', fn: () => ctxAskAgent(abs, isDir) },
    { sep: true },
    o.remove && { icon: '✕', label: 'Delete', hint: 'Del', danger: true, fn: () => o.remove(abs, isDir) },
  ];
}

/* The old name, kept for the callers that build their own list. */
function showContextModal(x, y, actions) { return ctxMenuOpen(x, y, actions); }
function removeContextModal() { ctxMenuClose(); }

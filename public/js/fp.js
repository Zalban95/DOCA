/* ═══════════════════════════════════════════════════════
   DOCA PANEL — CHOOSING A PATH FROM A TREE
   Asked 2026-10-10: "When opening any path, let's open a tree, not just typing the address." One picker for every
   field that takes a path: the folders the Files tab may open (/api/files/roots), each opened a level at a time as it
   is expanded (/api/files/list), the path it chose written into the field — which stays typeable beside it.
     fpOpen('input-id', 'dir' | 'file')           fill a field
     fpPick({ mode, start, title }) → Promise     the chosen path, or null (a field-less question: "+ Open folder")
     <input data-path-pick="dir|file">            gets its 📁 button by itself (pathPickEnhance)
   The same rule as the Files tab: browsing this machine's disk is a host's; anyone else is told to type the path.
   Keys: ↑ ↓ move, → opens, ← closes or goes up, Enter chooses.
   ═══════════════════════════════════════════════════════ */

const FP = { target: null, mode: 'dir', selected: '', resolve: null, open: new Set(), kids: new Map() };

const _fpSep = p => (/^[A-Za-z]:\\/.test(p) || (p.includes('\\') && !p.includes('/')) ? '\\' : '/');
const _fpJoin = (dir, name) => { const s = _fpSep(dir); return dir.endsWith(s) ? dir + name : dir + s + name; };
const _fpParent = p => { const s = _fpSep(p); const i = p.replace(/[\\/]+$/, '').lastIndexOf(s); return i <= 0 ? (s === '/' ? '/' : p) : p.slice(0, i) + (i <= 2 && s === '\\' ? s : ''); };
const _fpUnder = (p, root) => p === root || p.startsWith(root.endsWith(_fpSep(root)) ? root : root + _fpSep(root));

/** Fill a field: the tree opens on what the field holds, and Select writes the chosen path back. */
function fpOpen(targetInputId, mode, { onPick } = {}) {
  const input = document.getElementById(targetInputId);
  _fpShow({ mode, start: input?.value?.trim() || input?.placeholder?.trim() || '', title: null, done: v => {
    if (!v) return;
    if (input) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
    onPick?.(v);
  } });
}

/** Ask for a path with no field behind it: resolves with the chosen path, or null when closed. */
function fpPick({ mode = 'dir', start = '', title = null } = {}) {
  return new Promise(resolve => _fpShow({ mode, start, title, done: resolve }));
}

function _fpShow({ mode, start, title, done }) {
  const modal = document.getElementById('fp-modal');
  if (!modal) return done(null);
  FP.resolve?.(null);
  Object.assign(FP, { mode: mode || 'dir', resolve: done, selected: '' });
  document.getElementById('fp-title').textContent = title || (FP.mode === 'file' ? 'Choose a file' : 'Choose a folder');
  const sel = document.getElementById('fp-selected');
  sel.value = start && !/^(\/path\/to|~\/Downloads\/ubuntu)/.test(start) ? start : '';
  sel.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fpConfirm(); } };
  modal.style.display = 'flex';
  _fpLoadRoots(sel.value);
}

/** The roots, and the way down to `want` opened (the field's path, or what it would be). */
async function _fpLoadRoots(want = '') {
  const list = document.getElementById('fp-list');
  if (!list) return;
  list.innerHTML = '<div class="placeholder pulse" style="padding:12px">Loading…</div>';
  let roots;
  try { roots = (await apiFetch('/api/files/roots')).roots || []; }
  catch (e) {
    list.innerHTML = `<div class="placeholder fp-note">${/403|right|host|admin/i.test(e.message) ? 'Browsing this machine\'s folders is an admin\'s — type the path below.' : escHtml(e.message)}</div>`;
    return;
  }
  FP.roots = roots;
  FP.open.clear();
  const root = roots.filter(r => want && _fpUnder(want, r)).sort((a, b) => b.length - a.length)[0];
  if (root) {
    // Open each folder from the root down to the one wanted (its parent when it is a file, or does not exist yet).
    const chain = [];
    for (let p = want.replace(/[\\/]+$/, '') || want; p && _fpUnder(p, root); p = _fpParent(p)) { chain.unshift(p); if (p === root || _fpParent(p) === p) break; }
    for (const p of chain) { if (await _fpKids(p) === null) break; FP.open.add(p); }
    FP.selected = want;
  }
  _fpDraw();
  list.querySelector('.fp-node.sel')?.scrollIntoView({ block: 'center' });
}

/** A folder's entries, read once per opening of the picker (null: it cannot be read). */
async function _fpKids(dir, again = false) {
  if (!again && FP.kids.has(dir)) return FP.kids.get(dir);
  let entries = null;
  try { entries = ((await apiFetch(`/api/files/list?path=${encodeURIComponent(dir)}`)).entries || [])
    .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : (a.name.startsWith('.') - b.name.startsWith('.')) || a.name.localeCompare(b.name))); }
  catch { entries = null; }
  FP.kids.set(dir, entries);
  return entries;
}

function _fpDraw() {
  const list = document.getElementById('fp-list');
  const rows = [];
  const walk = (abs, name, isDir, depth, size) => {
    const open = isDir && FP.open.has(abs);
    const pick = isDir ? FP.mode === 'dir' : FP.mode === 'file';
    rows.push(`<div class="fp-node${abs === FP.selected ? ' sel' : ''}${pick ? '' : ' fp-dim'}" role="treeitem" tabindex="-1" aria-expanded="${isDir ? open : ''}"
      data-path="${escHtml(abs)}" data-dir="${isDir ? 1 : 0}" style="padding-left:${8 + depth * 16}px">
      <span class="fp-tw">${isDir ? (open ? '▾' : '▸') : ''}</span><span class="fp-item-icon">${isDir ? (depth ? '📁' : '💾') : _fpFileIcon(name)}</span>
      <span class="fp-item-name">${escHtml(name)}</span>${size ? `<span class="fp-item-size">${_fpFmtSize(size)}</span>` : ''}</div>`);
    if (!open) return;
    const kids = FP.kids.get(abs);
    if (kids === null) rows.push(`<div class="fp-node fp-dim" style="padding-left:${24 + depth * 16}px">cannot be read</div>`);
    else if (kids && !kids.length) rows.push(`<div class="fp-node fp-dim" style="padding-left:${24 + depth * 16}px">empty</div>`);
    for (const e of kids || []) if (e.isDir || FP.mode === 'file') walk(_fpJoin(abs, e.name), e.name, e.isDir, depth + 1, e.size);
  };
  for (const r of FP.roots || []) walk(r, r, true, 0);
  list.setAttribute('role', 'tree');
  list.innerHTML = rows.join('') || '<div class="placeholder fp-note">No folders this panel may open.</div>';
  _fpCrumbs(FP.selected);
}

async function _fpToggle(abs, force) {
  const open = force ?? !FP.open.has(abs);
  if (open) { if (await _fpKids(abs) !== undefined) FP.open.add(abs); } else FP.open.delete(abs);
  _fpDraw();
  document.querySelector(`#fp-list .fp-node[data-path="${CSS.escape(abs)}"]`)?.focus();
}

function _fpSelect(abs, isDir) {
  if ((isDir && FP.mode === 'dir') || (!isDir && FP.mode === 'file')) { FP.selected = abs; document.getElementById('fp-selected').value = abs; }
  _fpDraw();
  document.querySelector(`#fp-list .fp-node[data-path="${CSS.escape(abs)}"]`)?.focus();
}

function _fpCrumbs(p) {
  const bc = document.getElementById('fp-breadcrumb');
  if (!bc) return;
  bc.textContent = p ? p : (FP.mode === 'file' ? 'Open a folder and choose a file' : 'Open folders with ▸ and choose one');
}

function fpClose() {
  const modal = document.getElementById('fp-modal');
  if (modal) modal.style.display = 'none';
  const r = FP.resolve; FP.resolve = null; FP.kids.clear();
  r?.(null);
}

function fpConfirm() {
  const val = document.getElementById('fp-selected')?.value?.trim();
  if (!val) return;
  const r = FP.resolve; FP.resolve = null;
  fpClose();
  r?.(val);
}

/* Clicks and keys on the tree: one listener for the list, set once. */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('fp-list');
  if (!list) return;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('fp-modal')?.style.display === 'flex') { e.preventDefault(); e.stopPropagation(); fpClose(); }
  }, true);
  list.addEventListener('click', e => {
    const n = e.target.closest('.fp-node[data-path]');
    if (!n) return;
    const isDir = n.dataset.dir === '1';
    if (isDir && (e.target.closest('.fp-tw') || FP.mode === 'file')) return _fpToggle(n.dataset.path);
    _fpSelect(n.dataset.path, isDir);
    if (isDir && !FP.open.has(n.dataset.path)) _fpToggle(n.dataset.path, true);
  });
  list.addEventListener('dblclick', e => {
    const n = e.target.closest('.fp-node[data-path]');
    if (n && ((n.dataset.dir === '1') === (FP.mode === 'dir'))) { _fpSelect(n.dataset.path, n.dataset.dir === '1'); fpConfirm(); }
  });
  list.addEventListener('keydown', e => {
    const nodes = [...list.querySelectorAll('.fp-node[data-path]')];
    const at = nodes.indexOf(document.activeElement);
    const n = nodes[at];
    const go = i => { e.preventDefault(); nodes[Math.max(0, Math.min(nodes.length - 1, i))]?.focus(); };
    if (e.key === 'ArrowDown') return go(at + 1);
    if (e.key === 'ArrowUp') return go(at - 1);
    if (!n) return;
    if (e.key === 'ArrowRight' && n.dataset.dir === '1') { e.preventDefault(); return _fpToggle(n.dataset.path, true); }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (n.dataset.dir === '1' && FP.open.has(n.dataset.path)) return _fpToggle(n.dataset.path, false);
      return list.querySelector(`.fp-node[data-path="${CSS.escape(_fpParent(n.dataset.path))}"]`)?.focus();
    }
    if (e.key === 'Enter') { e.preventDefault(); _fpSelect(n.dataset.path, n.dataset.dir === '1'); fpConfirm(); }
    if (e.key === ' ') { e.preventDefault(); _fpSelect(n.dataset.path, n.dataset.dir === '1'); }
  });
});

/** Every field marked data-path-pick gets a 📁 beside it, wherever it is drawn (a MutationObserver, like form help). */
function pathPickEnhance(root = document) {
  root.querySelectorAll?.('input[data-path-pick]:not([data-path-picked])').forEach(input => {
    input.dataset.pathPicked = '1';
    if (!input.id) input.id = `pp-${Math.random().toString(36).slice(2, 9)}`;
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-xs fp-browse', textContent: '📁', title: 'Choose from a tree' });
    b.setAttribute('aria-label', 'Choose from a tree');
    b.onclick = () => fpOpen(input.id, input.dataset.pathPick === 'file' ? 'file' : 'dir');
    input.after(b);
  });
}
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  pathPickEnhance();
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(pathPickEnhance, 120); }).observe(document.body, { childList: true, subtree: true });
});
function _fpFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    sh: '⚡', yml: '⚙', yaml: '⚙', json: '{}', md: '📝', txt: '📄',
    py: '🐍', js: '📜', ts: '📜', log: '📋', conf: '⚙', cfg: '⚙', env: '🔑',
    html: '🌐', css: '🎨', xml: '🌐', toml: '⚙', ini: '⚙',
    gz: '📦', tar: '📦', zip: '📦', '7z': '📦', rar: '📦', xz: '📦', bz2: '📦', zst: '📦',
    deb: '📦', rpm: '📦', pkg: '📦', appimage: '📦',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', svg: '🖼', webp: '🖼', avif: '🖼', bmp: '🖼', ico: '🖼', tiff: '🖼',
    mp4: '🎬', webm: '🎬', mkv: '🎬', mov: '🎬', avi: '🎬', m4v: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵', opus: '🎵', m4a: '🎵',
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙', csv: '📊',
    gguf: '🧠', bin: '⬛', safetensors: '🧠', onnx: '🧠', pt: '🧠', pth: '🧠',
    stl: '🧊', obj: '🧊', step: '🧊', stp: '🧊', gcode: '🧊',
    iso: '💿', img: '💿', dmg: '💿',
    db: '🗄', sqlite: '🗄', sql: '🗄',
    bak: '♻', tmp: '♻', swp: '♻',
    so: '⬛', dll: '⬛', exe: '⬛', o: '⬛', a: '⬛',
    c: '📜', cpp: '📜', h: '📜', hpp: '📜', rs: '📜', go: '📜', java: '📜', rb: '📜', lua: '📜',
  };
  return map[ext] || '📄';
}

function _fpFmtSize(bytes) {
  if (!bytes) return '';
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes > 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes + ' B';
}

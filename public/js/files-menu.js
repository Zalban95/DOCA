/* ═══════════════════════════════════════════════════════
   The Files list's context menu: the shared file menu (lib/context-menu.js) with
   the list's own copy, cut, paste and star. Right-click a row (or the empty list,
   for the folder itself), long-press on a touch screen, or press the context-menu
   key / Shift+F10 for the selected row.
   ═══════════════════════════════════════════════════════ */

function _fmJoin(dir, name) { return dir === '/' ? `/${name}` : `${dir}/${name}`; }

function _fmMenuNew(dir, folder) {
  appPrompt(folder ? `New folder in ${dir}:` : `New file in ${dir}:`, async name => {
    const abs = _fmJoin(dir, name.replace(/^\/+/, ''));
    try {
      await apiFetch(`${fmApi()}/${folder ? 'mkdir' : 'write'}`, { method: 'POST', body: folder ? { path: abs } : { path: abs, content: '' } });
      fmRefresh(); fm.tree?.refresh();
      if (!folder) fmOpenEditor(abs);
    } catch (e) { appAlert(e.message); }
  });
}

function _fmMenuUpload(dir) {
  if (dir === fm.cwd) return fmUploadClick();
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
  input.onchange = async () => {
    const form = new FormData();
    form.append('dest', dir);
    for (const f of input.files) form.append('files', f);
    try {
      const r = await fetch(`${fmApi()}/upload`, { method: 'POST', body: form });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      fmRefresh(); fm.tree?.refresh();
    } catch (e) { appAlert(`Upload failed: ${e.message}`); }
  };
  input.click();
}

async function _fmMenuDuplicate(abs) {
  try {
    await apiFetch(`${fmApi()}/paste`, { method: 'POST', body: { op: 'copy', paths: [abs], dest: abs.slice(0, abs.lastIndexOf('/')) || '/' } });
    fmRefresh();
  } catch (e) { appAlert(`Could not duplicate it: ${e.message}`); }
}

/** The menu for a row (or, with no row, for the folder shown). */
function fmContextMenu(event, path, isDir, at) {
  event?.preventDefault?.();
  const folder = path === fm.cwd;
  if (!folder && !fm.selected.has(path)) { fm.selected = new Set([path]); fmSyncSelectionUI(); fmUpdateStatus(); }
  const starred = fm.favorites.includes(path);
  const items = fileMenuItems({
    abs: path, isDir, api: fmApi(),
    open: p => (isDir ? fmNavigate(p) : fmDblClick(p, false)),
    rename: folder ? null : p => fmRenameInline(p, p.split('/').pop()),
    duplicate: folder ? null : _fmMenuDuplicate,
    newFile: d => _fmMenuNew(d, false), newFolder: d => _fmMenuNew(d, true), upload: _fmMenuUpload,
    remove: folder ? null : (p, d) => fmDelete(p, d),
    extra: [
      !folder && { icon: '⧉', label: fm.selected.size > 1 ? `Copy ${fm.selected.size} items` : 'Copy', hint: 'Ctrl+C', fn: fmCopy },
      !folder && { icon: '✂', label: fm.selected.size > 1 ? `Cut ${fm.selected.size} items` : 'Cut', hint: 'Ctrl+X', fn: fmCut },
      fm.clipboard && isDir && { icon: '📋', label: `Paste ${fm.clipboard.paths.length} here`, hint: folder ? 'Ctrl+V' : '', fn: async () => { if (!folder) await fmNavigate(path); fmPaste(); } },
      !FM_MACHINE && { icon: starred ? '★' : '☆', label: starred ? 'Unstar' : 'Star', fn: () => fmStarToggle(path) },
    ],
  });
  const [x, y] = at || [event.clientX, event.clientY];
  ctxMenuOpen(x, y, items, { title: folder ? `This folder — ${path}` : path.split('/').pop(), opener: document.getElementById('fm-list-inner') });
}

/* The empty part of the list is the folder; a long press is the right-click; the keyboard's menu key opens the selection's. */
(function fmMenuWire() {
  const wire = () => {
    const list = document.getElementById('fm-list-inner');
    if (!list || list._ctxWired) return;
    list._ctxWired = true;
    if (!list.hasAttribute('tabindex')) list.tabIndex = -1;
    list.addEventListener('contextmenu', ev => { if (!ev.target.closest('.fm-row')) fmContextMenu(ev, fm.cwd, true); });
    ctxLongPress(list, (row, x, y) => {
      if (row === list) return fmContextMenu(null, fm.cwd, true, [x, y]);
      fmContextMenu(null, row.dataset.path, row.dataset.isdir === 'true', [x, y]);
    }, ev => ev.target.closest('.fm-row') || list);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  document.addEventListener('keydown', ev => {
    if (!ctxMenuKey(ev) || typeof pageShown !== 'function' || !pageShown('files')) return;
    if (ev.target.closest?.('input, textarea, .pj-tree, #fm-ctx-menu, [contenteditable="true"]')) return;
    ev.preventDefault();
    const path = [...fm.selected].pop();
    const row = path && [...document.querySelectorAll('#fm-list-inner .fm-row')].find(r => r.dataset.path === path);
    if (row) fmContextMenu(null, path, row.dataset.isdir === 'true', ctxMenuAt(row.querySelector('.fm-name') || row));
    else fmContextMenu(null, fm.cwd, true, ctxMenuAt(document.getElementById('fm-list-inner')));
  });
})();

/* ═══════════════════════════════════════════════════════
   A folder tree over /api/files, shared by the Files tab (its sidebar) and the
   Projects tab (its Files view) — one implementation, so what one learns the
   other has.

   fileTree(container, { root, onOpen, onOpenDir, extraMenu, dim })
     root        the folder at the top
     onOpen(abs) a file was chosen
     onOpenDir   a folder was chosen (optional; it also opens in the tree)
     extraMenu   (abs, isDir) => [{ label, fn }] — the host's own entries
   → { refresh(), collapse(), root, selected }

   Right-click, long-press or Shift+F10: the shared file menu (lib/context-menu.js) —
   open, preview, rename (F2), duplicate, download, copy path, new file / folder,
   upload here, delete (Del), show in Files, ask the agent. Drag a node onto a folder to move it; drop
   files from the computer onto a folder to upload them there. Also here: the
   Files tab's file-type helpers, used by both.
   ═══════════════════════════════════════════════════════ */

const FT_DIM = new Set(['.git', 'node_modules', 'build', 'dist', '.gradle', 'target', '.idea', '.dart_tool', '__pycache__', '.next', 'out', '.venv']);

function fileTree(container, opts = {}) {
  const api = opts.api || '/api/files';   // a paired device's files: /api/devices/<id>/files (device-files.js)
  const t = { root: String(opts.root || '/').replace(/\/+$/, '') || '/', open: new Set(), selected: null, opts };
  const join = (dir, name) => (dir === '/' ? `/${name}` : `${dir}/${name}`);
  const parent = abs => abs.slice(0, abs.lastIndexOf('/')) || '/';
  const upload = document.createElement('input');
  Object.assign(upload, { type: 'file', multiple: true });
  upload.style.display = 'none';

  // One row of monochrome icon buttons (des 27): it used to wrap a lone ⬆ onto a second line.
  const ib = (act, icon, title) => `<button type="button" class="icon-btn" data-act="${act}" title="${title}" aria-label="${title}">${typeof uiIcon === 'function' ? uiIcon(icon, 15) : title}</button>`;
  container.innerHTML = `<div class="pj-tree-tools">
      ${ib('refresh', 'refresh', 'Refresh')}${ib('collapse', 'collapse', 'Collapse all')}${ib('file', 'file', 'New file in the selected folder')}${ib('folder', 'folder', 'New folder in the selected folder')}${ib('upload', 'upload', 'Upload into the selected folder')}
    </div><div class="pj-tree" tabindex="0"></div>`;
  container.appendChild(upload);
  const tree = container.querySelector('.pj-tree');
  const here = () => (t.selected ? (t.selectedDir ? t.selected : parent(t.selected)) : t.root);

  const act = {
    refresh: () => level(tree, t.root, 0),
    collapse: () => { t.open.clear(); level(tree, t.root, 0); },
    file: (dir = here()) => appPrompt(`New file in ${dir}:`, async name => {
      const abs = join(dir, name.replace(/^\/+/, ''));
      try { await apiFetch(`${api}/write`, { method: 'POST', body: { path: abs, content: '' } }); t.open.add(dir); act.refresh(); opts.onOpen?.(abs); }
      catch (e) { appAlert(e.message); }
    }),
    folder: (dir = here()) => appPrompt(`New folder in ${dir}:`, async name => {
      try { await apiFetch(`${api}/mkdir`, { method: 'POST', body: { path: join(dir, name.replace(/^\/+/, '')) } }); t.open.add(dir); act.refresh(); }
      catch (e) { appAlert(e.message); }
    }),
    upload: (dir = here()) => { upload.dataset.dest = dir; upload.click(); },
    rename: abs => appPrompt(`Rename ${abs.split('/').pop()} to:`, async name => {
      try { await apiFetch(`${api}/rename`, { method: 'POST', body: { from: abs, to: join(parent(abs), name) } }); act.refresh(); }
      catch (e) { appAlert(e.message); }
    }, abs.split('/').pop()),
    remove: (abs, isDir) => appConfirm(`Delete ${abs}${isDir ? ' and everything in it' : ''}?`, async () => {
      try { await apiFetch(`${api}/delete`, { method: 'POST', body: { paths: [abs] } }); if (t.selected === abs) t.selected = null; act.refresh(); }
      catch (e) { appAlert(e.message); }
    }),
    duplicate: async abs => {
      try { await apiFetch(`${api}/paste`, { method: 'POST', body: { op: 'copy', paths: [abs], dest: parent(abs) } }); act.refresh(); }
      catch (e) { appAlert(`Could not duplicate it: ${e.message}`); }
    },
    move: async (from, dir) => {
      if (from === dir || dir.startsWith(`${from}/`) || parent(from) === dir) return;
      try { await apiFetch(`${api}/paste`, { method: 'POST', body: { op: 'cut', paths: [from], dest: dir } }); t.open.add(dir); act.refresh(); }
      catch (e) { appAlert(`Could not move it: ${e.message}`); }
    },
    send: async (files, dir) => {
      const form = new FormData();
      form.append('dest', dir);
      for (const f of files) form.append('files', f);
      try {
        const r = await fetch(`${api}/upload`, { method: 'POST', body: form });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        t.open.add(dir); act.refresh();
      } catch (e) { appAlert(`Upload failed: ${e.message}`); }
    },
  };
  upload.onchange = () => { if (upload.files.length) act.send([...upload.files], upload.dataset.dest || t.root); upload.value = ''; };
  container.querySelector('.pj-tree-tools').onclick = e => { const a = e.target.closest('[data-act]')?.dataset.act; if (a) act[a](); };

  // The shared file menu (lib/context-menu.js), with the host's own entries in it.
  function menu(x, y, abs, isDir, opener, row) {
    const openDir = () => { if (row?.isConnected && !t.open.has(abs)) row.click(); else opts.onOpenDir?.(abs); };
    ctxMenuOpen(x, y, fileMenuItems({ abs, isDir, api, open: isDir ? openDir : opts.onOpen, rename: act.rename,
      duplicate: act.duplicate, newFile: act.file, newFolder: act.folder, upload: act.upload, remove: act.remove,
      extra: opts.extraMenu?.(abs, isDir) || [] }), { title: abs.split('/').pop() || abs, opener: opener || tree });
  }

  function select(row, abs, isDir) {
    t.selected = abs; t.selectedDir = isDir;
    tree.querySelectorAll('.pj-node.selected').forEach(n => n.classList.remove('selected'));
    row.classList.add('selected');
  }

  async function level(box, dir, depth) {
    t.watched?.();
    let entries = [];
    try { entries = (await apiFetch(`${api}/list?path=${encodeURIComponent(dir)}`)).entries || []; }
    catch (e) { box.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
    entries.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    box.innerHTML = '';
    for (const e of entries) {
      const abs = join(dir, e.name);
      const row = document.createElement('div');
      const kids = document.createElement('div');
      const label = () => `${e.isDir ? (t.open.has(abs) ? '▾ ' : '▸ ') : `${fmFileIcon(e.name)} `}${e.name}`;
      row.className = `pj-node${e.isDir ? ' dir' : ''}${(opts.dim || FT_DIM).has(e.name) ? ' dim' : ''}${t.selected === abs ? ' selected' : ''}`;
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.title = abs;
      row.textContent = label();
      row.draggable = true;
      row.onclick = () => {
        select(row, abs, e.isDir);
        if (!e.isDir) return opts.onOpen?.(abs);
        if (t.open.has(abs)) { t.open.delete(abs); kids.innerHTML = ''; } else { t.open.add(abs); level(kids, abs, depth + 1); }
        row.textContent = label();
        opts.onOpenDir?.(abs);
      };
      row.oncontextmenu = ev => { ev.preventDefault(); select(row, abs, e.isDir); menu(ev.clientX, ev.clientY, abs, e.isDir, tree, row); };
      ctxLongPress(row, (_, x, y) => { select(row, abs, e.isDir); menu(x, y, abs, e.isDir, tree, row); });   // the touch screen's right-click
      row.ondragstart = ev => { ev.dataTransfer.setData('text/x-doca-path', abs); ev.dataTransfer.effectAllowed = 'move'; };
      if (e.isDir) {
        row.ondragover = ev => { ev.preventDefault(); row.classList.add('drop'); };
        row.ondragleave = () => row.classList.remove('drop');
        row.ondrop = ev => {
          ev.preventDefault(); row.classList.remove('drop');
          const from = ev.dataTransfer.getData('text/x-doca-path');
          if (from) act.move(from, abs); else if (ev.dataTransfer.files.length) act.send([...ev.dataTransfer.files], abs);
        };
      }
      box.append(row, kids);
      if (e.isDir && t.open.has(abs)) level(kids, abs, depth + 1);
    }
    if (!entries.length) box.innerHTML = `<div class="pj-node dim" style="padding-left:${8 + depth * 14}px">(empty)</div>`;
  }

  // The tree itself: drop on empty space goes to the root; F2 and Delete act on the selection.
  tree.ondragover = ev => ev.preventDefault();
  tree.ondrop = ev => {
    if (ev.target !== tree) return;
    ev.preventDefault();
    const from = ev.dataTransfer.getData('text/x-doca-path');
    if (from) act.move(from, t.root); else if (ev.dataTransfer.files.length) act.send([...ev.dataTransfer.files], t.root);
  };
  tree.onkeydown = ev => {
    if (ctxMenuKey(ev)) {   // the keyboard's right-click: the selection's menu, else the root's
      ev.preventDefault(); ev.stopPropagation();
      const row = [...tree.querySelectorAll('.pj-node.selected')][0];
      const [x, y] = ctxMenuAt(row || tree);
      return menu(x, y, t.selected || t.root, t.selected ? !!t.selectedDir : true, tree, row);
    }
    if (!t.selected) return;
    // Stopped here, so the Files tab's own F2/Delete (for its list selection) does not also fire.
    if (ev.key === 'F2') { ev.preventDefault(); ev.stopPropagation(); act.rename(t.selected); }
    if (ev.key === 'Delete') { ev.preventDefault(); ev.stopPropagation(); act.remove(t.selected, t.selectedDir); }
  };

  // Every page live (H10.5): the folders this tree shows are watched while it shows them, and a change in one redraws it.
  if (api === '/api/files' && typeof liveOn === 'function') {
    t.watched = () => liveFolders(container, container.isConnected ? [t.root, ...t.open] : []);
    const redraw = liveDebounce(() => (container.isConnected ? level(tree, t.root, 0) : t.watched()), 500);
    container._liveOff?.();
    container._liveOff = liveOn('files', c => { if (c.what === 'resync' || c.id === t.root || t.open.has(c.id)) redraw(); });
  }
  level(tree, t.root, 0);
  return { refresh: act.refresh, collapse: act.collapse, get root() { return t.root; }, get selected() { return t.selected; } };
}

/* ── The Files tab's machine: the host, or a paired device whose files are usable (device-files.js) ── */
let FM_MACHINE = null;
function fmApi() { return FM_MACHINE ? `/api/devices/${encodeURIComponent(FM_MACHINE)}/files` : '/api/files'; }

async function fmMachinesMount() {
  const side = document.querySelector('#tab-files .fm-sidebar');
  if (!side || document.getElementById('fm-machine')) return;
  let devs = [];
  try { devs = ((await apiFetch('/api/devices')).devices || []).filter(d => !d.revokedAt && d.control?.usable?.includes('files')); } catch { /* host only */ }
  if (!devs.length) return;   // nothing to choose between
  const hub = (await apiFetch('/api/auth/me').catch(() => null))?.hub;
  const group = Object.assign(document.createElement('div'), { className: 'fm-sidebar-group' });
  group.innerHTML = `<div class="fm-sidebar-label">🖥 Machine</div>
    <select class="input" id="fm-machine" style="width:100%">
      <option value="">${escHtml(hub ? `${hub} · the hub` : 'The hub')}</option>${devs.map(d => `<option value="${escHtml(d.id)}">${escHtml(d.name)}</option>`).join('')}
    </select>`;
  side.prepend(group);
  document.getElementById('fm-machine').onchange = e => fmUseMachine(e.target.value || null);
}

/** Switch the list and the tree to another machine; the host's bookmarks and mounts only mean something on the host. */
async function fmUseMachine(id) {
  FM_MACHINE = id;
  for (const g of document.querySelectorAll('#tab-files .fm-sidebar-group')) {
    if (g.querySelector('#fm-machine') || g.classList.contains('fm-tree-group')) continue;
    g.style.display = id ? 'none' : '';
  }
  let home = FM_BOOKMARKS[0]?.path || '/';
  if (id) {
    try { home = (await apiFetch(`${fmApi()}/list?path=`)).path || '/'; }
    catch (e) { appAlert(e.message); document.getElementById('fm-machine').value = ''; return fmUseMachine(null); }
  }
  fmNavigate(home);
  fmTreeMount(home);
}

/* ── Media type detection ────────────────────────────── */
const FM_IMG_EXTS   = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','tiff']);
const FM_VIDEO_EXTS = new Set(['mp4','webm','ogg','mov','avi','mkv','m4v']);
const FM_AUDIO_EXTS = new Set(['mp3','wav','flac','aac','m4a','opus']);

function fmMediaType(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (FM_IMG_EXTS.has(ext))   return 'image';
  if (FM_VIDEO_EXTS.has(ext)) return 'video';
  if (FM_AUDIO_EXTS.has(ext)) return 'audio';
  if (typeof MODEL3D_EXTS !== 'undefined' && MODEL3D_EXTS.includes(ext)) return 'model';
  return null;
}

/* ── Helpers ─────────────────────────────────────────── */
function fmFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    json: '{}', yml: '⚙', yaml: '⚙', sh: '⚡', md: '📝',
    txt: '📄', log: '📋', py: '🐍', js: '📜', ts: '📜',
    html: '🌐', css: '🎨', env: '🔑', conf: '⚙', cfg: '⚙',
    xml: '🌐', toml: '⚙', ini: '⚙',
    gz: '📦', tar: '📦', zip: '📦', '7z': '📦', rar: '📦', xz: '📦', bz2: '📦', zst: '📦',
    deb: '📦', rpm: '📦', pkg: '📦', appimage: '📦',
    bak: '♻', tmp: '♻', swp: '♻',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', svg: '🖼',
    webp: '🖼', avif: '🖼', bmp: '🖼', ico: '🖼', tiff: '🖼',
    mp4: '🎬', webm: '🎬', mkv: '🎬', mov: '🎬', avi: '🎬', m4v: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵', opus: '🎵', m4a: '🎵',
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙', csv: '📊',
    gguf: '🧠', bin: '⬛', safetensors: '🧠', onnx: '🧠', pt: '🧠', pth: '🧠',
    stl: '🧊', obj: '🧊', step: '🧊', stp: '🧊', gcode: '🧊',
    iso: '💿', img: '💿', dmg: '💿',
    db: '🗄', sqlite: '🗄', sql: '🗄',
    so: '⬛', dll: '⬛', exe: '⬛', o: '⬛', a: '⬛',
    c: '📜', cpp: '📜', h: '📜', hpp: '📜', rs: '📜', go: '📜', java: '📜', rb: '📜', lua: '📜',
  };
  return map[ext] || '📄';
}

function fmFmtSize(bytes) {
  if (!bytes) return '0 B';
  return fmtBytes(bytes);
}

function fmShortDate(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60)   return 'just now';
    if (diff < 3600) return `${Math.round(diff/60)}m ago`;
    if (diff < 86400) return `${Math.round(diff/3600)}h ago`;
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
  } catch { return '—'; }
}

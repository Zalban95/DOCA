/* ═══════════════════════════════════════════════════════
   DOCA PANEL — FILE MANAGER (upload / download / drag-drop)
   ═══════════════════════════════════════════════════════ */

/* ── State ───────────────────────────────────────────── */
const fm = {
  cwd:       '',
  entries:   [],
  selected:  new Set(),
  clipboard: null,
  sortBy:    'name',
  sortAsc:   true,
  editFile:  null,
  renaming:  null,
  favorites: [],
};

/* ── Init ────────────────────────────────────────────── */
async function fmInit() {
  if (document.getElementById('fm-bookmarks-list').children.length > 0) {
    fmRefresh(); return;
  }

  try {
    const paths = await apiFetch('/api/paths');
    fm.cwd = paths.home || '/';
    FM_BOOKMARKS = fmBookmarksFrom(paths);   // files-bookmarks.js: only what is there, or can be made
  } catch {
    fm.cwd = '/';
    FM_BOOKMARKS = [{ id: 'root', icon: '/', label: 'Root fs', path: '/' }];
  }

  fmBuildBookmarks();
  fmTreeMount(fm.cwd); fmMachinesMount();   // the tree, and a machine selector when a paired device shares its files
  fmSetupDragDrop();
  await fmLoadFavorites();
  fmLoadMounts();
  fmNavigate(fm.cwd);
}

function fmToggleSidebar() {
  const layout = document.getElementById('fm-layout');
  if (layout) layout.classList.toggle('fm-sidebar-open');
}

/* ── Favorites ────────────────────────────────────────── */
async function fmLoadFavorites() {
  try {
    const data = await apiFetch('/api/fm-favorites');
    fm.favorites = data.favorites || [];
    fmRenderFavorites();
  } catch {}
}

function fmRenderFavorites() {
  const el = document.getElementById('fm-favorites-list');
  if (!el) return;
  if (!fm.favorites.length) {
    el.innerHTML = '<div class="placeholder" style="font-size:10px;padding:4px">None starred</div>';
    return;
  }
  el.innerHTML = fm.favorites.map(p => {
    const name   = p.split('/').pop() || p;
    const parent = p.substring(0, p.lastIndexOf('/')) || '/';
    return `<div class="fm-fav-item" title="${escHtml(p)}">
      <button class="fm-bookmark" onclick="fmNavigate(${jsArg(parent)})"
              style="flex:1;justify-content:flex-start;text-overflow:ellipsis;overflow:hidden">
        <span class="fm-bookmark-icon">⭐</span>
        <span class="fm-bookmark-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</span>
      </button>
      <button class="btn-icon" title="Remove" onclick="fmUnstar(${jsArg(p)})">✕</button>
    </div>`;
  }).join('');
}

async function fmStarToggle(path, event) {
  if (event) event.stopPropagation();
  const idx = fm.favorites.indexOf(path);
  if (idx >= 0) {
    fm.favorites.splice(idx, 1);
  } else {
    fm.favorites.push(path);
  }
  try {
    await apiFetch('/api/fm-favorites', { method: 'POST', body: { favorites: fm.favorites } });
  } catch {}
  fmRenderFavorites();
  fmRenderList(); // refresh stars in file list
}

async function fmUnstar(path) {
  fm.favorites = fm.favorites.filter(p => p !== path);
  try {
    await apiFetch('/api/fm-favorites', { method: 'POST', body: { favorites: fm.favorites } });
  } catch {}
  fmRenderFavorites();
  fmRenderList();
}

/* ── Mounts ────────────────────────────────────────────── */
async function fmLoadMounts() {
  const el = document.getElementById('fm-mounts-list');
  if (!el) return;
  try {
    const data = await apiFetch(`${fmApi()}/mounts`);
    const mounts = data.mounts || [];
    if (!mounts.length) {
      el.innerHTML = '<div class="placeholder" style="font-size:10px;padding:4px">No mounts detected</div>';
      return;
    }
    el.innerHTML = mounts.map(m => {
      const label = m.path === '/' ? 'Root (/)' : m.path.split('/').pop() || m.path;
      const icon  = fmMountIcon(m.type, m.device);
      return `<button class="fm-bookmark" title="${escHtml(`${m.device} → ${m.path} (${m.type})`)}"
                      onclick="fmNavigate(${jsArg(m.path)})">
        <span class="fm-bookmark-icon">${icon}</span>
        <span class="fm-bookmark-name">${escHtml(label)}</span>
        <span style="font-size:8px;color:var(--muted);margin-left:auto">${escHtml(m.type)}</span>
      </button>`;
    }).join('');
  } catch {
    el.innerHTML = '<div class="placeholder" style="font-size:10px;padding:4px">Could not load mounts</div>';
  }
}

function fmMountIcon(fstype, device) {
  if (/nfs|cifs|smb|sshfs|fuse\.sshfs/.test(fstype)) return '🌐';
  if (/vfat|ntfs|exfat|fuseblk/.test(fstype)) return '🔌';
  if (device && device.startsWith('/dev/sd')) return '💾';
  if (device && device.startsWith('/dev/nvme')) return '⚡';
  if (device && device.startsWith('/dev/mmcblk')) return '📇';
  if (fstype === 'tmpfs') return '⏳';
  if (fstype === 'overlay') return '🧅';
  return '💿';
}

/** The sidebar's tree (lib/filetree.js, the same one the Projects tab uses), rooted at the last bookmark. */
function fmTreeMount(root) {
  let box = document.getElementById('fm-tree');
  if (!box) {
    const group = Object.assign(document.createElement('div'), { className: 'fm-sidebar-group fm-tree-group' });
    group.innerHTML = '<div class="fm-sidebar-label">🌳 Tree</div><div id="fm-tree"></div>';
    document.querySelector('#tab-files .fm-sidebar')?.appendChild(group);
    box = document.getElementById('fm-tree');
  }
  if (!box) return;
  fm.tree = fileTree(box, { root, api: fmApi(), onOpenDir: fmNavigate, onOpen: p => {
    const mt = fmMediaType(p.split('/').pop());
    if (mt) fmPreviewFile(p, mt); else fmOpenEditor(p);
  } });
}

function fmUpdateBookmarkActive() {
  document.querySelectorAll('.fm-bookmark').forEach(b => b.classList.remove('active'));
  const match = FM_BOOKMARKS.find(b => fm.cwd === b.path);
  if (match) document.getElementById(`fmbk-${match.id}`)?.classList.add('active');
}

/* ── Navigate ────────────────────────────────────────── */
async function fmNavigate(path) {
  fm.cwd      = path;
  fm.selected = new Set(); fm.renaming = null;
  fmUpdateBookmarkActive();
  fmRenderBreadcrumb();
  document.getElementById('fm-path-input').value = path;
  await fmRefresh();
}

async function fmRefresh() {
  const list = document.getElementById('fm-list-inner');
  list.innerHTML = '<div class="placeholder pulse" style="padding:16px">Loading…</div>';
  try {
    const data    = await apiFetch(`${fmApi()}/list?path=${encodeURIComponent(fm.cwd)}`);
    fm.entries    = data.entries || [];
    fmRenderList();
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="padding:16px;color:var(--red)">${escHtml(e.message)}</div>`;
  }
  fmUpdateStatus();
  if (typeof liveFilesTab === 'function') liveFilesTab();   // other screens' changes to it redraw it (live-pages.js)
}

/* ── Breadcrumb ──────────────────────────────────────── */
function fmRenderBreadcrumb() {
  const bc   = document.getElementById('fm-breadcrumb');
  const parts = fm.cwd.replace(/\/$/, '').split('/').filter((p, i) => i === 0 || p);
  bc.innerHTML = '';

  let accumulated = '';
  parts.forEach((part, idx) => {
    accumulated = idx === 0 ? '/' : `${accumulated}/${part}`;
    const seg = accumulated;

    if (idx > 0) {
      const sep  = document.createElement('span');
      sep.className = 'fm-bc-sep'; sep.textContent = '/';
      bc.appendChild(sep);
    }
    const btn       = document.createElement('button');
    btn.className   = 'fm-bc-part';
    btn.textContent = part === '' ? '/' : part;
    btn.onclick     = () => fmNavigate(seg);
    bc.appendChild(btn);
  });
}

/* ── Render file list ────────────────────────────────── */
function fmRenderList() {
  const container = document.getElementById('fm-list-inner');

  let entries = [...fm.entries];

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let va = a[fm.sortBy] || '', vb = b[fm.sortBy] || '';
    if (fm.sortBy === 'size') { va = a.size || 0; vb = b.size || 0; }
    const cmp = typeof va === 'number' ? va - vb : va.localeCompare(vb);
    return fm.sortAsc ? cmp : -cmp;
  });

  if (!entries.length) {
    container.innerHTML = `<div class="fm-empty"><div class="fm-empty-icon">📂</div><span>Empty directory</span></div>`;
    return;
  }

  const rows = entries.map(e => fmRowHTML(e)).join('');
  container.innerHTML = rows;
}

function fmRowHTML(e) {
  const fpath    = `${fm.cwd}/${e.name}`.replace('//', '/');
  const isCut    = fm.clipboard?.op === 'cut' && fm.clipboard.paths.includes(fpath);
  const selected = fm.selected.has(fpath);
  const icon     = e.isDir ? '📁' : fmFileIcon(e.name);
  const size     = e.isDir ? '—' : fmFmtSize(e.size);
  const date     = e.mtime ? fmShortDate(e.mtime) : '—';

  const starred = fm.favorites.includes(fpath);

  return `<div class="fm-row ${e.isDir ? 'dir' : ''} ${selected ? 'selected' : ''} ${isCut ? 'cut' : ''}"
               data-path="${escHtml(fpath)}" data-name="${escHtml(e.name)}" data-isdir="${e.isDir}"
               onclick="fmClickRow(event, ${jsArg(fpath)}, ${e.isDir})"
               ondblclick="fmDblClick(${jsArg(fpath)}, ${e.isDir})"
               oncontextmenu="fmContextMenu(event, ${jsArg(fpath)}, ${e.isDir})">
    <span class="fm-icon">${icon}</span>
    <span class="fm-name" title="${escHtml(e.name)}">${escHtml(e.name)}</span>
    <span class="fm-size">${escHtml(size)}</span>
    <span class="fm-date">${escHtml(date)}</span>
    <span class="fm-acts">
      <button class="btn btn-xs fm-star-btn ${starred ? 'starred' : ''}" title="${starred ? 'Unstar' : 'Star'}"
              onclick="fmStarToggle(${jsArg(fpath)}, event)">${starred ? '⭐' : '☆'}</button>
      ${!e.isDir && fmMediaType(e.name) ? `<button class="btn btn-xs btn-teal" title="Preview" onclick="fmPreviewFile(${jsArg(fpath)},${jsArg(fmMediaType(e.name))},event)">👁</button>` : ''}
      ${!e.isDir ? `<button class="btn btn-xs" title="Download" onclick="fmDownloadFile(${jsArg(fpath)}, event)">⬇</button>` : ''}
      ${!e.isDir ? `<button class="btn btn-xs" title="Edit" onclick="fmOpenEditor(${jsArg(fpath)}, event)">✏</button>` : ''}
      <button class="btn btn-xs" title="Rename" onclick="fmRenameInline(${jsArg(fpath)}, ${jsArg(e.name)}, event)">↩</button>
      <button class="btn btn-xs btn-red" title="Delete" onclick="fmDelete(${jsArg(fpath)}, ${e.isDir}, event)">✕</button>
    </span>
  </div>`;
}

/* ── Row interactions ────────────────────────────────── */
function fmSyncSelectionUI() {
  document.querySelectorAll('.fm-row').forEach(r => {
    r.classList.toggle('selected', fm.selected.has(r.dataset.path));
  });
}

function fmClickRow(event, path, isDir) {
  if (event.ctrlKey || event.metaKey) {
    fm.selected.has(path) ? fm.selected.delete(path) : fm.selected.add(path);
  } else if (event.shiftKey) {
    const rows = Array.from(document.querySelectorAll('.fm-row'));
    const idx  = rows.findIndex(r => r.dataset.path === path);
    const lastSelected = [...fm.selected];
    if (lastSelected.length) {
      const lastPath = lastSelected[lastSelected.length - 1];
      const lastIdx  = rows.findIndex(r => r.dataset.path === lastPath);
      const [lo, hi] = [Math.min(idx, lastIdx), Math.max(idx, lastIdx)];
      rows.slice(lo, hi + 1).forEach(r => fm.selected.add(r.dataset.path));
    } else {
      fm.selected.add(path);
    }
  } else {
    fm.selected = new Set([path]);
  }
  fmSyncSelectionUI();
  fmUpdateStatus();
}

function fmDblClick(path, isDir) {
  if (isDir) {
    fmNavigate(path);
    return;
  }
  const name = path.split('/').pop();
  const mt   = fmMediaType(name);
  if (mt) { fmPreviewFile(path, mt); return; }

  const entry = fm.entries.find(e => `${fm.cwd}/${e.name}`.replace('//', '/') === path);
  const size  = entry?.size || 0;
  const SIZE_WARN = 10 * 1024 * 1024; // 10 MB

  if (size > SIZE_WARN) {
    const sizeMB = (size / 1e6).toFixed(1);
    appConfirm(`This file is ${sizeMB} MB. Open as text anyway?`, () => fmOpenEditor(path));
  } else {
    fmOpenEditor(path);
  }
}

/* ── Context menu ────────────────────────────────────── */
function fmContextMenu(event, path, isDir) {
  event.preventDefault();
  if (!fm.selected.has(path)) fm.selected = new Set([path]);
  fmRenderList();
  const mt = !isDir && fmMediaType(path.split('/').pop());
  const acts = [
    ...(mt ? [{ label: '👁 Preview', fn: () => fmPreviewFile(path, mt) }] : []),
    { label: isDir ? '→ Open' : '✏ Edit', fn: () => isDir ? fmNavigate(path) : fmOpenEditor(path) },
    { label: '⧉ Copy',    fn: () => fmCopy() },
    { label: '✂ Cut',     fn: () => fmCut() },
    { label: '↩ Rename',  fn: () => fmRenameInline(path, path.split('/').pop()) },
    ...(!isDir ? [{ label: '⬇ Download', fn: () => fmDownloadFile(path) }] : []),
    { label: '✕ Delete',  fn: () => fmDelete(path, isDir) },
  ];
  showContextModal(event.clientX, event.clientY, acts);
}

/* ── Clipboard operations ────────────────────────────── */
function fmCopy() {
  const paths = fm.selected.size ? [...fm.selected] : [];
  if (!paths.length) return;
  fm.clipboard = { op: 'copy', paths };
  fmUpdateStatus();
  fmRenderList();
}

function fmCut() {
  const paths = fm.selected.size ? [...fm.selected] : [];
  if (!paths.length) return;
  fm.clipboard = { op: 'cut', paths };
  fmUpdateStatus();
  fmRenderList();
}

async function fmPaste() {
  if (!fm.clipboard?.paths.length) return;
  const { op, paths } = fm.clipboard;
  try {
    await apiFetch(`${fmApi()}/paste`, {
      method: 'POST',
      body: { op, paths, dest: fm.cwd }
    });
    if (op === 'cut') fm.clipboard = null;
    fmRefresh();
  } catch (e) { appAlert(`Paste error: ${e.message}`); }
}

/* ── Delete ──────────────────────────────────────────── */
function fmDelete(path, isDir, evt) {
  if (evt) evt.stopPropagation();
  const targets = fm.selected.size > 1 ? [...fm.selected] : [path];
  appConfirm(`Delete ${targets.length} item(s)?`, async () => {
    try {
      await apiFetch(`${fmApi()}/delete`, { method: 'POST', body: { paths: targets } });
      fm.selected = new Set();
      fmRefresh();
    } catch (e) { appAlert(`Delete error: ${e.message}`); }
  });
}

/* ── Rename (inline) ─────────────────────────────────── */
function fmRenameInline(path, name, evt) {
  if (evt) evt.stopPropagation();
  const rows = document.querySelectorAll('.fm-row');
  const row  = Array.from(rows).find(r => r.dataset.path === path);
  if (!row) return;

  const nameEl = row.querySelector('.fm-name');
  const orig   = nameEl.textContent;
  nameEl.innerHTML = '';

  const input       = document.createElement('input');
  input.className   = 'fm-rename-input';
  input.value       = name;
  nameEl.appendChild(input);
  input.focus();
  input.select();

  const doRename = async () => {
    const newName = input.value.trim();
    if (!newName || newName === name) { fmRenderList(); return; }
    const dir     = path.substring(0, path.lastIndexOf('/'));
    const newPath = `${dir}/${newName}`;
    try {
      await apiFetch(`${fmApi()}/rename`, { method: 'POST', body: { from: path, to: newPath } });
      fmRefresh();
    } catch (e) { appAlert(`Rename error: ${e.message}`); fmRenderList(); }
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); doRename(); }
    if (e.key === 'Escape') { fmRenderList(); }
  });
  input.addEventListener('blur', doRename);
}

/* ── Create new folder ───────────────────────────────── */
function fmNewFolder() {
  appPrompt('New folder name:', async (name) => {
    try {
      await apiFetch(`${fmApi()}/mkdir`, { method: 'POST', body: { path: `${fm.cwd}/${name}` } });
      fmRefresh();
    } catch (e) { appAlert(`Error: ${e.message}`); }
  });
}

/* ── Create new file ─────────────────────────────────── */
function fmNewFile() {
  appPrompt('New file name:', async (name) => {
    const fpath = `${fm.cwd}/${name}`;
    try {
      await apiFetch(`${fmApi()}/write`, { method: 'POST', body: { path: fpath, content: '' } });
      fmRefresh();
      fmOpenEditor(fpath);
    } catch (e) { appAlert(`Error: ${e.message}`); }
  });
}

/* ── Inline text editor ──────────────────────────────── */
async function fmOpenEditor(path, evt) {
  if (evt) evt.stopPropagation();
  const panel  = document.getElementById('fm-editor-panel');
  const fname  = document.getElementById('fm-editor-filename');
  const editor = document.getElementById('fm-editor');

  fname.textContent = path;
  fm.editFile       = path;
  panel.style.display = 'flex';

  try {
    const data  = await apiFetch(`${fmApi()}/read?path=${encodeURIComponent(path)}`);
    editor.value = data.content;
    editor.focus();
  } catch (e) { editor.value = `// Error: ${e.message}`; }
}

function fmCloseEditor() {
  document.getElementById('fm-editor-panel').style.display = 'none';
  fm.editFile = null;
}

async function fmSaveEditor() {
  if (!fm.editFile) return;
  const content = document.getElementById('fm-editor').value;
  const status  = document.getElementById('fm-editor-status');
  try {
    await apiFetch(`${fmApi()}/write`, { method: 'POST', body: { path: fm.editFile, content } });
    setStatus(status, '✓ Saved', 'ok');
  } catch (e) { setStatus(status, `✗ ${e.message}`, 'err'); }
}

/* ── Path input ──────────────────────────────────────── */
function fmGoPath(evt) {
  if (evt.key === 'Enter') {
    fmNavigate(document.getElementById('fm-path-input').value.trim());
  }
}

/* ── Media preview ───────────────────────────────────── */
function fmPreviewFile(fpath, mediaType, evt) {
  if (evt) evt.stopPropagation();
  fm._previewPath = fpath;
  // In the page's media viewer: zoomable, and Back closes it (agent-ui/media-viewer.js). Either separator:
  // a device's paths may be Windows ones.
  const name = fpath.split(/[\\/]/).pop();
  mediaViewerOpen({ src: `${fmApi()}/raw?path=${encodeURIComponent(fpath)}`, kind: mediaType, name,
    download: `${fmApi()}/download/${encodeURIComponent(name)}?path=${encodeURIComponent(fpath)}` });
}

function fmClosePreview() {
  const modal = document.getElementById('fm-preview-modal');
  modal.querySelectorAll('video,audio').forEach(m => { try { m.pause(); m.src = ''; } catch {} });
  modal.style.display = 'none';
}

/* ── Status bar ──────────────────────────────────────── */
function fmUpdateStatus() {
  const bar  = document.getElementById('fm-statusbar-text');
  const clip = document.getElementById('fm-statusbar-clip');
  const total = fm.entries.length;
  const selN  = fm.selected.size;
  bar.textContent = selN > 0 ? `${selN} selected of ${total} items` : `${total} items`;
  if (fm.clipboard) {
    clip.textContent = `${fm.clipboard.op === 'cut' ? '✂' : '⧉'} ${fm.clipboard.paths.length} in clipboard`;
    clip.className   = 'fm-clipboard-info';
  } else {
    clip.textContent = '';
  }
}

/* ── Sort ────────────────────────────────────────────── */
function fmSort(by) {
  if (fm.sortBy === by) fm.sortAsc = !fm.sortAsc;
  else { fm.sortBy = by; fm.sortAsc = true; }
  document.querySelectorAll('.fm-col-h').forEach(h => {
    h.classList.toggle('sorted', h.dataset.sort === by);
  });
  fmRenderList();
}

/* ── Upload ──────────────────────────────────────────── */
function fmUploadClick() {
  document.getElementById('fm-upload-input').click();
}

function fmUploadFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const formData = new FormData();
  formData.append('dest', fm.cwd);
  for (const f of fileList) formData.append('files', f);

  const statusBar  = document.getElementById('fm-statusbar-text');
  const progressWrap = document.getElementById('fm-upload-progress');
  const progressBar  = document.getElementById('fm-upload-progress-bar');
  const pctEl        = document.getElementById('fm-drop-pct');
  const dropText     = document.getElementById('fm-drop-text');

  statusBar.textContent = `Uploading ${fileList.length} file(s)…`;
  if (progressWrap) {
    progressWrap.style.display = 'block';
    progressBar.style.width    = '0%';
    pctEl.textContent          = '0%';
    if (dropText) dropText.textContent = `Uploading ${fileList.length} file(s)…`;
  }

  const xhr = new XMLHttpRequest();

  xhr.upload.addEventListener('progress', e => {
    if (!e.lengthComputable) return;
    const pct = Math.round(e.loaded / e.total * 100);
    if (progressBar) progressBar.style.width = pct + '%';
    if (pctEl)       pctEl.textContent       = pct + '%';
    statusBar.textContent = `Uploading… ${pct}%`;
  });

  xhr.addEventListener('load', () => {
    if (progressWrap) progressWrap.style.display = 'none';
    if (pctEl)        pctEl.textContent = '';
    if (dropText)     dropText.textContent = 'Drop files here to upload';
    document.getElementById('fm-upload-input').value = '';
    try {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status >= 400) throw new Error(data.error || 'Upload failed');
      const ok   = (data.results || []).filter(r => r.ok).length;
      const fail = (data.results || []).filter(r => r.error).length;
      statusBar.textContent = `Uploaded ${ok} file(s)${fail ? `, ${fail} failed` : ''}`;
    } catch (e) {
      statusBar.textContent = `Upload error: ${e.message}`;
    }
    fmRefresh();
  });

  xhr.addEventListener('error', () => {
    if (progressWrap) progressWrap.style.display = 'none';
    if (dropText)     dropText.textContent = 'Drop files here to upload';
    statusBar.textContent = 'Upload failed (network error)';
    document.getElementById('fm-upload-input').value = '';
  });

  xhr.open('POST', `${fmApi()}/upload`);
  xhr.send(formData);
}

/* ── Download ────────────────────────────────────────── */
function fmDownloadFile(fpath, evt) {
  if (evt) evt.stopPropagation();
  const a  = document.createElement('a');
  // The name at the end of the URL too: a phone's download manager names the file from the URL, and
  // ".../download?path=…" came out as download.bin (2026-10-04).
  a.download = fpath.split(/[\\/]/).pop();
  a.href   = `${fmApi()}/download/${encodeURIComponent(a.download)}?path=${encodeURIComponent(fpath)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function fmDownloadSelected() {
  if (!fm.selected.size) return;
  for (const p of fm.selected) {
    const entry = fm.entries.find(e => `${fm.cwd}/${e.name}`.replace('//','/') === p);
    if (entry && !entry.isDir) fmDownloadFile(p);
  }
}

/* ── Drag & Drop ─────────────────────────────────────── */
function fmSetupDragDrop() {
  const layout = document.getElementById('fm-layout');
  const zone   = document.getElementById('fm-drop-zone');
  let dragCounter = 0;

  layout.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    zone.classList.add('active');
    document.getElementById('fm-drop-dest').textContent = `→ ${fm.cwd}`;
  });

  layout.addEventListener('dragleave', e => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { zone.classList.remove('active'); dragCounter = 0; }
  });

  layout.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  layout.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    zone.classList.remove('active');
    if (e.dataTransfer.files.length) {
      fmUploadFiles(e.dataTransfer.files);
    }
  });
}

/* ── Keyboard shortcuts ──────────────────────────────── */
document.addEventListener('keydown', e => {
  if (!pageShown('files')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); fmCopy(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'x') { e.preventDefault(); fmCut(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); fmPaste(); }
  if (e.key === 'Delete') {
    if (fm.selected.size) { e.preventDefault(); fmDelete([...fm.selected][0], false); }
  }
  if (e.key === 'F2' && fm.selected.size === 1) {
    const path = [...fm.selected][0];
    fmRenameInline(path, path.split('/').pop());
  }
  if (e.key === 'Backspace' && !e.ctrlKey) {
    const parent = fm.cwd.substring(0, fm.cwd.lastIndexOf('/')) || '/';
    fmNavigate(parent);
  }
});

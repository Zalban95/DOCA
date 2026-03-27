/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — FILE MANAGER (upload / download / drag-drop)
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

/* ── Bookmarks (populated at init from /api/paths) ──── */
let FM_BOOKMARKS = [];

/* ── Init ────────────────────────────────────────────── */
async function fmInit() {
  if (document.getElementById('fm-bookmarks-list').children.length > 0) {
    fmRefresh(); return;
  }

  try {
    const paths = await apiFetch('/api/paths');
    const h = paths.home || '/';
    fm.cwd = h;
    FM_BOOKMARKS = [
      { id: 'home',      icon: '⌂', label: 'Home',       path: h },
      { id: 'openclaw',  icon: '⚙', label: '.openclaw',   path: h + '/.openclaw' },
      { id: 'workspace', icon: '📁', label: 'Workspace',   path: paths.workspaceDir || h + '/.openclaw/workspace' },
      { id: 'skills',    icon: '🔌', label: 'Skills',      path: paths.skillsDir    || h + '/.openclaw/workspace/skills' },
      { id: 'compose',   icon: '🐳', label: 'Docker dir',  path: paths.composeDir   || h + '/openclaw' },
      { id: 'snapshots', icon: '📷', label: 'Snapshots',   path: paths.snapshotDir  || '/tmp' },
      { id: 'root',      icon: '/', label: 'Root fs',      path: '/' },
    ];
  } catch {
    fm.cwd = '/';
    FM_BOOKMARKS = [
      { id: 'root', icon: '/', label: 'Root fs', path: '/' },
    ];
  }

  fmBuildBookmarks();
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
    const name = p.split('/').pop() || p;
    const safe = p.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<div class="fm-fav-item" title="${p}">
      <button class="fm-bookmark" onclick="fmNavigate('${safe.substring(0, safe.lastIndexOf('/')) || '/'}')"
              style="flex:1;justify-content:flex-start;text-overflow:ellipsis;overflow:hidden">
        <span class="fm-bookmark-icon">⭐</span>
        <span class="fm-bookmark-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
      </button>
      <button class="btn-icon" title="Remove" onclick="fmUnstar('${safe}')">✕</button>
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
    const data = await apiFetch('/api/files/mounts');
    const mounts = data.mounts || [];
    if (!mounts.length) {
      el.innerHTML = '<div class="placeholder" style="font-size:10px;padding:4px">No mounts detected</div>';
      return;
    }
    el.innerHTML = mounts.map(m => {
      const label = m.path === '/' ? 'Root (/)' : m.path.split('/').pop() || m.path;
      const icon  = fmMountIcon(m.type, m.device);
      const safe  = m.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `<button class="fm-bookmark" title="${m.device} → ${m.path} (${m.type})"
                      onclick="fmNavigate('${safe}')">
        <span class="fm-bookmark-icon">${icon}</span>
        <span class="fm-bookmark-name">${label}</span>
        <span style="font-size:8px;color:var(--muted);margin-left:auto">${m.type}</span>
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

function fmBuildBookmarks() {
  const ul = document.getElementById('fm-bookmarks-list');
  FM_BOOKMARKS.forEach(b => {
    const btn     = document.createElement('button');
    btn.className = 'fm-bookmark';
    btn.id        = `fmbk-${b.id}`;
    btn.title     = b.path;
    btn.innerHTML = `<span class="fm-bookmark-icon">${b.icon}</span>
                     <span class="fm-bookmark-name">${b.label}</span>`;
    btn.onclick   = () => fmNavigate(b.path);
    ul.appendChild(btn);
  });
}

function fmUpdateBookmarkActive() {
  document.querySelectorAll('.fm-bookmark').forEach(b => b.classList.remove('active'));
  const match = FM_BOOKMARKS.find(b => fm.cwd === b.path);
  if (match) document.getElementById(`fmbk-${match.id}`)?.classList.add('active');
}

/* ── Navigate ────────────────────────────────────────── */
async function fmNavigate(path) {
  fm.cwd      = path;
  fm.selected = new Set();
  fm.renaming = null;
  fmUpdateBookmarkActive();
  fmRenderBreadcrumb();
  document.getElementById('fm-path-input').value = path;
  await fmRefresh();
}

async function fmRefresh() {
  const list = document.getElementById('fm-list-inner');
  list.innerHTML = '<div class="placeholder pulse" style="padding:16px">Loading…</div>';
  try {
    const data    = await apiFetch(`/api/files/list?path=${encodeURIComponent(fm.cwd)}`);
    fm.entries    = data.entries || [];
    fmRenderList();
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="padding:16px;color:var(--red)">${e.message}</div>`;
  }
  fmUpdateStatus();
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
               data-path="${fpath}" data-name="${e.name}" data-isdir="${e.isDir}"
               onclick="fmClickRow(event, '${fpath}', ${e.isDir})"
               ondblclick="fmDblClick('${fpath}', ${e.isDir})"
               oncontextmenu="fmContextMenu(event, '${fpath}', ${e.isDir})">
    <span class="fm-icon">${icon}</span>
    <span class="fm-name" title="${e.name}">${e.name}</span>
    <span class="fm-size">${size}</span>
    <span class="fm-date">${date}</span>
    <span class="fm-acts">
      <button class="btn btn-xs fm-star-btn ${starred ? 'starred' : ''}" title="${starred ? 'Unstar' : 'Star'}"
              onclick="fmStarToggle('${fpath}', event)">${starred ? '⭐' : '☆'}</button>
      ${!e.isDir && fmMediaType(e.name) ? `<button class="btn btn-xs btn-teal" title="Preview" onclick="fmPreviewFile('${fpath}','${fmMediaType(e.name)}',event)">👁</button>` : ''}
      ${!e.isDir ? `<button class="btn btn-xs" title="Download" onclick="fmDownloadFile('${fpath}', event)">⬇</button>` : ''}
      ${!e.isDir ? `<button class="btn btn-xs" title="Edit" onclick="fmOpenEditor('${fpath}', event)">✏</button>` : ''}
      <button class="btn btn-xs" title="Rename" onclick="fmRenameInline('${fpath}', '${e.name}', event)">↩</button>
      <button class="btn btn-xs btn-red" title="Delete" onclick="fmDelete('${fpath}', ${e.isDir}, event)">✕</button>
    </span>
  </div>`;
}

/* ── Row interactions ────────────────────────────────── */
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
  fmRenderList();
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

function showContextModal(x, y, actions) {
  removeContextModal();
  const menu = document.createElement('div');
  menu.id = 'fm-ctx-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:9999;
    background:var(--raised);border:1px solid var(--border2);min-width:140px;
    box-shadow:0 4px 20px rgba(0,0,0,0.5)`;
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.style.cssText = `display:block;width:100%;padding:7px 14px;text-align:left;
      background:transparent;border:none;color:var(--text);font-family:inherit;
      font-size:11px;cursor:pointer;border-bottom:1px solid var(--border);`;
    btn.textContent = a.label;
    btn.onmouseenter = () => btn.style.background = 'var(--dim)';
    btn.onmouseleave = () => btn.style.background = 'transparent';
    btn.onclick      = () => { removeContextModal(); a.fn(); };
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', removeContextModal, { once: true }), 50);
}

function removeContextModal() {
  document.getElementById('fm-ctx-menu')?.remove();
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
    await apiFetch('/api/files/paste', {
      method: 'POST',
      body: { op, paths, dest: fm.cwd }
    });
    if (op === 'cut') fm.clipboard = null;
    fmRefresh();
  } catch (e) { alert(`Paste error: ${e.message}`); }
}

/* ── Delete ──────────────────────────────────────────── */
function fmDelete(path, isDir, evt) {
  if (evt) evt.stopPropagation();
  const targets = fm.selected.size > 1 ? [...fm.selected] : [path];
  appConfirm(`Delete ${targets.length} item(s)?`, async () => {
    try {
      await apiFetch('/api/files/delete', { method: 'POST', body: { paths: targets } });
      fm.selected = new Set();
      fmRefresh();
    } catch (e) { alert(`Delete error: ${e.message}`); }
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
      await apiFetch('/api/files/rename', { method: 'POST', body: { from: path, to: newPath } });
      fmRefresh();
    } catch (e) { alert(`Rename error: ${e.message}`); fmRenderList(); }
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
      await apiFetch('/api/files/mkdir', { method: 'POST', body: { path: `${fm.cwd}/${name}` } });
      fmRefresh();
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

/* ── Create new file ─────────────────────────────────── */
function fmNewFile() {
  appPrompt('New file name:', async (name) => {
    const fpath = `${fm.cwd}/${name}`;
    try {
      await apiFetch('/api/files/write', { method: 'POST', body: { path: fpath, content: '' } });
      fmRefresh();
      fmOpenEditor(fpath);
    } catch (e) { alert(`Error: ${e.message}`); }
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
    const data  = await apiFetch(`/api/files/read?path=${encodeURIComponent(path)}`);
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
    await apiFetch('/api/files/write', { method: 'POST', body: { path: fm.editFile, content } });
    setStatus(status, '✓ Saved', 'ok');
    setTimeout(() => setStatus(status, ''), 3000);
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
  const modal = document.getElementById('fm-preview-modal');
  const title = document.getElementById('fm-preview-title');
  const body  = document.getElementById('fm-preview-body');

  title.textContent = fpath.split('/').pop();
  body.innerHTML = '';

  const url = `/api/files/raw?path=${encodeURIComponent(fpath)}`;

  if (mediaType === 'image') {
    const img = document.createElement('img');
    img.src   = url;
    img.alt   = title.textContent;
    body.appendChild(img);
  } else if (mediaType === 'video') {
    const v = document.createElement('video');
    v.src      = url;
    v.controls = true;
    v.autoplay = false;
    body.appendChild(v);
  } else if (mediaType === 'audio') {
    const a = document.createElement('audio');
    a.src      = url;
    a.controls = true;
    body.appendChild(a);
  }

  modal.style.display = 'flex';
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

  xhr.open('POST', '/api/files/upload');
  xhr.send(formData);
}

/* ── Download ────────────────────────────────────────── */
function fmDownloadFile(fpath, evt) {
  if (evt) evt.stopPropagation();
  const a  = document.createElement('a');
  a.href   = `/api/files/download?path=${encodeURIComponent(fpath)}`;
  a.download = fpath.split('/').pop();
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
  if (currentTab !== 'files') return;
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

/* ── Media type detection ────────────────────────────── */
const FM_IMG_EXTS   = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','tiff']);
const FM_VIDEO_EXTS = new Set(['mp4','webm','ogg','mov','avi','mkv','m4v']);
const FM_AUDIO_EXTS = new Set(['mp3','wav','flac','aac','m4a','opus']);

function fmMediaType(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (FM_IMG_EXTS.has(ext))   return 'image';
  if (FM_VIDEO_EXTS.has(ext)) return 'video';
  if (FM_AUDIO_EXTS.has(ext)) return 'audio';
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

/* ═══════════════════════════════════════════════════════
   GLOBAL FILE SEARCH (header bar)
   ═══════════════════════════════════════════════════════ */

let _searchActiveIdx = -1;

const globalSearchDebounced = debounce(async () => {
  const input   = document.getElementById('global-search');
  const results = document.getElementById('global-search-results');
  const q = input.value.trim();

  if (q.length < 2) {
    results.classList.remove('open');
    results.innerHTML = '';
    return;
  }

  const root = (typeof fm !== 'undefined' && fm.cwd) ? fm.cwd : '/';
  try {
    const data = await apiFetch(`/api/files/search?root=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}`);
    const items = data.results || [];
    _searchActiveIdx = -1;

    if (!items.length) {
      results.innerHTML = '<div class="header-search-empty">No results found</div>';
      results.classList.add('open');
      return;
    }

    results.innerHTML = items.map((item, i) => {
      const icon = item.isDir ? '📁' : fmFileIcon(item.name);
      const dir  = item.path.substring(0, item.path.lastIndexOf('/')) || '/';
      return `<div class="header-search-item" data-idx="${i}"
                   onclick="globalSearchGo('${item.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', ${item.isDir})"
                   onmouseenter="globalSearchHover(${i})">
        <span class="header-search-item-icon">${icon}</span>
        <span class="header-search-item-name">${item.name}</span>
        <span class="header-search-item-path" title="${item.path}">${dir}</span>
      </div>`;
    }).join('');
    results.classList.add('open');
  } catch {
    results.innerHTML = '<div class="header-search-empty">Search error</div>';
    results.classList.add('open');
  }
}, 300);

function globalSearchShow() {
  const results = document.getElementById('global-search-results');
  if (results && results.innerHTML && document.getElementById('global-search').value.trim().length >= 2) {
    results.classList.add('open');
  }
}

function globalSearchKey(event) {
  const results = document.getElementById('global-search-results');
  const items   = results.querySelectorAll('.header-search-item');
  if (!items.length) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    _searchActiveIdx = Math.min(_searchActiveIdx + 1, items.length - 1);
    globalSearchHighlight(items);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    _searchActiveIdx = Math.max(_searchActiveIdx - 1, 0);
    globalSearchHighlight(items);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (_searchActiveIdx >= 0 && items[_searchActiveIdx]) {
      items[_searchActiveIdx].click();
    }
  } else if (event.key === 'Escape') {
    results.classList.remove('open');
    document.getElementById('global-search').blur();
  }
}

function globalSearchHighlight(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === _searchActiveIdx));
  if (items[_searchActiveIdx]) {
    items[_searchActiveIdx].scrollIntoView({ block: 'nearest' });
  }
}

function globalSearchHover(idx) {
  _searchActiveIdx = idx;
  const items = document.querySelectorAll('.header-search-item');
  globalSearchHighlight(items);
}

function globalSearchGo(filePath, isDir) {
  const results = document.getElementById('global-search-results');
  results.classList.remove('open');
  document.getElementById('global-search').value = '';

  nav('files');

  if (isDir) {
    fmNavigate(filePath);
  } else {
    const dir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    fmNavigate(dir);
  }
}

document.addEventListener('click', (e) => {
  const search = document.getElementById('header-search');
  if (search && !search.contains(e.target)) {
    document.getElementById('global-search-results').classList.remove('open');
  }
});

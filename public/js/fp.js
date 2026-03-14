/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — FILE PICKER MODAL
   Reusable directory/file browser for path inputs.
   Usage: fpOpen('input-element-id', 'dir' | 'file')
   ═══════════════════════════════════════════════════════ */

let _fpTarget = null;  // input element id
let _fpMode   = 'dir'; // 'dir' or 'file'
let _fpCwd    = '/';

function fpOpen(targetInputId, mode) {
  _fpTarget = targetInputId;
  _fpMode   = mode || 'dir';

  const input   = document.getElementById(targetInputId);
  const current = input?.value?.trim() || '';

  // Start from the directory of the current value, or the value itself if it's a dir
  if (current && current.includes('/')) {
    _fpCwd = mode === 'dir' ? current : current.substring(0, current.lastIndexOf('/')) || '/';
  } else {
    _fpCwd = '/home/al';
  }

  const modal = document.getElementById('fp-modal');
  if (!modal) return;

  document.getElementById('fp-title').textContent = mode === 'file' ? 'Select File' : 'Select Directory';
  document.getElementById('fp-selected').value = current || _fpCwd;
  modal.style.display = 'flex';

  _fpLoadDir(_fpCwd);
}

function fpClose() {
  const modal = document.getElementById('fp-modal');
  if (modal) modal.style.display = 'none';
  _fpTarget = null;
}

function fpConfirm() {
  const val = document.getElementById('fp-selected')?.value?.trim();
  if (_fpTarget && val) {
    const inp = document.getElementById(_fpTarget);
    if (inp) {
      inp.value = val;
      inp.dispatchEvent(new Event('input'));
    }
  }
  fpClose();
}

async function _fpLoadDir(path) {
  _fpCwd = path;
  const selInput = document.getElementById('fp-selected');
  if (selInput && _fpMode === 'dir') selInput.value = path;

  _fpRenderBreadcrumb(path);

  const list = document.getElementById('fp-list');
  if (!list) return;
  list.innerHTML = '<div class="placeholder pulse" style="padding:12px">Loading…</div>';

  try {
    const data    = await apiFetch(`/api/files/list?path=${encodeURIComponent(path)}`);
    const entries = (data.entries || []).slice();

    // Sort: dirs first, then files; alphabetically within each group
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Filter: if mode === 'dir', only show directories
    const shown = _fpMode === 'dir' ? entries.filter(e => e.isDir) : entries;

    if (!shown.length) {
      list.innerHTML = '<div class="placeholder" style="padding:12px">Empty directory</div>';
      return;
    }

    list.innerHTML = shown.map(e => {
      const full = `${path}/${e.name}`.replace('//', '/');
      const safe = full.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      if (e.isDir) {
        return `<div class="fp-item fp-dir" onclick="_fpLoadDir('${safe}')"
                     ondblclick="document.getElementById('fp-selected').value='${safe}'; fpConfirm()">
          <span class="fp-item-icon">📁</span>
          <span class="fp-item-name">${e.name}</span>
        </div>`;
      } else {
        return `<div class="fp-item fp-file" onclick="document.getElementById('fp-selected').value='${safe}'">
          <span class="fp-item-icon">${_fpFileIcon(e.name)}</span>
          <span class="fp-item-name">${e.name}</span>
          <span class="fp-item-size">${e.size ? _fpFmtSize(e.size) : ''}</span>
        </div>`;
      }
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red);padding:12px">${e.message}</div>`;
  }
}

function _fpRenderBreadcrumb(path) {
  const bc = document.getElementById('fp-breadcrumb');
  if (!bc) return;
  const parts = path.replace(/\/$/, '').split('/').filter((p, i) => i === 0 || p);
  let accumulated = '';
  bc.innerHTML = '';
  parts.forEach((part, idx) => {
    accumulated = idx === 0 ? '/' : `${accumulated}/${part}`;
    const seg = accumulated;
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.className = 'fm-bc-sep'; sep.textContent = '/';
      bc.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.className   = 'fm-bc-part';
    btn.textContent = part === '' ? '/' : part;
    btn.onclick     = () => _fpLoadDir(seg);
    bc.appendChild(btn);
  });
}

function _fpFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map  = { sh: '⚡', yml: '⚙', yaml: '⚙', json: '{}', md: '📝', txt: '📄', py: '🐍', js: '🟨', ts: '🔷', log: '📋' };
  return map[ext] || '📄';
}

function _fpFmtSize(bytes) {
  if (!bytes) return '';
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes > 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes + ' B';
}

/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SNAPSHOTS
   ═══════════════════════════════════════════════════════ */

let snapSettingsOpen = false;

async function loadSnapshots() {
  const list = document.getElementById('snap-list');
  await snapLoadSettings();
  try {
    const data  = await apiFetch('/api/snapshots');
    if (data.warning) snapShowWarning(data.warning, 'info');
    const snaps = data.snapshots || [];
    if (!snaps.length) {
      list.innerHTML = '<div class="placeholder">No snapshots yet</div>'; return;
    }
    list.innerHTML = snaps.map(s => `
      <div class="snap-item fade-in">
        <div>
          <div class="snap-name">${s.name}</div>
          <div class="snap-date">${fmtDate(s.created)}${s.size ? ' · ' + fmtBytes(s.size) : ''}</div>
        </div>
        <div class="snap-actions">
          <button class="btn btn-sm btn-amber" onclick="restoreSnapshot('${s.name}')">↺ Restore</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

/* ── Settings ─────────────────────────────────────────── */
async function snapLoadSettings() {
  try {
    const s = await apiFetch('/api/snapshots/settings');
    document.getElementById('snap-dir').value            = s.snapshotDir    || '';
    document.getElementById('snap-script-create').value = s.snapshotScript || '';
    document.getElementById('snap-script-restore').value= s.restoreScript  || '';
    _snapRenderPaths(s.includePaths || []);

    // Show info if using tar fallback
    const hasScript = !!(s.snapshotScript);
    const hasPaths  = (s.includePaths || []).length > 0;
    if (!hasScript && hasPaths) {
      snapShowWarning('No script configured — using built-in tar fallback with the paths listed above.', 'info');
    } else if (!hasScript && !hasPaths) {
      snapShowWarning('Configure a snapshot script path or add paths to include for the built-in tar fallback.', 'warn');
    } else {
      document.getElementById('snap-warning').style.display = 'none';
    }
  } catch (e) {
    snapShowWarning(`Could not load settings: ${e.message}`, 'error');
  }
}

function _snapRenderPaths(paths) {
  const list = document.getElementById('snap-paths-list');
  if (!list) return;
  if (!paths.length) { list.innerHTML = ''; return; }
  list.innerHTML = paths.map((p, i) => `
    <div class="snap-path-row" id="snap-path-row-${i}">
      <input class="input snap-path-input" id="snap-path-${i}" value="${p.replace(/"/g,'&quot;')}" placeholder="/path/to/include">
      <button class="btn btn-xs btn-red" onclick="snapRemovePath(${i})">✕</button>
    </div>
  `).join('');
}

function snapAddPath() {
  const list = document.getElementById('snap-paths-list');
  if (!list) return;
  const idx = list.querySelectorAll('.snap-path-row').length;
  const row = document.createElement('div');
  row.className = 'snap-path-row';
  row.id = `snap-path-row-${idx}`;
  row.innerHTML = `
    <input class="input snap-path-input" id="snap-path-${idx}" placeholder="/path/to/include">
    <button class="btn btn-xs btn-red" onclick="snapRemovePath(${idx})">✕</button>
  `;
  list.appendChild(row);
  document.getElementById(`snap-path-${idx}`)?.focus();
}

function snapRemovePath(idx) {
  const row = document.getElementById(`snap-path-row-${idx}`);
  if (row) row.remove();
  // Re-index remaining rows
  const list = document.getElementById('snap-paths-list');
  if (!list) return;
  list.querySelectorAll('.snap-path-row').forEach((r, i) => {
    r.id = `snap-path-row-${i}`;
    const inp = r.querySelector('.snap-path-input');
    if (inp) inp.id = `snap-path-${i}`;
    const btn = r.querySelector('button');
    if (btn) btn.setAttribute('onclick', `snapRemovePath(${i})`);
  });
}

function _snapCollectPaths() {
  const list = document.getElementById('snap-paths-list');
  if (!list) return [];
  return [...list.querySelectorAll('.snap-path-input')]
    .map(inp => inp.value.trim())
    .filter(Boolean);
}

async function snapSaveSettings() {
  const status = document.getElementById('snap-settings-status');
  try {
    await apiFetch('/api/snapshots/settings', {
      method: 'POST',
      body: {
        snapshotDir:    document.getElementById('snap-dir').value.trim(),
        snapshotScript: document.getElementById('snap-script-create').value.trim(),
        restoreScript:  document.getElementById('snap-script-restore').value.trim(),
        includePaths:   _snapCollectPaths()
      }
    });
    setStatus(status, '✓ Saved', 'ok');
    setTimeout(() => setStatus(status, ''), 3000);
    await snapLoadSettings();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function snapToggleSettings() {
  snapSettingsOpen = !snapSettingsOpen;
  document.getElementById('snap-settings-body').style.display = snapSettingsOpen ? 'block' : 'none';
  document.getElementById('snap-settings-arrow').textContent  = snapSettingsOpen ? '▲' : '▼';
}

function snapShowWarning(msg, level) {
  const el = document.getElementById('snap-warning');
  el.textContent  = msg;
  el.className    = `snap-warning snap-warning-${level}`;
  el.style.display = 'block';
}

/* ── Create / Restore ─────────────────────────────────── */
function createSnapshot() {
  const label = document.getElementById('snap-label').value.trim();
  const out   = document.getElementById('snap-out');
  out.textContent   = 'Creating snapshot…\n';
  out.style.display = 'block';

  fetch('/api/snapshots/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  })
    .then(res => streamToEl(res, out, () => loadSnapshots()))
    .catch(e  => { out.textContent += `\nError: ${e.message}`; });
}

function restoreSnapshot(name) {
  appConfirm(`Restore snapshot: ${name}?\nThis will overwrite current config.`, () => {
    const out = document.getElementById('snap-out');
    out.textContent   = `Restoring ${name}…\n`;
    out.style.display = 'block';

    fetch('/api/snapshots/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
      .then(res => streamToEl(res, out, null))
      .catch(e  => { out.textContent += `\nError: ${e.message}`; });
  });
}

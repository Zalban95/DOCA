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
    document.getElementById('snap-include-paths').value = (s.includePaths || []).join('\n');

    // Warn if scripts don't look configured
    const missing = [];
    if (!s.snapshotScript) missing.push('snapshot script');
    if (!s.restoreScript)  missing.push('restore script');
    if (missing.length) {
      snapShowWarning(`Scripts not configured: ${missing.join(', ')}. Open Settings above to configure paths.`, 'warn');
    } else {
      document.getElementById('snap-warning').style.display = 'none';
    }
  } catch (e) {
    snapShowWarning(`Could not load settings: ${e.message}`, 'error');
  }
}

async function snapSaveSettings() {
  const status = document.getElementById('snap-settings-status');
  const rawPaths = document.getElementById('snap-include-paths').value;
  const includePaths = rawPaths.split('\n').map(p => p.trim()).filter(Boolean);
  try {
    await apiFetch('/api/snapshots/settings', {
      method: 'POST',
      body: {
        snapshotDir:    document.getElementById('snap-dir').value.trim(),
        snapshotScript: document.getElementById('snap-script-create').value.trim(),
        restoreScript:  document.getElementById('snap-script-restore').value.trim(),
        includePaths
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

/* ═══════════════════════════════════════════════════════
   Settings → General → Updates → Install from a file (modules/update-channel/from-file.js): a signed update file
   (doca-update-X.Y.Z.dupd) carried to a hive that cannot reach the update channel. Checked against this version's
   release keys and its sha256, staged beside the running version, and switched to once nothing runs — with the
   launcher's 90 s way back. A host's, and it asks for the password; in production and development alike.
   ═══════════════════════════════════════════════════════ */

/** The block under the Updates card's log; drawn by updateCheck() (updates.js). */
function _updateFileSlot() {
  let el = document.getElementById('update-file');
  if (el) return el;
  const log = document.getElementById('update-log');
  if (!log) return null;
  el = document.createElement('div');
  el.id = 'update-file';
  el.style.marginTop = '12px';
  log.after(el);
  return el;
}

async function updateFileDraw() {
  const el = _updateFileSlot();
  if (!el) return;
  if (typeof _settingsNoHost !== 'undefined' && _settingsNoHost) { el.innerHTML = ''; return; }
  let s = null;
  try { s = await apiFetch('/api/update/file'); } catch { /* drawn without what waits */ }
  const lines = [];
  if (s?.file) lines.push(s.file.error
    ? `<span style="color:var(--red)">${escHtml(s.file.tag)} from a file could not be switched to: ${escHtml(s.file.error)}</span>`
    : `<strong>${escHtml(s.file.tag)}</strong> from a file is staged${s.waiting ? ` — waiting for running work before switching: ${escHtml(s.waiting.on.join('; ') || 'nothing now')}` : ''}.`);
  if (s?.image) lines.push('This hive runs an image: its host installs an update file with <code>deploy/hive.sh update &lt;name&gt; --file &lt;file&gt;</code>.');
  el.innerHTML = `<div class="card-title" style="font-size:13px;margin-bottom:4px">Install from a file</div>
    <p class="desc">For a hive with no way to the update channel: the update file for a version (<code>doca-update-X.Y.Z.dupd</code>) from whoever supplies DOCA, on a USB stick or a share. It is checked against the project's release key before anything is unpacked, and switched to once nothing runs; if the new version does not answer within 90 s, DOCA goes back by itself.</p>
    ${lines.length ? `<div class="update-info">${lines.join('<br>')}</div>` : ''}
    <div class="form-row"><input type="file" id="update-file-input" accept=".dupd" class="input" style="width:auto"></div>
    <label style="display:inline-flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="update-file-older"> Go back to this version (when the file is older than the version running)</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn btn-sm" onclick="updateFileInstall()">Install from a file</button>
      ${s?.file && !s.file.error ? '<button class="btn btn-sm" onclick="updateFileCancel()">Call it off</button>' : ''}
    </div>
    <span class="status-line" id="update-file-status"></span>`;
}

async function updateFileInstall() {
  const st = document.getElementById('update-file-status');
  const file = document.getElementById('update-file-input')?.files?.[0];
  if (!file) return setStatus(st, 'Choose the update file first.', 'err');
  const older = document.getElementById('update-file-older')?.checked;
  const password = await new Promise(resolve => appPrompt('Installing a version of DOCA asks for your password. Your password:', v => resolve(v || null), '', { secret: true, onCancel: () => resolve(null) }));
  if (!password) return;
  setStatus(st, `Checking and preparing ${file.name}…`, '', { clear: 0 });
  try {
    const r = await fetch(`/api/update/file${older ? '?older=1' : ''}`, { method: 'POST', body: file,
      headers: { 'Content-Type': 'application/octet-stream', 'X-Doca-Password': password } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    setStatus(st, d.waiting ? `✓ ${d.file.tag} is staged; it is switched to once nothing runs.` : `✓ ${d.file?.tag || 'The version'} is staged; switching now.`, 'ok', { clear: 0 });
    setTimeout(updateFileDraw, 1500);
  } catch (e) { setStatus(document.getElementById('update-file-status'), `✗ ${e.message}`, 'err', { clear: 0 }); }
}

async function updateFileCancel() {
  try { await apiFetch('/api/update/file/cancel', { method: 'POST' }); await updateFileDraw(); }
  catch (e) { setStatus(document.getElementById('update-file-status'), `✗ ${e.message}`, 'err'); }
}

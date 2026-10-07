/* ═══════════════════════════════════════════════════════
   Settings → Backups → On a schedule (modules/backup/schedule.js):
   off, daily or weekly at a time, keeping the last N automatic backups.
   Built from the same pieces as the Backups card above it.
   ═══════════════════════════════════════════════════════ */

function _backupScheduleCard() {
  let card = document.getElementById('backup-schedule-card');
  if (card) return card;
  const panel = document.getElementById('sp-backups');
  if (!panel) return null;
  card = document.createElement('div');
  card.className = 'card';
  card.id = 'backup-schedule-card';
  card.innerHTML = `
    <div class="card-title">On a schedule</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:12px">
      Scheduled backups are named <code>auto-…</code>, and only those are removed to keep the last few —
      backups made by hand, uploaded, or made before a restore are never touched.
    </p>
    <div class="row form-row" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="field"><div class="input-label">How often</div>
        <select class="input" id="bsched-every" style="width:auto">
          <option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
        </select></div>
      <div class="field"><div class="input-label">At</div>
        <input class="input" type="time" id="bsched-at" style="width:auto"></div>
      <div class="field"><div class="input-label">Keep the last</div>
        <input class="input" type="number" id="bsched-keep" min="1" max="365" step="1" style="width:90px"></div>
      <div class="field"><button class="btn btn-sm btn-blue" onclick="backupScheduleSave()">Save</button></div>
    </div>
    <div class="input-label" id="bsched-info" style="text-transform:none;letter-spacing:0;margin-top:4px"></div>
    <span class="status-line" id="bsched-status"></span>`;
  panel.appendChild(card);
  return card;
}

/** Drawn by backupsLoad() with what /api/backups returned. */
function backupScheduleRender(sch, settings) {
  if (!sch || !_backupScheduleCard()) return;
  document.getElementById('bsched-every').value = sch.every;
  document.getElementById('bsched-at').value = sch.at;
  document.getElementById('bsched-keep').value = sch.keep;
  const info = document.getElementById('bsched-info');
  const parts = [];
  if (sch.every !== 'off' && sch.nextAt) parts.push(`Next: ${fmtDate(sch.nextAt)}.`);
  if (sch.lastAt) parts.push(`Last: ${fmtDate(sch.lastAt)} (${sch.lastName}).`);
  const noPassword = sch.every !== 'off' && settings?.encrypt && !settings.hasSavedPassword;
  if (noPassword) parts.push('Backups are password-protected and none is saved, so scheduled ones cannot be made — save one above.');
  info.textContent = parts.join(' ');
  info.style.color = noPassword ? 'var(--amber)' : '';
  if (sch.lastError && (!sch.lastAt || sch.lastTriedAt > sch.lastAt)) {
    info.textContent += ` The last attempt (${fmtDate(sch.lastTriedAt)}) failed: ${sch.lastError}`;
    info.style.color = 'var(--red)';
  }
}

async function backupScheduleSave() {
  const st = document.getElementById('bsched-status');
  const body = {
    every: document.getElementById('bsched-every').value,
    at:    document.getElementById('bsched-at').value,
    keep:  parseInt(document.getElementById('bsched-keep').value, 10),
  };
  try {
    const sch = await apiFetch('/api/backups/schedule', { method: 'POST', body });
    backupScheduleRender(sch, _backups?.settings);
    setStatus(st, sch.every === 'off' ? '✓ Scheduled backups are off' : `✓ ${sch.every === 'daily' ? 'Daily' : 'Weekly'} at ${sch.at}, keeping ${sch.keep}`, 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/* ── Off-site copy (modules/backup/remote.js): each scheduled backup also goes to an S3-compatible bucket ── */

function _backupRemoteCard() {
  let card = document.getElementById('backup-remote-card');
  if (card) return card;
  const panel = document.getElementById('sp-backups');
  if (!panel) return null;
  card = document.createElement('div');
  card.className = 'card';
  card.id = 'backup-remote-card';
  card.innerHTML = `
    <div class="card-title">Off-site copy</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:12px">
      Each scheduled backup is also sent to a bucket on any S3-compatible store — AWS S3, Backblaze B2, Cloudflare R2,
      Hetzner, Wasabi, MinIO — and only the last few <code>auto-…</code> files are kept there. The keys stay on this machine.
    </p>
    <div class="row form-row" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="field" style="flex:2;min-width:220px"><div class="input-label">Endpoint</div>
        <input class="input" id="bremote-endpoint" placeholder="https://s3.eu-central-1.amazonaws.com"></div>
      <div class="field"><div class="input-label">Region</div><input class="input" id="bremote-region" style="width:130px"></div>
      <div class="field"><div class="input-label">Bucket</div><input class="input" id="bremote-bucket" style="width:160px"></div>
      <div class="field"><div class="input-label">Folder</div><input class="input" id="bremote-prefix" style="width:110px"></div>
      <div class="field"><div class="input-label">Keep the last</div>
        <input class="input" type="number" id="bremote-keep" min="1" max="365" step="1" style="width:90px"></div>
    </div>
    <div class="row form-row" style="flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:8px">
      <div class="field"><div class="input-label">Access key id</div><input class="input" id="bremote-akid" autocomplete="off" style="width:200px"></div>
      <div class="field"><div class="input-label">Secret</div><input class="input" type="password" id="bremote-secret" autocomplete="new-password" style="width:220px"></div>
      <label class="input-label" style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0">
        <input type="checkbox" id="bremote-enc"> only password-protected backups</label>
      <label class="input-label" style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0">
        <input type="checkbox" id="bremote-on"> Send backups off-site</label>
      <div class="field"><button class="btn btn-sm btn-blue" onclick="backupRemoteSave()">Save</button></div>
      <div class="field"><button class="btn btn-sm" onclick="backupRemoteTest()">Test</button></div>
    </div>
    <div class="input-label" id="bremote-info" style="text-transform:none;letter-spacing:0;margin-top:4px"></div>
    <span class="status-line" id="bremote-status"></span>`;
  panel.appendChild(card);
  return card;
}

async function backupRemoteRender(sch) {
  if (!_backupRemoteCard()) return;
  let r;
  try { r = await apiFetch('/api/backups/remote'); } catch { return; }
  const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
  set('bremote-endpoint', r.endpoint); set('bremote-region', r.region); set('bremote-bucket', r.bucket);
  set('bremote-prefix', r.prefix); set('bremote-keep', r.keep);
  document.getElementById('bremote-enc').checked = !!r.encryptedOnly;
  document.getElementById('bremote-on').checked = !!r.enabled;
  document.getElementById('bremote-akid').placeholder = r.hasKeys ? 'saved — type to replace' : '';
  document.getElementById('bremote-secret').placeholder = r.hasKeys ? 'saved' : '';
  const info = document.getElementById('bremote-info');
  info.textContent = sch?.remoteAt ? `Last sent: ${fmtDate(sch.remoteAt)} (${sch.remoteKey}).` : r.enabled ? 'Nothing sent yet: the next scheduled backup will be.' : '';
  info.style.color = '';
  if (sch?.remoteError && (!sch.remoteAt || sch.remoteTriedAt > sch.remoteAt)) { info.textContent += ` The last attempt failed: ${sch.remoteError}`; info.style.color = 'var(--red)'; }
}

async function backupRemoteSave() {
  const st = document.getElementById('bremote-status');
  const v = id => document.getElementById(id).value.trim();
  const body = { endpoint: v('bremote-endpoint'), region: v('bremote-region'), bucket: v('bremote-bucket'), prefix: v('bremote-prefix'),
    keep: parseInt(v('bremote-keep'), 10), encryptedOnly: document.getElementById('bremote-enc').checked, enabled: document.getElementById('bremote-on').checked };
  if (v('bremote-akid') || v('bremote-secret')) { body.accessKeyId = v('bremote-akid'); body.secretAccessKey = document.getElementById('bremote-secret').value; }
  try {
    await apiFetch('/api/backups/remote', { method: 'POST', body });
    document.getElementById('bremote-akid').value = ''; document.getElementById('bremote-secret').value = '';
    setStatus(st, '✓ Saved', 'ok');
    backupRemoteRender(_backups?.schedule);
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function backupRemoteTest() {
  const st = document.getElementById('bremote-status');
  setStatus(st, 'Writing a small file there and removing it…', 'info');
  try { await apiFetch('/api/backups/remote/test', { method: 'POST' }); setStatus(st, '✓ The bucket takes files: written, listed and removed', 'ok'); }
  catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

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
    <p class="desc" style="margin-bottom:12px">Backups made by themselves, at a time you choose. Only these are ever removed to keep the last few — backups made by hand, uploaded, or made before a restore are never touched.</p>
    <div class="row form-row" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="field"><div class="input-label">How often${infoBtn('Off (the default) makes none. Daily makes one every day at the time beside it; weekly one a week after the last. Scheduled backups are named auto-….')}</div>
        <select class="input" id="bsched-every" style="width:auto">
          <option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
        </select></div>
      <div class="field"><div class="input-label">At${infoBtn('The time of day, on this machine\'s clock, when a scheduled backup is made. Default 03:00.')}</div>
        <input class="input" type="time" id="bsched-at" style="width:auto"></div>
      <div class="field"><div class="input-label">Keep the last${infoBtn('How many scheduled backups to keep (1–365, default 7). When a new one is made, older auto-… backups beyond this number are deleted.')}</div>
        <input class="input" type="number" id="bsched-keep" min="1" max="365" step="1" style="width:90px"></div>
      <div class="field" style="flex:0 0 auto"><button class="btn btn-sm btn-blue" onclick="backupScheduleSave()">Save</button></div>
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
    <p class="desc" style="margin-bottom:6px">Also send each scheduled backup to cloud storage, so a lost machine is not a lost backup.</p>
    <details class="desc page-about" style="margin-bottom:12px"><summary>What this is</summary>
      Each scheduled backup is also sent to a bucket on any S3-compatible store — AWS S3, Backblaze B2, Cloudflare R2,
      Hetzner, Wasabi, MinIO — and only the last few <code>auto-…</code> files are kept there. The keys stay on this machine.
      Backups made by hand are not sent.</details>
    <div class="settings-tab-row">
      <label class="skill-toggle"><input type="checkbox" id="bremote-on" aria-label="Send backups off-site"><span class="skill-toggle-track"></span></label>
      <span class="settings-tab-label">Send backups off-site${infoBtn('When on (and saved), every scheduled backup is uploaded to the bucket below after it is made. Off by default. It needs a schedule above to send anything.')}</span>
    </div>
    <div class="row form-row" style="flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:8px">
      <div class="field" style="flex:2 1 220px"><div class="input-label">Endpoint${infoBtn('The address of the storage service, as its provider gives it — for AWS e.g. https://s3.eu-central-1.amazonaws.com, for Backblaze B2 its S3 endpoint.')}</div>
        <input class="input" id="bremote-endpoint" placeholder="https://s3.eu-central-1.amazonaws.com"></div>
      <div class="field"><div class="input-label">Bucket${infoBtn('The name of the bucket (the storage folder you made at the provider) the backups go into.')}</div><input class="input" id="bremote-bucket"></div>
    </div>
    <div class="row form-row" style="flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:8px">
      <div class="field"><div class="input-label">Access key id${infoBtn('The key pair\'s public half, made at the storage provider for this bucket. Once saved it is kept on this machine only and never shown again; leave empty to keep the saved one.')}</div><input class="input" id="bremote-akid" autocomplete="off"></div>
      <div class="field"><div class="input-label">Secret${infoBtn('The key pair\'s secret half. Saved with the access key id, kept on this machine only, never shown again; leave empty to keep the saved one.')}</div><input class="input" type="password" id="bremote-secret" autocomplete="new-password"></div>
    </div>
    ${advancedFold(`<div class="row form-row" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="field"><div class="input-label">Region${infoBtn('The storage region the bucket is in, used to sign each request. Default us-east-1; many non-AWS stores accept any value.')}</div><input class="input" id="bremote-region" data-default="us-east-1" data-label="Region"></div>
      <div class="field"><div class="input-label">Folder${infoBtn('A folder (prefix) inside the bucket the backups are put under. Default doca/. Only auto-… files under it are ever removed.')}</div><input class="input" id="bremote-prefix" data-default="doca/" data-label="Folder"></div>
      <div class="field"><div class="input-label">Keep the last${infoBtn('How many scheduled backups to keep in the bucket (1–365, default 14). Older auto-… files there are deleted after each upload.')}</div>
        <input class="input" type="number" id="bremote-keep" data-default="14" data-label="Keep the last" min="1" max="365" step="1"></div></div>
      <div class="settings-tab-row" style="margin-top:8px">
        <label class="skill-toggle"><input type="checkbox" id="bremote-enc" data-default="true" data-label="Only password-protected backups" aria-label="Only password-protected backups"><span class="skill-toggle-track"></span></label>
        <span class="settings-tab-label">Only password-protected backups${infoBtn('On by default: a backup that is not password-protected is not sent, so your keys never leave this machine readable. Turn off to send open backups too.')}</span></div>`,
      { id: 'backup-remote', label: 'Advanced — region, folder, how many, which backups' })}
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-sm btn-blue" onclick="backupRemoteSave()">Save</button>
      <button class="btn btn-sm" onclick="backupRemoteTest()" title="Write a small file to the bucket and remove it">Test</button>
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
  advancedFoldRefresh(document.getElementById('backup-remote-card'));   // filled here, not typed: read the marks again
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
  // Switching it on, or giving keys, needs somewhere to send to; an empty form with the switch off just saves "off".
  const using = document.getElementById('bremote-on').checked || v('bremote-akid') || v('bremote-secret');
  if (using && !v('bremote-endpoint')) return askFor(document.getElementById('bremote-endpoint'), 'Give the store\'s address first, e.g. https://s3.eu-central-1.amazonaws.com.');
  if (using && !v('bremote-bucket')) return askFor(document.getElementById('bremote-bucket'), 'Give the bucket\'s name.');
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

/* ── A second copy (modules/backup/mirror.js): every backup also copied to a folder on another disk ── */

function backupMirrorRender(m) {
  const panel = document.getElementById('sp-backups');
  if (!panel || !m || hostedHive()) return;
  let card = document.getElementById('backup-mirror-card');
  if (!card) { card = Object.assign(document.createElement('div'), { className: 'card', id: 'backup-mirror-card' }); panel.appendChild(card); }
  const when = m.lastError && (!m.lastAt || m.lastTriedAt > m.lastAt)
    ? `<span style="color:var(--red)">The last copy (${fmtDate(m.lastTriedAt)}) failed: ${escHtml(m.lastError)}</span>`
    : m.lastAt ? `Last copied: ${escHtml(m.lastName)}, ${fmtDate(m.lastAt)}.` : '';
  card.innerHTML = `<div class="card-title">A second copy</div>
    <p class="desc" style="margin-bottom:10px">Also copy every backup to another folder — another disk, or a network share mounted on this machine.</p>
    <div class="field"><label class="input-label" for="bmirror-dir">Folder${infoBtn('Where the copies go. Empty (the default) means no second copy. It keeps as many scheduled backups there as here. A copy that fails is said here and as a notice; the backup itself still counts.')}</label>
      <div style="display:flex;gap:8px;align-items:center"><input id="bmirror-dir" data-path-pick="dir" class="input flex1" style="min-width:0" value="${escHtml(m.dir || '')}" placeholder="/mnt/nas/doca-backups"></div></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-sm btn-blue" onclick="backupMirrorSave()">Save</button></div>
    <div class="input-label" style="text-transform:none;letter-spacing:0;margin-top:4px">${when}</div>
    <span class="status-line" id="bmirror-status"></span>`;
}

async function backupMirrorSave() {
  const st = document.getElementById('bmirror-status');
  try {
    const m = await apiFetch('/api/backups/mirror', { method: 'POST', body: { dir: document.getElementById('bmirror-dir').value } });
    backupMirrorRender(m);
    setStatus(document.getElementById('bmirror-status'), m.dir ? `✓ Every backup is also copied to ${m.dir}` : '✓ No second copy', 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

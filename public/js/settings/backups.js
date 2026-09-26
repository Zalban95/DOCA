/* ═══════════════════════════════════════════════════════
   Settings → Backups: backups (.dBac) — make, download, upload, restore.
   Built from the same pieces as the rest of the panel: the Snapshots list rows,
   the Start-at-Boot toggle, .input fields under .input-label.
   ═══════════════════════════════════════════════════════ */

let _backups = null;

/** The card, drawn into Settings → Backups the first time it opens. */
function _backupsCard() {
  let card = document.getElementById('backups-card');
  if (card) return card;
  const panel = document.getElementById('sp-backups');
  if (!panel) return null;
  card = document.createElement('div');
  card.className = 'card';
  card.id = 'backups-card';
  card.innerHTML = `
    <div class="card-title" style="display:flex;align-items:center;gap:8px">
      Backups
      <button class="btn btn-xs btn-teal" id="backup-create-btn" onclick="backupCreate()" title="Back up everything now">⬇ Back up now</button>
      <button class="btn btn-xs" onclick="document.getElementById('backup-upload').click()" title="Add a .dBac from another machine">⬆ Upload</button>
      <input type="file" id="backup-upload" accept=".dBac" hidden onchange="backupUpload(this)">
    </div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:12px" id="backup-summary">
      Everything in one <code>.dBac</code> file: conversations, memory, devices, settings, API keys,
      specialist definitions and attachments. A restore checks every file before it replaces anything,
      and backs up the current state first.
    </p>
    <div class="settings-tab-row">
      <label class="skill-toggle">
        <input type="checkbox" id="backup-encrypt" onchange="backupEncrypt(this)">
        <span class="skill-toggle-track"></span>
      </label>
      <span class="settings-tab-label">Protect backups with a password (AES-256)</span>
    </div>
    <p id="backup-open-warning" style="display:none;font-size:11px;color:var(--amber);margin:6px 0 10px">
      Open backups carry every API key, token and private conversation in the clear. Whoever has
      the file has all of it — where it goes is your responsibility.
    </p>
    <div class="field" id="backup-password-row" style="margin-top:10px">
      <label class="input-label" for="backup-password" style="display:block">Saved password</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="input flex1" type="password" id="backup-password" autocomplete="new-password" style="min-width:0">
        <button class="btn btn-xs" onclick="backupPasswordSave()">Save</button>
        <button class="btn btn-xs" id="backup-forget-btn" onclick="backupPasswordForget()">Forget</button>
      </div>
      <p style="font-size:11px;color:var(--muted);margin:6px 0 0">
        Optional — without one you are asked each time. Kept in its own file on this machine and never
        shown again. The agent's file tools cannot read it; its shell runs as the same user and could.
        A lost password is a lost backup: nobody can open it without one.
      </p>
    </div>
    <span class="status-line" id="backup-status"></span>
    <div id="backup-list" style="margin-top:10px"></div>
    <pre id="backup-log" class="code-out" style="display:none;max-height:min(45vh,360px);overflow:auto;font-size:11px;margin-top:8px"></pre>`;
  panel.appendChild(card);
  return card;
}

async function backupsLoad() {
  if (!_backupsCard()) return;
  const list = document.getElementById('backup-list');
  try {
    _backups = await apiFetch('/api/backups');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
    return;
  }
  const s = _backups.settings;
  document.getElementById('backup-encrypt').checked = s.encrypt;
  document.getElementById('backup-open-warning').style.display = s.encrypt ? 'none' : 'block';
  document.getElementById('backup-password-row').style.display = s.encrypt ? '' : 'none';
  const pw = document.getElementById('backup-password');
  pw.value = '';
  pw.placeholder = s.hasSavedPassword ? '•••••••• saved — type a new one to replace it' : 'none saved — you will be asked each time';
  document.getElementById('backup-forget-btn').disabled = !s.hasSavedPassword;

  if (typeof backupScheduleRender === 'function') backupScheduleRender(_backups.schedule, s);

  const est = _backups.estimate;
  document.getElementById('backup-summary').title = `About ${est.files} files, ${fmtBytes(est.bytes)} before compression · saved in ${_backups.dir}`;

  list.innerHTML = _backups.backups.length ? _backups.backups.map(b => `
    <div class="snap-item fade-in">
      <div style="min-width:0">
        <div class="snap-name" style="overflow-wrap:anywhere">${b.encrypted ? '🔒 ' : b.encrypted === false ? '🔓 ' : ''}${escHtml(b.name)}</div>
        <div class="snap-date">${fmtDate(b.at)} · ${fmtBytes(b.bytes)}${b.files != null ? ` · ${b.files} files` : ''}${b.valid ? '' : ' · not readable'}</div>
      </div>
      <div class="snap-actions">
        <a class="btn btn-sm" href="/api/backups/${encodeURIComponent(b.name)}/download" download title="Download">⬇</a>
        <button class="btn btn-sm btn-amber" onclick="backupRestore(${jsArg(b.name)}, ${b.encrypted ? 'true' : 'false'})">↺ Restore</button>
        <button class="btn btn-sm" onclick="backupDelete(${jsArg(b.name)})" title="Delete">✕</button>
      </div>
    </div>`).join('') : '<div class="placeholder">No backups yet</div>';
}

function backupEncrypt(box) {
  const on = box.checked;
  const apply = async () => {
    try { await apiFetch('/api/backups/settings', { method: 'POST', body: { encrypt: on } }); }
    catch (e) { setStatus(document.getElementById('backup-status'), `✗ ${e.message}`, 'err'); }
    backupsLoad();
  };
  if (on) return apply();
  box.checked = true;   // stay protected until the user has read what open means
  appConfirm('Make backups without a password?\n\nEvery API key, token and private conversation will be in the file in the clear. '
    + 'Whoever has the file has all of it, and keeping it safe is your responsibility.', () => { box.checked = false; apply(); });
}

async function backupPasswordSave() {
  const input = document.getElementById('backup-password');
  const st = document.getElementById('backup-status');
  try {
    await apiFetch('/api/backups/settings', { method: 'POST', body: { password: input.value } });
    input.value = '';
    setStatus(st, '✓ Password saved. Backups will use it unless you type another.', 'ok');
    backupsLoad();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

function backupPasswordForget() {
  appConfirm('Forget the saved backup password?\n\nExisting backups still need it to be opened — keep it somewhere safe if you have not.', async () => {
    await apiFetch('/api/backups/settings', { method: 'POST', body: { forget: true } }).catch(() => {});
    setStatus(document.getElementById('backup-status'), 'Saved password forgotten.', 'ok');
    backupsLoad();
  });
}

async function backupCreate() {
  const s = _backups?.settings;
  const st = document.getElementById('backup-status');
  const run = async password => {
    const btn = document.getElementById('backup-create-btn');
    if (btn) btn.disabled = true;
    setStatus(st, 'Backing up…', '', { clear: 0 });
    try {
      const b = await apiFetch('/api/backups', { method: 'POST', body: password ? { password } : {} });
      setStatus(st, `✓ ${b.name} — ${b.files} files, ${fmtBytes(b.bytes)}${b.encrypted ? ', encrypted' : ', not encrypted'}`, 'ok');
      backupsLoad();
    } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
    if (btn) btn.disabled = false;
  };
  if (s?.encrypt && !s.hasSavedPassword)
    return appPrompt('Password for this backup (at least 8 characters). Without it the backup cannot be opened.', run, '', { secret: true });
  run(null);
}

async function backupUpload(input) {
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  const st = document.getElementById('backup-status');
  setStatus(st, `Uploading ${f.name}…`, '', { clear: 0 });
  try {
    const r = await fetch(`/api/backups/upload?name=${encodeURIComponent(f.name)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.statusText);
    setStatus(st, `✓ ${d.name} added — restore it from the list.`, 'ok');
    backupsLoad();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

function backupDelete(name) {
  appConfirm(`Delete ${name}? This cannot be undone.`, async () => {
    try { await apiFetch(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }); }
    catch (e) { setStatus(document.getElementById('backup-status'), `✗ ${e.message}`, 'err'); }
    backupsLoad();
  });
}

/** Read what a restore would do, confirm it with the user, then restore and follow the restart. */
function backupRestore(name, encrypted) {
  const st = document.getElementById('backup-status');
  const withPassword = async password => {
    let plan;
    try {
      plan = await apiFetch(`/api/backups/${encodeURIComponent(name)}/plan`, { method: 'POST', body: { password } });
    } catch (e) { return setStatus(st, `✗ ${e.message}`, 'err'); }
    if (plan.problem) return setStatus(st, `✗ ${plan.problem}`, 'err', { clear: 0 });
    const what = plan.sections.map(s => `• ${s.what}`).join('\n');
    appConfirm(`Restore ${name}?\n\nMade by DOCA ${plan.appVersion} on ${plan.host}, ${fmtDate(plan.createdAt)} — ${plan.files} files.\n\n`
      + `This replaces:\n${what}\n\nThe current state is backed up first, and DOCA restarts.`, async () => {
      const log = document.getElementById('backup-log');
      showStream(log, '');
      let result = null;
      await sseStream(`/api/backups/${encodeURIComponent(name)}/restore`, { password }, {
        onStatus: text => appendStream(log, text),
        onDone:   o => { result = o; },
        onError:  e => appendStream(log, `\n✗ ${e.message}\n`),
      });
      if (!result?.ok) return setStatus(st, '✗ Nothing was replaced — see the log above.', 'err', { clear: 0 });
      setStatus(st, 'Restored. Restarting DOCA…', '', { clear: 0 });
      const started = Date.now();
      const poll = () => setTimeout(async () => {
        try { if ((await fetch('/api/update-check', { cache: 'no-store' })).ok && Date.now() - started > 4000) return location.reload(); } catch {}
        if (Date.now() - started < 150000) poll();
        else setStatus(st, '✗ DOCA did not come back within 150 s. On the host: ./run.sh versions', 'err', { clear: 0 });
      }, 2000);
      poll();
    });
  };
  if (!encrypted) return withPassword(null);
  appPrompt(`Password for ${name}:`, withPassword, '', { secret: true });
}

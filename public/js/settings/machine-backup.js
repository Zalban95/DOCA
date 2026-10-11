/* ═══════════════════════════════════════════════════════
   Settings → Backups → This machine's files (modules/machine-backup): the person's own folders backed up with restic
   to another disk, a NAS or a USB disk — where, what, when, the password made once. The history, a day's files and
   bringing a backup back are machine-backup-history.js.
   ═══════════════════════════════════════════════════════ */

const MB = { s: null, chips: [], poll: null };

/** The product's name as this install shows it (branding), never written into the page. */
function _mbBrand() { return (typeof BRAND !== 'undefined' && BRAND?.product) || document.querySelector('[data-brand]')?.textContent?.trim() || 'the hub'; }

function _mbCard() {
  let card = document.getElementById('mb-card');
  if (card) return card;
  const panel = document.getElementById('sp-backups');
  if (!panel) return null;
  card = document.createElement('div');
  card.className = 'card';
  card.id = 'mb-card';
  card.innerHTML = `
    <div class="card-title mb-head"><span>This machine's files</span>
      <span class="mb-head-acts">
        <label class="mb-switch"><input type="checkbox" class="switch" id="mb-enabled" onchange="mbEnable(this)" aria-label="Back up every day"> Every day${infoBtn('On: your folders are backed up every day at the time below, and a missed day runs as soon as the destination can be reached again. Off (the default): nothing runs by itself; Back up now still works once it is set up.')}</label>
        <button class="btn btn-sm btn-primary" id="mb-now" onclick="mbRunNow()">Back up now</button>
      </span></div>
    <p class="desc">Your own folders — documents, pictures, projects, settings — copied to another disk, a NAS or a USB disk. Only what changed is stored, locked with a password, and a week of daily copies is kept. On a fresh install of any system, they come back from here.</p>
    <details class="desc page-about"><summary>What this is</summary>
      ${_mbBrand()}'s own data is backed up above; this is the rest of this machine. It is done by restic, a free program that works the same on Linux, macOS and Windows:
      each day only what changed is stored, everything is encrypted with a password, and the same backup opens on any system — so a new machine gets your files back.
      You can also open it with restic by hand, without ${_mbBrand()}. It is a history of your files, not a mirror of your disks: for disk redundancy use a NAS or RAID.</details>
    <div id="mb-restic"></div>
    <div id="mb-reveal" class="mb-reveal" hidden></div>
    <div id="mb-progress" class="mb-progress"></div>
    <div id="mb-history"></div>
    <div class="mb-sec">
      <div class="input-label">Where${infoBtn('A folder on another disk, a NAS mount or a USB disk. It is checked now: reachable, its free space, and — for a disk that comes and goes — whether it is mounted, so nothing is ever written into an empty mount point.')}</div>
      <div class="mb-row"><input class="input flex1" id="mb-repo" data-path-pick="dir" placeholder="/media/you/Backup/this-machine" aria-label="Where the backup goes" oninput="mbDestHint()"></div>
      <div class="mb-dest" id="mb-dest"></div>
      <div class="mb-row mb-wrap" id="mb-setup-acts"></div>
      <div id="mb-bring"></div>
      ${advancedFold(`<div class="field"><div class="input-label">Keys for an address${infoBtn('Only for a restic address instead of a folder: s3: (an access key id and secret), b2: (account id and key), rest: (user and password), azure: (account name and key). sftp: uses this machine\'s SSH keys. They are kept in the protected keys folder, never shown again.')}</div>
        <div class="mb-row mb-wrap"><input class="input flex1" id="mb-key-id" autocomplete="off" placeholder="key id / user" aria-label="Key id"><input class="input flex1" type="password" id="mb-key-secret" autocomplete="new-password" placeholder="secret" aria-label="Key secret">
        <button class="btn btn-sm" onclick="mbSaveKeys()">Keep keys</button></div></div>`, { id: 'mb-where-adv' })}
    </div>
    <div class="mb-sec">
      <div class="input-label">What${infoBtn('The folders backed up. Those suggested for this system are ticked where they exist; untick one to leave it out, ✎ to change its path, ＋ to add any folder. Caches, downloads, dependency folders, model weights and VM disks are left out wherever they are found (Advanced).')}</div>
      <div class="mb-chips" id="mb-chips"></div>
      <button class="btn btn-xs" onclick="mbAddFolder()">＋ a folder</button>
      ${advancedFold(`<div class="field"><label class="input-label" for="mb-exclude">Left out${infoBtn('One pattern per line, left out wherever it is found (restic --exclude): a name (node_modules), a pattern (*.gguf), or a path from the top. Folders holding a CACHEDIR.TAG are left out too.')}</label>
        <textarea class="input mb-exclude" id="mb-exclude" rows="6" spellcheck="false"></textarea></div>`, { id: 'mb-what-adv' })}
    </div>
    <div class="mb-sec">
      <div class="input-label">When${infoBtn('Every day at this time, on this machine\'s clock (03:00 by default).')}</div>
      <div class="mb-row mb-wrap">
        <input class="input mb-time" type="time" id="mb-at" aria-label="Time of day" data-default="03:00">
        <label class="mb-switch"><input type="checkbox" class="switch" id="mb-catchup" data-default="true"> and whenever the destination comes back${infoBtn('A day missed because the disk was unplugged or the machine was off runs as soon as the destination can be reached again — checked every 10 minutes, like a sync folder.')}</label>
      </div>
      <div class="mb-row mb-wrap"><label class="input-label mb-inline" for="mb-keep-daily">Keep${infoBtn('How many daily copies are kept: 7 is a week of differences at 24 hours apart. Older ones are removed after each backup.')}</label>
        <input class="input mb-num" type="number" min="1" max="366" id="mb-keep-daily" data-default="7"> <span class="desc">daily copies</span></div>
      ${advancedFold(`<div class="mb-row mb-wrap"><label class="input-label mb-inline" for="mb-keep-weekly">Weekly${infoBtn('How many weeks back one copy a week is also kept. 0 (the default): none beyond the daily ones.')}</label>
        <input class="input mb-num" type="number" min="0" max="520" id="mb-keep-weekly" data-default="0">
        <label class="input-label mb-inline" for="mb-keep-monthly">Monthly${infoBtn('How many months back one copy a month is also kept. 0 (the default): none.')}</label>
        <input class="input mb-num" type="number" min="0" max="240" id="mb-keep-monthly" data-default="0"></div>`, { id: 'mb-when-adv' })}
    </div>
    <div class="mb-row mb-wrap"><button class="btn btn-sm btn-blue" onclick="mbSave()">Save</button><span class="status-line" id="mb-status"></span></div>`;
  panel.appendChild(card);
  return card;
}

async function machineBackupLoad() {
  if (!_mbCard()) return;
  try { MB.s = await apiFetch('/api/machine-backup'); }
  catch (e) { document.getElementById('mb-progress').innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  _mbRender();
  if (typeof mbHistoryLoad === 'function' && MB.s.setUp) await mbHistoryLoad();
  else if (typeof mbHistoryEmpty === 'function') mbHistoryEmpty();
  // Set-up's "Bring back a machine backup" lands here with the form open.
  if (MB.bring && typeof mbBringStart === 'function') { MB.bring = false; mbBringStart(); document.getElementById('mb-bring')?.scrollIntoView({ block: 'center' }); }
}

function _mbRender() {
  const s = MB.s, c = s.config;
  document.getElementById('mb-enabled').checked = c.enabled;
  const now = document.getElementById('mb-now');
  now.disabled = !s.setUp || !!s.running || !s.restic.found;
  now.title = !s.restic.found ? 'Install restic first' : !s.setUp ? 'Set it up first: choose where it goes' : s.running ? 'A backup is running' : 'Back up the chosen folders now';
  document.getElementById('mb-restic').innerHTML = s.restic.found ? '' : `<div class="mb-missing">
    <span>restic is not installed on this machine — it does the copying (free, one program).</span>
    <button class="btn btn-sm btn-primary" onclick="mbInstallRestic()">Install restic</button>
    <pre class="code-out mb-out" id="mb-install-out" hidden></pre></div>`;
  const repo = document.getElementById('mb-repo');
  if (document.activeElement !== repo) repo.value = c.repo || '';
  repo.readOnly = s.setUp && !MB.changing;
  _mbDest(s.destination);
  document.getElementById('mb-setup-acts').innerHTML = s.setUp && !MB.changing
    ? `<span class="desc">Set up — the password is kept on this machine.</span>
       <button class="btn btn-xs" onclick="mbChangePassword()">New password</button>
       <button class="btn btn-xs" onclick="mbChangePlace()">Another place</button>`
    : `<button class="btn btn-sm btn-primary" onclick="mbSetUp()"${s.restic.found ? '' : ' disabled title="Install restic first"'}>Set it up here</button>
       <button class="btn btn-sm" onclick="mbBringStart()"${s.restic.found ? '' : ' disabled title="Install restic first"'}>Bring back a machine backup</button>`;
  // What: the suggestions, then folders the person added; ticked as saved (or, never saved, where they exist).
  const saved = c.folders || [];
  MB.chips = s.suggestions.map(x => ({ ...x, on: saved.length ? saved.includes(x.path) : x.on }));
  for (const p of saved) if (!MB.chips.some(x => x.path === p)) MB.chips.push({ path: p, label: p.split(/[\\/]/).filter(Boolean).pop() || p, role: 'custom', exists: true, on: true, custom: true });
  _mbChips();
  const ex = document.getElementById('mb-exclude');
  ex.value = (c.exclude || []).join('\n');
  ex.dataset.default = (s.excludeDefault || c.exclude || []).join('\n');
  document.getElementById('mb-at').value = c.at;
  document.getElementById('mb-catchup').checked = c.catchUp;
  document.getElementById('mb-keep-daily').value = c.keepDaily;
  document.getElementById('mb-keep-weekly').value = c.keepWeekly;
  document.getElementById('mb-keep-monthly').value = c.keepMonthly;
  advancedFoldRefresh(document.getElementById('mb-card'));
  _mbProgress();
}

function _mbDest(d) {
  const el = document.getElementById('mb-dest');
  if (!d || !d.set) { el.className = 'mb-dest'; el.textContent = d?.note || ''; return; }
  const free = d.freeBytes != null ? ` · ${fmtBytes(d.freeBytes)} free` : '';
  el.className = `mb-dest ${d.reachable === false ? 'mb-bad' : d.reachable ? 'mb-ok' : ''}`;
  el.innerHTML = `<span class="pt ${d.reachable === false ? 'pt-err' : d.reachable ? 'pt-up' : ''}"></span> ${escHtml(d.note.replace(/\.$/, ''))}${escHtml(free)}`;
}

let _mbHintT = null;
function mbDestHint() { clearTimeout(_mbHintT); _mbHintT = setTimeout(() => { const el = document.getElementById('mb-dest'); if (el) el.textContent = 'Checked when you set it up or save.'; }, 300); }

function _mbChips() {
  document.getElementById('mb-chips').innerHTML = MB.chips.map((x, i) => `
    <span class="mb-chip${x.on ? ' on' : ''}${x.exists ? '' : ' missing'}">
      <label class="mb-chip-main"><input type="checkbox"${x.on ? ' checked' : ''} onchange="mbChip(${i}, this.checked)" aria-label="${escHtml(x.label)}">
        <span class="mb-chip-label">${escHtml(x.label)}</span><span class="mb-chip-path" title="${escHtml(x.path)}">${escHtml(_mbTilde(x.path))}${x.exists ? '' : ' — not on this machine'}</span></label>
      <button type="button" class="icon-btn" title="Change its path" aria-label="Change its path" onclick="mbChipEdit(${i})">${uiIcon('edit', 14)}</button>
      ${x.custom ? `<button type="button" class="icon-btn" title="Take it off the list" aria-label="Take it off the list" onclick="mbChipRemove(${i})">${uiIcon('close', 14)}</button>` : ''}
    </span>`).join('');
}

/** A path under the home folder as ~/…, for reading; the full path is its title and what is saved. */
function _mbTilde(p) { const h = MB.s?.home; return h && (p === h || p.startsWith(h + '/') || p.startsWith(h + '\\')) ? '~' + p.slice(h.length) : p; }

function mbChip(i, on) { MB.chips[i].on = on; _mbChips(); }
function mbChipRemove(i) {
  const gone = MB.chips.splice(i, 1)[0];
  _mbChips();
  setStatus(document.getElementById('mb-status'), `${gone.path} is off the list — Save to keep it so.`, 'ok');
}
function mbChipEdit(i) {
  appPrompt('The folder\'s full path:', v => { const p = String(v || '').trim(); if (!p) return; Object.assign(MB.chips[i], { path: p, on: true, exists: true, custom: true, label: p.split(/[\\/]/).filter(Boolean).pop() || p }); _mbChips(); }, MB.chips[i].path);
}
async function mbAddFolder() {
  const p = await fpPick({ mode: 'dir', title: 'A folder to back up' });
  if (!p || MB.chips.some(x => x.path === p)) return;
  MB.chips.push({ path: p, label: p.split(/[\\/]/).filter(Boolean).pop() || p, role: 'custom', exists: true, on: true, custom: true });
  _mbChips();
}

function _mbBody() {
  const num = id => parseInt(document.getElementById(id).value, 10);
  return { folders: MB.chips.filter(x => x.on).map(x => x.path), exclude: document.getElementById('mb-exclude').value.split('\n').map(s => s.trim()).filter(Boolean),
    at: document.getElementById('mb-at').value, catchUp: document.getElementById('mb-catchup').checked,
    keepDaily: num('mb-keep-daily'), keepWeekly: num('mb-keep-weekly') || 0, keepMonthly: num('mb-keep-monthly') || 0 };
}

async function mbSave() {
  const st = document.getElementById('mb-status');
  const body = _mbBody();
  if (!MB.s.setUp || MB.changing) body.repo = document.getElementById('mb-repo').value.trim();
  try { MB.s = await apiFetch('/api/machine-backup/settings', { method: 'POST', body }); _mbRender(); setStatus(st, '✓ Saved', 'ok'); }
  catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function mbEnable(box) {
  const st = document.getElementById('mb-status');
  if (box.checked && !MB.s.setUp) { box.checked = false; return setStatus(st, 'Set it up first: choose where it goes, then "Set it up here".', 'err'); }
  try { MB.s = await apiFetch('/api/machine-backup/settings', { method: 'POST', body: { enabled: box.checked } }); _mbRender();
    setStatus(st, box.checked ? `✓ Every day at ${MB.s.config.at}` : '✓ Off — nothing runs by itself', 'ok'); }
  catch (e) { box.checked = !box.checked; setStatus(st, `✗ ${e.message}`, 'err'); }
}

function mbInstallRestic() {
  const out = document.getElementById('mb-install-out');
  out.hidden = false;
  systemToolInstall('restic', out, () => setTimeout(machineBackupLoad, 800));
}

async function mbSaveKeys() {
  const id = document.getElementById('mb-key-id'), secret = document.getElementById('mb-key-secret');
  try { await apiFetch('/api/machine-backup/settings', { method: 'POST', body: { remote: { id: id.value, secret: secret.value } } }); id.value = ''; secret.value = '';
    setStatus(document.getElementById('mb-status'), '✓ Keys kept — never shown again', 'ok'); }
  catch (e) { setStatus(document.getElementById('mb-status'), `✗ ${e.message}`, 'err'); }
}

/** Set up here: the repository is made and its password shown once. */
async function mbSetUp() {
  const st = document.getElementById('mb-status');
  const repo = document.getElementById('mb-repo').value.trim();
  if (!repo) return setStatus(st, 'Choose where it goes first (📁 opens the tree).', 'err');
  try {
    await apiFetch('/api/machine-backup/settings', { method: 'POST', body: _mbBody() });
    setStatus(st, 'Setting it up…', '');
    const r = await apiFetch('/api/machine-backup/setup', { method: 'POST', body: { repo } });
    MB.changing = false;
    _mbReveal(r.password, 'Your backup\'s password');
    await machineBackupLoad();
    setStatus(st, '✓ Set up. Switch on "Every day", or Back up now.', 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

function mbChangePlace() { MB.changing = true; _mbRender(); document.getElementById('mb-repo').focus(); }

function mbChangePassword() {
  appConfirm('Make a new password for this backup?\n\nThe old one stops opening it. You will see the new one once — write it down: a fresh install needs it.', async () => {
    try { const r = await apiFetch('/api/machine-backup/password', { method: 'POST', body: {} }); _mbReveal(r.password, 'The new password'); }
    catch (e) { setStatus(document.getElementById('mb-status'), `✗ ${e.message}`, 'err'); }
  });
}

/** The password, once: copied or written down, then gone from the page. */
function _mbReveal(pw, title) {
  const box = document.getElementById('mb-reveal');
  box.hidden = false;
  box.innerHTML = `<div class="mb-reveal-title">${escHtml(title)}</div>
    <p class="desc">Save it somewhere safe — a password manager, or on paper. A fresh install needs it to bring your files back, and nobody can open the backup without it, ${escHtml(_mbBrand())} included. It is not shown again.</p>
    <div class="mb-row mb-wrap"><code class="mb-pw" id="mb-pw">${escHtml(pw)}</code>
      <button class="btn btn-xs" onclick="mbCopyPw()">Copy</button>
      <button class="btn btn-xs btn-primary" onclick="mbRevealDone()">I have saved it</button></div>`;
  box.scrollIntoView({ block: 'nearest' });
}
function mbCopyPw() { const t = document.getElementById('mb-pw')?.textContent || ''; navigator.clipboard?.writeText(t).then(() => setStatus(document.getElementById('mb-status'), '✓ Copied', 'ok'), () => {}); }
function mbRevealDone() { const box = document.getElementById('mb-reveal'); box.innerHTML = ''; box.hidden = true; }

async function mbRunNow() {
  try { await apiFetch('/api/machine-backup/run', { method: 'POST', body: {} }); setStatus(document.getElementById('mb-status'), 'Backing up…', ''); _mbPoll(); }
  catch (e) { setStatus(document.getElementById('mb-status'), `✗ ${e.message}`, 'err'); }
}

/** While a backup runs and the card is shown, its progress every 1.5 s; the history when it ends. */
function _mbPoll() {
  clearTimeout(MB.poll);
  MB.poll = setTimeout(async () => {
    if (!document.getElementById('mb-card')?.isConnected || document.hidden) return;
    try { MB.s = await apiFetch('/api/machine-backup'); } catch { return; }
    _mbProgress();
    document.getElementById('mb-now').disabled = !!MB.s.running;
    if (MB.s.running) _mbPoll(); else { if (typeof mbHistoryLoad === 'function') mbHistoryLoad(); setStatus(document.getElementById('mb-status'), MB.s.lastRun?.ok ? '✓ Backed up' : `✗ ${MB.s.lastRun?.error || 'It did not finish'}`, MB.s.lastRun?.ok ? 'ok' : 'err'); }
  }, 1500);
}

function _mbProgress() {
  const s = MB.s, el = document.getElementById('mb-progress');
  if (s.running) {
    const r = s.running;
    el.innerHTML = `<div class="mb-bar"><span style="width:${Math.max(2, r.percent)}%"></span></div>
      <div class="desc">Backing up — ${r.percent}% · ${r.files} files${r.totalBytes ? ` · ${fmtBytes(r.bytes)} of ${fmtBytes(r.totalBytes)}` : ''}</div>`;
    return _mbPoll();
  }
  const parts = [];
  if (s.lastOkAt) parts.push(`Last backup: ${fmtDate(s.lastOkAt)}.`);
  if (s.config.enabled && s.next) parts.push(s.due?.wait ? `Waiting: ${s.due.why}.` : `Next: ${fmtDate(s.next)}.`);
  const failed = s.lastError && (!s.lastOkAt || s.lastTriedAt > s.lastOkAt);
  el.innerHTML = parts.length || failed ? `<div class="desc${failed ? ' mb-bad' : ''}">${escHtml(parts.join(' '))}${failed ? ` The last try (${escHtml(fmtDate(s.lastTriedAt))}) failed: ${escHtml(s.lastError)}` : ''}</div>` : '';
}

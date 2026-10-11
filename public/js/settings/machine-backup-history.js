/* ═══════════════════════════════════════════════════════
   Settings → Backups → This machine's files: the history (each day's copy, newest first — when, how much was new, how
   long, what could not be read), a day's files as a tree a level at a time, finding a file in every copy, and putting
   files back — beside where they were (the default), to a chosen folder, or in their place after asking. Bringing a
   backup back onto a fresh install is here too: open it with its password, pick a day, and each folder lands in this
   home by what it was (Documents into Documents, on any system). Every restore asks for the person's password.
   ═══════════════════════════════════════════════════════ */

const MBH = { snaps: [], at: null, dir: '', entries: [] };

function mbHistoryEmpty() {
  const el = document.getElementById('mb-history');
  if (el) el.innerHTML = '';
}

async function mbHistoryLoad() {
  const el = document.getElementById('mb-history');
  if (!el) return;
  if (!el.querySelector('#mb-snaps')) el.innerHTML = `
    <div class="mb-sec"><div class="input-label">History${infoBtn('Each day\'s copy, newest first: when it was made, how much of it was new, how long it took, and the files it could not read. Open one to see that day\'s files, download them, or put them back.')}</div>
      <div class="mb-row mb-wrap"><input class="input flex1" id="mb-find" placeholder="Find a file in every copy — a name, or *report*.pdf" aria-label="Find a file" onkeydown="if(event.key==='Enter')mbFind()">
        <button class="btn btn-sm" onclick="mbFind()">Find</button></div>
      <div id="mb-found"></div>
      <div id="mb-browser" class="mb-browser" hidden></div>
      <div id="mb-snaps"><div class="placeholder pulse">Reading the history…</div></div></div>`;
  try { MBH.snaps = (await apiFetch('/api/machine-backup/history')).snapshots || []; }
  catch (e) { document.getElementById('mb-snaps').innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  _mbhSnaps();
}

const _mbhHost = () => (MB.s?.home || '');
const _mbhNum = n => (n == null ? '?' : Number(n).toLocaleString());

function _mbhSnaps() {
  const box = document.getElementById('mb-snaps');
  if (!MBH.snaps.length) { box.innerHTML = emptyStateHtml({ title: 'No copies yet', text: 'The first one is made at the time set above, or now with Back up now.' }); return; }
  const here = MBH.snaps[0]?.host;
  box.innerHTML = MBH.snaps.map((s, i) => {
    const other = s.home && s.home !== _mbhHost();
    return `<div class="mb-snap">
      <div class="mb-snap-main">
        <div class="mb-snap-when">${escHtml(fmtDate(s.time))}${s.host !== here || other ? ` <span class="mb-tag">${escHtml(s.host)}</span>` : ''}</div>
        <div class="desc">${_mbhNum(s.filesTotal)} files · ${s.bytesNew != null ? fmtBytes(s.bytesNew) : '?'} new${s.seconds != null ? ` · ${s.seconds} s` : ''} · ${s.paths.length} folders${s.errorCount ? ` · <span class="mb-warn">${s.errorCount} could not be read</span>` : ''}</div>
        ${s.errorCount ? `<details class="mb-errs"><summary>What could not be read</summary>${s.errors.map(e => `<div class="mb-err"><code>${escHtml(e.item)}</code> — ${escHtml(e.message)}</div>`).join('')}${s.errorCount > s.errors.length ? `<div class="desc">…and ${s.errorCount - s.errors.length} more</div>` : ''}</details>` : ''}
      </div>
      <div class="mb-snap-acts"><button class="btn btn-xs" onclick="mbOpen(${i})">Open</button>${other ? `<button class="btn btn-xs btn-primary" onclick="mbBringPick(${i})">Bring back here</button>` : ''}</div>
    </div>`;
  }).join('');
}

/* ── A day's files ── */

async function mbOpen(i, dir = '') {
  MBH.at = MBH.snaps[i];
  MBH.dir = dir;
  const b = document.getElementById('mb-browser');
  b.hidden = false;
  b.innerHTML = '<div class="placeholder pulse">Reading…</div>';
  try { MBH.entries = (await apiFetch(`/api/machine-backup/browse?snapshot=${encodeURIComponent(MBH.at.id)}&path=${encodeURIComponent(dir)}`)).entries || []; }
  catch (e) { b.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  _mbhBrowser();
  b.scrollIntoView({ block: 'nearest' });
}

function _mbhCrumbs() {
  if (!MBH.dir) return '<span class="mb-crumb">All the backed-up folders</span>';
  const top = MBH.at.paths.map(p => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1')).find(p => MBH.dir === p || MBH.dir.startsWith(`${p}/`)) || '';
  const rest = MBH.dir.slice(top.length).split('/').filter(Boolean);
  const idx = MBH.snaps.indexOf(MBH.at);
  const links = [`<a href="#" onclick="mbOpen(${idx});return false">All</a>`, `<a href="#" onclick="mbOpen(${idx}, ${jsArg(top)});return false" title="${escHtml(top)}">${escHtml(_mbTilde(top))}</a>`];
  rest.forEach((seg, k) => links.push(`<a href="#" onclick="mbOpen(${idx}, ${jsArg(`${top}/${rest.slice(0, k + 1).join('/')}`)});return false">${escHtml(seg)}</a>`));
  return links.join(' <span class="mb-sep">›</span> ');
}

function _mbhBrowser() {
  const b = document.getElementById('mb-browser'), idx = MBH.snaps.indexOf(MBH.at);
  b.innerHTML = `<div class="mb-browser-head"><span class="mb-browser-title">Files on ${escHtml(fmtDate(MBH.at.time))}</span>
      <button type="button" class="icon-btn" aria-label="Close" title="Close" onclick="mbClose()">${uiIcon('close')}</button></div>
    <div class="mb-crumbs">${_mbhCrumbs()}</div>
    <div class="mb-entries" role="list">${MBH.entries.length ? MBH.entries.map((e, k) => `
      <div class="mb-entry" role="listitem">
        ${e.type === 'dir' ? `<a href="#" class="mb-entry-name" onclick="mbOpen(${idx}, ${jsArg(e.path)});return false">${uiIcon('folder', 14)} ${escHtml(e.name)}</a>`
          : `<span class="mb-entry-name">${uiIcon('file', 14)} ${escHtml(e.name)}</span>`}
        ${e.type === 'dir' ? '' : `<span class="mb-entry-size">${fmtBytes(e.size || 0)}</span>`}
        <span class="mb-entry-acts">
          <button class="btn btn-xs" onclick="mbDownload(${k})" title="${e.type === 'dir' ? 'Download the folder as a .zip' : 'Download this copy'}">Download</button>
          <button class="btn btn-xs" onclick="mbRestore(${k}, 'beside')" title="Next to where it was, in a folder &quot;Restored &lt;date&gt;&quot; — nothing is overwritten">Restore here</button>
          <button class="btn btn-xs" onclick="mbRestore(${k}, 'to')" title="Into a folder you choose">Restore to…</button>
          ${rowActs([{ icon: 'warn', label: 'Put back in its place (replaces what is there)', onclick: `mbRestore(${k}, 'replace')`, more: true }])}
        </span>
      </div>`).join('') : '<div class="placeholder">Empty</div>'}</div>`;
}

function mbClose() { const b = document.getElementById('mb-browser'); b.hidden = true; b.innerHTML = ''; }

function mbDownload(k) {
  const e = MBH.entries[k];
  const a = document.createElement('a');
  a.href = `/api/machine-backup/download?snapshot=${encodeURIComponent(MBH.at.id)}&path=${encodeURIComponent(e.path)}${e.type === 'dir' ? '&dir=1' : ''}`;
  a.download = e.type === 'dir' ? `${e.name}.zip` : e.name;
  document.body.appendChild(a); a.click(); a.remove();
}

async function mbRestore(k, mode) {
  const e = MBH.entries[k], st = document.getElementById('mb-status');
  const go = async body => {
    try { const r = await apiFetch('/api/machine-backup/restore', { method: 'POST', body: { snapshot: MBH.at.id, path: e.path, mode, ...body } });
      setStatus(st, `✓ ${e.name}: ${r.files} files put back into ${r.into}`, 'ok'); }
    catch (err) { setStatus(st, `✗ ${err.message}`, 'err'); }
  };
  if (mode === 'beside') return go({});
  if (mode === 'to') { const t = await fpPick({ mode: 'dir', title: `Restore ${e.name} into…` }); if (t) go({ target: t }); return; }
  appConfirm(`Put ${e.name} back in its place?\n\nWhat is there now is replaced by the copy of ${fmtDate(MBH.at.time)}. To keep both, choose "Restore here" instead.`, () => go({}));
}

async function mbFind() {
  const q = document.getElementById('mb-find').value.trim(), out = document.getElementById('mb-found');
  if (!q) return;
  out.innerHTML = '<div class="placeholder pulse">Looking in every copy…</div>';
  try {
    const r = await apiFetch(`/api/machine-backup/find?q=${encodeURIComponent(q)}`);
    out.innerHTML = r.total ? `<div class="desc">${r.total} found${r.total > r.matches.length ? `, the newest ${r.matches.length}` : ''}:</div>` + r.matches.map(m => {
      const i = MBH.snaps.findIndex(s => s.id === m.snapshot), dir = m.path.slice(0, m.path.lastIndexOf('/')) || '/';
      return `<div class="mb-entry"><a href="#" class="mb-entry-name" onclick="mbOpen(${i}, ${jsArg(dir)});return false">${escHtml(m.path)}</a>
        <span class="mb-entry-size">${escHtml(m.time ? fmtDate(m.time) : '')}${m.type === 'dir' ? '' : ` · ${fmtBytes(m.size || 0)}`}</span></div>`;
    }).join('') : `<div class="placeholder">No copy of "${escHtml(q)}" in any snapshot.</div>`;
  } catch (e) { out.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; }
}

/* ── Bringing a machine backup back (a fresh install) ── */

function mbBringStart() {
  const el = document.getElementById('mb-bring');
  if (!el) return;
  el.innerHTML = `<div class="mb-sec mb-bring"><div class="input-label">Bring back a machine backup${infoBtn('For a fresh install, or another machine\'s backup: point at the folder or address it is in and type its password. Then pick a day: each folder lands in this home by what it was — Documents into Documents, on any system.')}</div>
    <div class="mb-row"><input class="input flex1" id="mb-bring-repo" data-path-pick="dir" placeholder="/media/you/Backup/old-machine" aria-label="Where the backup is"></div>
    <div class="mb-row mb-wrap"><input class="input flex1" type="password" id="mb-bring-pw" autocomplete="off" placeholder="its password" aria-label="Its password">
      <button class="btn btn-sm btn-primary" onclick="mbBringOpen()">Open it</button><button class="btn btn-sm" onclick="mbBringCancel()">Cancel</button></div>
    <span class="status-line" id="mb-bring-status"></span></div>`;
  document.getElementById('mb-bring-repo').value = document.getElementById('mb-repo')?.value || '';
}
function mbBringCancel() { const el = document.getElementById('mb-bring'); if (el) el.innerHTML = ''; }

async function mbBringOpen() {
  const st = document.getElementById('mb-bring-status');
  const repo = document.getElementById('mb-bring-repo').value.trim(), pw = document.getElementById('mb-bring-pw');
  try {
    await apiFetch('/api/machine-backup/connect', { method: 'POST', body: { repo, password: pw.value } });
    pw.value = '';
    MB.changing = false;
    await machineBackupLoad();
    const el = document.getElementById('mb-bring');
    if (el) el.innerHTML = `<div class="desc mb-ok">✓ Opened. Pick a day in the history and "Bring back here" — or Open it to take single files.</div>`;
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/** Which of a day's folders come back, and where each lands; files already there are kept unless asked. */
function mbBringPick(i) {
  const s = MBH.snaps[i], el = document.getElementById('mb-bring');
  el.innerHTML = `<div class="mb-sec mb-bring"><div class="input-label">Bring back ${escHtml(s.host)}'s files of ${escHtml(fmtDate(s.time))}</div>
    ${s.paths.map((p, k) => `<label class="mb-land"><input type="checkbox" data-path="${escHtml(p)}"${s.lands[k] ? ' checked' : ' disabled'}>
      <span><code>${escHtml(p)}</code> → ${s.lands[k] ? `<code>${escHtml(s.lands[k])}</code>` : '<em>no place here: open the day and use Restore to…</em>'}</span></label>`).join('')}
    <label class="mb-switch"><input type="checkbox" class="switch" id="mb-bring-over" data-default="false"> Replace files that are already there${infoBtn('Off (the default): a file already in its place is kept, and only what is missing comes back. On: the backup\'s copy replaces it.')}</label>
    <div class="mb-row mb-wrap"><button class="btn btn-sm btn-primary" onclick="mbBringGo(${i})">Bring them back</button><button class="btn btn-sm" onclick="mbBringCancel()">Cancel</button></div>
    <span class="status-line" id="mb-bring-status"></span></div>`;
  el.scrollIntoView({ block: 'nearest' });
}

async function mbBringGo(i) {
  const s = MBH.snaps[i], st = document.getElementById('mb-bring-status');
  const only = [...document.querySelectorAll('#mb-bring input[data-path]:checked')].map(x => x.dataset.path);
  if (!only.length) return setStatus(st, 'Tick at least one folder.', 'err');
  const go = async overwrite => {
    setStatus(st, 'Bringing them back…', '');
    try { const r = await apiFetch('/api/machine-backup/restore', { method: 'POST', body: { mode: 'home', snapshot: s.id, only, overwrite } });
      setStatus(st, `✓ ${r.done.length} folders back (${r.done.reduce((n, d) => n + d.files, 0)} files)${r.left.length ? ` — ${r.left.length} need a place: open the day and use Restore to…` : ''}`, 'ok'); }
    catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
  };
  const over = document.getElementById('mb-bring-over').checked;
  if (!over) return go(false);
  appConfirm('Replace the files already there with the backup\'s copies?', () => go(true));
}

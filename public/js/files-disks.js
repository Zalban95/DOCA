/* ═══════════════════════════════════════════════════════
   Files' disks (asked 2026-10-12): every mounted place with a bar of how full it
   is (used of total, and what is free), and the disks that exist but are not
   mounted, faded — a click asks "Mount New Volume (7.3 TB, NTFS)?" and mounts it
   the way the desktop would (udisks), or, on a hub without a desktop session,
   with the sudo password (sudo.js). A removable or data disk has ⏏ Unmount, asked
   first; the system's own, and the one DOCA lives on, never do. GET /api/files/disks.
   ═══════════════════════════════════════════════════════ */

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

/** "7.3 TB, NTFS" */
function _fmDiskWhat(d) { return [d.size ? fmtBytes(d.size) : null, d.fstype ? d.fstype.toUpperCase() : null].filter(Boolean).join(', '); }
function _fmDiskName(d) { return d.label || d.name || d.path; }

/** "98.8 / 233.7 GB" — one unit when both share it, or the sidebar cuts the free space off. */
function _fmUsedOf(used, total) {
  const u = fmtBytes(used), t = fmtBytes(total), unit = t.split(' ')[1];
  return u.endsWith(` ${unit}`) ? `${u.split(' ')[0]} / ${t}` : `${u} / ${t}`;
}

function _fmSpaceBar(m) {
  if (!m.total) return '';
  const pct = Math.max(0, Math.min(100, Math.round(m.used / m.total * 100)));
  const tone = pct >= 95 ? ' crit' : pct >= 85 ? ' warn' : '';
  return `<span class="fm-disk-space" title="${escHtml(`${fmtBytes(m.used)} used of ${fmtBytes(m.total)} — ${fmtBytes(m.free)} free`)}">
      <span class="fm-disk-bar${tone}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${pct}% used"><i style="width:${pct}%"></i></span>
      <span class="fm-disk-nums"><span>${escHtml(_fmUsedOf(m.used, m.total))}</span><span>${escHtml(fmtBytes(m.free))} free</span></span>
    </span>`;
}

function _fmMountedRow(m) {
  const label = m.home ? 'Home' : m.label || (m.path === '/' ? 'Root (/)' : m.path.split('/').pop() || m.path);
  const title = m.home ? m.path : `${m.device} → ${m.path}${m.type ? ` (${m.type})` : ''}`;
  const eject = m.canUnmount && m.devPath
    ? `<button type="button" class="icon-btn fm-disk-eject" title="Unmount ${escHtml(label)}" aria-label="Unmount ${escHtml(label)}"
         onclick="event.stopPropagation(); fmDiskUnmount(${jsArg(m.devPath)}, ${jsArg(label)}, ${jsArg(m.path)})">⏏</button>` : '';
  return `<div class="fm-disk">
      <button class="fm-bookmark" title="${escHtml(title)}" onclick="fmNavigate(${jsArg(m.path)})">
        <span class="fm-bookmark-icon">${m.home ? '🏠' : fmMountIcon(m.type, m.device)}</span>
        <span class="fm-bookmark-name">${escHtml(label)}</span>
        ${m.type && !m.home ? `<span class="fm-disk-type">${escHtml(m.type)}</span>` : ''}
      </button>${eject}${_fmSpaceBar(m)}
    </div>`;
}

function _fmUnmountedRow(d) {
  const name = _fmDiskName(d), what = _fmDiskWhat(d);
  if (!d.canMount) {
    return `<div class="fm-disk fm-disk-off" title="${escHtml(`${d.path} — ${d.why || 'cannot be mounted here'}`)}">
        <span class="fm-bookmark" aria-disabled="true"><span class="fm-bookmark-icon">🔒</span>
        <span class="fm-bookmark-name">${escHtml(name)}</span><span class="fm-disk-type">${escHtml(what)}</span></span>
        <span class="fm-disk-why">${escHtml(d.why || '')}</span>
      </div>`;
  }
  return `<div class="fm-disk fm-disk-off">
      <button class="fm-bookmark" title="${escHtml(`${d.path} — not mounted. Click to mount it.`)}"
              onclick="fmDiskMount(${jsArg(d.path)}, ${jsArg(name)}, ${jsArg(what)})">
        <span class="fm-bookmark-icon">${d.removable ? '🔌' : '💾'}</span>
        <span class="fm-bookmark-name">${escHtml(name)}</span>
        <span class="fm-disk-type">${escHtml(what)}</span>
      </button>
    </div>`;
}

async function fmDisksLoad() {
  const el = document.getElementById('fm-mounts-list');
  if (!el) return;
  let data;
  try { data = await apiFetch('/api/files/disks'); }
  catch { el.innerHTML = '<div class="placeholder" style="font-size:10px;padding:4px">Could not load the disks</div>'; return; }
  const label = el.parentElement?.querySelector('.fm-sidebar-label');
  if (label) label.textContent = '💾 Disks';
  const mounted = data.mounted || [], off = data.unmounted || [];
  el.innerHTML = (mounted.map(_fmMountedRow).join('') || '<div class="placeholder" style="font-size:10px;padding:4px">No mounts detected</div>')
    + (off.length ? `<div class="fm-disk-sub">Not mounted</div>${off.map(_fmUnmountedRow).join('')}` : '')
    + (data.note ? `<div class="fm-disk-note">${escHtml(data.note)}</div>` : '');
}

/** Mount, then (polkit having said no) the sudo password. `verb`: mount | unmount. */
const FM_DISK_URL = { mount: '/api/files/disks/mount', unmount: '/api/files/disks/unmount' };

async function _fmDiskAct(verb, device, name, done) {
  const url = FM_DISK_URL[verb];
  let r;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device }) });
    r = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
  } catch (e) { return appAlert(`${verb === 'mount' ? 'Mounting' : 'Unmounting'} ${name} failed: ${e.message}`); }
  if (r.ok) return done(r.folder);
  if (r.needs !== 'password') return appAlert(`${verb === 'mount' ? 'Mounting' : 'Unmounting'} ${name} failed: ${r.error}`);
  sudoAsk(`${r.error} Your password for sudo, to ${verb} ${name}:`, pw => {
    if (pw == null) return;
    let last = '';
    sseStream(url, { device, password: pw }, {
      onStatus: s => { last = String(s || '').trim() || last; },
      onDone: ev => (ev.ok ? done(null) : appAlert(`${verb === 'mount' ? 'Mounting' : 'Unmounting'} ${name} failed: ${last}`)),
      onError: e => appAlert(e.message),
    });
  });
}

function fmDiskMount(device, name, what) {
  appConfirm(`Mount ${name}${what ? ` (${what})` : ''}?`, () => _fmDiskAct('mount', device, name, async folder => {
    await fmDisksLoad();
    if (folder) fmNavigate(folder);
  }));
}

function fmDiskUnmount(device, name, folder) {
  appConfirm(`Unmount ${name}? Programs with files open on it will lose them; Files leaves ${folder}.`, () => _fmDiskAct('unmount', device, name, async () => {
    if (fm.cwd === folder || fm.cwd.startsWith(`${folder}/`)) fmNavigate(FM_BOOKMARKS[0]?.path || '/');
    fmDisksLoad();
  }));
}

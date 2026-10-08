/* The status column's Machines (modules/machines/rows.js; asked 2026-10-08): containers, the agents' computers, the
   VMs and the VNC screens (an unreachable one counted like a stopped machine), drawn from one list of rows — the running ones (and any in trouble) as rows with a point, the stopped ones as a
   count that opens their tab. The rows are a host's (computers and VMs are the machine's): for anyone else the column
   keeps the running containers /api/status already carries. Asked only while the page is visible; the hub keeps the
   rows a few seconds and the VM list longer, so polling never starts a hypervisor's CLI each time. A row opens Live
   on it when it has a picture there, else its own tab. */
const MACHINE_KINDS = [
  { kind: 'container', label: 'Containers', tab: 'docker' },
  { kind: 'computer', label: 'Computers', tab: 'computers' },
  { kind: 'vm', label: 'VMs', tab: 'vms' },
  { kind: 'vnc', label: 'VNC', tab: 'vnc', down: 'unreachable' },   // vnc-targets/: connected or reachable as rows
];
let _machinesNoRows = false;   // a 403 once: this person is not a host, so the containers come from the status

/** Called by pollStatus with the status' running containers. */
async function machinesSidebar(statusContainers) {
  const el = document.getElementById('s-containers');
  if (!el) return;
  if (!_machinesNoRows && !(typeof _settingsNoHost !== 'undefined' && _settingsNoHost)) {
    if (document.hidden) return;
    try { const d = await apiFetch('/api/machines/rows'); machineOriginsKeep(d); return machinesSidebarDraw(d); }   // the tabs read who started what from it too
    catch (e) { if (/403|forbidden|right/i.test(e.message || '')) _machinesNoRows = true; else return; }
  }
  // Without the host right: the running containers, in the same rows.
  const rows = (statusContainers || []).map(c => ({ kind: 'container', id: c.ID || c.Names, name: String(c.Names || '').replace(/^\//, '').split(',')[0],
    state: String(c.State || 'running').toLowerCase(), point: 'up', detail: [c.Image, c.Status].filter(Boolean).join(' · '), tab: 'docker' }));
  machinesSidebarDraw({ rows, counts: { container: { total: rows.length, running: rows.length, stopped: 0 } } }, true);
}

function machineRowHtml(r) {
  const cls = { up: 'running', error: 'exited', paused: 'paused', down: 'stopped' }[r.point] || 'stopped';
  const by = machineOriginText(r.origin);   // who started it (lib/machine-origin.js)
  const busy = r.busy?.busy ? `busy: ${r.busy.text || 'working'}${r.busy.by === 'outside' ? ' — outside DOCA\'s tools' : ''}` : '';   // machines/busy.js
  return `<div class="c-item m-row ${cls}${busy ? ' busy' : ''}" role="button" tabindex="0" title="${escHtml(`${r.name} — ${r.detail || r.state}${busy ? `\n${busy}` : ''}${by ? `\n${by}` : ''}`)}"
      onclick="machineGo(${jsArg(r.kind)}, ${jsArg(r.id)}, ${r.live ? 'true' : 'false'})" onkeydown="if(event.key==='Enter')this.click()">
    <span class="m-main"><span class="c-name">${escHtml(r.name)}</span>${busy ? `<span class="m-detail m-busy">${escHtml(busy)}</span>` : ''}${r.detail ? `<span class="m-detail">${escHtml(r.detail)}</span>` : ''}${by ? `<span class="m-detail${r.origin.outside ? ' outside' : ''}">${escHtml(by)}</span>` : ''}</span>
    <span class="c-state">${escHtml(r.state)}</span></div>`;
}

function machinesSidebarDraw(data, onlyContainers = false) {
  const el = document.getElementById('s-containers');
  const shown = r => r.point !== 'down';   // running, paused, or in trouble; the stopped are counted
  const all = data.rows || [];
  const running = all.filter(r => r.point === 'up').length;
  const countEl = document.getElementById('s-containers-count');
  if (countEl) countEl.textContent = all.length ? `${running} running` : '';
  const groups = MACHINE_KINDS.filter(k => !onlyContainers || k.kind === 'container').map(k => {
    const rows = all.filter(r => r.kind === k.kind);
    if (!rows.length) return '';
    const stopped = rows.length - rows.filter(shown).length;
    return `<div class="m-sub"><span>${k.label}</span>${stopped ? `<a href="#" onclick="nav(${jsArg(k.tab)});return false" title="Open ${escHtml(k.label)}">${stopped} ${k.down || 'stopped'} →</a>` : ''}</div>
      ${rows.filter(shown).slice(0, 12).map(machineRowHtml).join('')}`;
  }).join('');
  el.innerHTML = groups || '<div class="placeholder">None running</div>';
}

/** A row's click: Live, focused on it, when it has a picture there; otherwise the tab that manages it. */
function machineGo(kind, id, live) {
  if (live && typeof liveFocus === 'function') return liveFocus(`${{ computer: 'c', vnc: 'n' }[kind] || 'v'}:${id}`);
  nav((MACHINE_KINDS.find(k => k.kind === kind) || MACHINE_KINDS[0]).tab);
}

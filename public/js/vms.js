/* ═══════════════════════════════════════════════════════
   DOCA PANEL — VIRTUAL MACHINES
   ═══════════════════════════════════════════════════════ */

function vmsInit() { vmsLoad(); }

async function vmsLoad() {
  const list = document.getElementById('vms-list');
  if (!list) return;
  try {
    const [data] = await Promise.all([apiFetch('/api/vms'), machineOriginsLoad()]);   // + who started each (lib/machine-origin.js)
    list.innerHTML = (data.hypervisors || []).map(hv => _vmHypervisorHtml(hv, data)).join('');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

/** One card per hypervisor, so a broken one does not hide the other's VMs. */
function _vmHypervisorHtml(hv, data) {
  const body = !hv.available
    ? `<div class="placeholder">${escHtml(hv.bin)} not found — install it to manage these here.</div>`
    : hv.error
      ? `<div class="placeholder" style="color:var(--red)">${escHtml(hv.error)}</div>`
      : hv.vms.length
        ? hv.vms.map(vm => _vmRowHtml(hv.id, vm)).join('')
        : '<div class="placeholder">No machines defined.</div>';

  // virsh defaults to qemu:///session while virt-manager's machines usually live
  // in qemu:///system, so an empty list is nearly always the wrong URI.
  const uriRow = hv.id !== 'libvirt' || !hv.available ? '' : `
    <div class="vm-uri-row">
      <span class="input-label">Connection URI</span>
      <input class="input" id="vm-libvirt-uri" value="${escHtml(data.libvirtUri || '')}"
             placeholder="qemu:///system — empty uses virsh's own default">
      <button class="btn btn-xs btn-blue" onclick="vmsSaveUri()">Save</button>
    </div>`;

  return `
    <div class="card mb8">
      <div class="toolbar" style="margin-bottom:8px">
        <div class="card-title" style="margin-bottom:0">${escHtml(hv.label)}</div>
        <span class="vm-count">${hv.available ? `${hv.vms.length} machine${hv.vms.length === 1 ? '' : 's'}` : 'not installed'}</span>
        ${hv.id === 'libvirt' && hv.available ? '<button class="btn btn-xs btn-blue" onclick="vmCreateToggle()" title="A new machine from an ISO (virt-install)">+ New machine</button>' : ''}
      </div>
      ${hv.id === 'libvirt' && hv.available ? _vmCreateHtml() : ''}
      ${body}
      ${uriRow}
    </div>`;
}

function _vmRowHtml(hvId, vm) {
  const arg  = jsArg(vm.name);
  const act  = (a, label, cls = '', title = '') =>
    `<button class="btn btn-xs ${cls}" title="${escHtml(title)}" onclick="vmAction(${jsArg(hvId)}, ${arg}, ${jsArg(a)})">${label}</button>`;

  const actions = vm.state === 'running'
    ? [act('stop',   'Stop',   '',        'Ask the guest to shut down'),
       act('reboot', 'Reboot', '',        'Restart the guest'),
       act('kill',   'Force off', 'btn-red', 'Cut the power — the guest is not asked')]
    : vm.state === 'paused'
      ? [act('resume', '▶ Resume', 'btn-green'),
         act('kill',   'Force off', 'btn-red', 'Cut the power')]
      : [act('start', '▶ Start', 'btn-green')];

  const display = vm.display
    ? `<span class="vm-display">
         <code>${escHtml(vm.display.uri)}</code>
         <button class="btn btn-xs" onclick="devCopy(${jsArg(vm.display.uri)}, this)"
                 title="Copy for your ${escHtml(vm.display.protocol.toUpperCase())} viewer">copy</button>
       </span>`
    : `<span class="vm-display vm-display-none">${vm.state === 'running' ? 'no remote display' : ''}</span>`;

  return `
    <div class="vm-row vm-${escHtml(vm.state)}">
      <span class="vm-dot" title="${escHtml(vm.stateRaw || vm.state)}">${vm.state === 'running' ? '●' : '○'}</span>
      <span class="vm-name">${escHtml(vm.name)}${machineOriginHtml('vm', `${hvId}:${vm.name}`)}</span>
      <span class="vm-state">${escHtml(vm.stateRaw || vm.state)}</span>
      ${display}
      <span class="vm-acts">${vm.console?.how === 'hub' ? `<button class="btn btn-xs" title="Its VNC console, through the hub" onclick="vmConsoleOpen(${jsArg(hvId)}, ${arg})">VNC</button>` : ''}${actions.join('')}${hvId === 'libvirt' ? `<button class="btn btn-xs" title="Details, autostart and snapshots" onclick="vmDetails(${arg}, this)">⋯</button>` : ''}</span>
    </div>
    ${hvId === 'libvirt' ? `<div class="vm-details" id="vm-details-${escHtml(vm.name)}" style="display:none"></div>` : ''}`;
}

/**
 * A VM's console inside the panel (machines/vm-console.js): its VNC through the hub, in the computers' live view, so
 * Back or ✕ closes it — from the VMs tab, Live and the status column alike. A display the hub cannot carry is named.
 */
let _vmConsole = null;
async function vmConsoleOpen(hypervisor, name) {
  const data = await apiFetch('/api/vms').catch(() => ({ hypervisors: [] }));
  const vm = (data.hypervisors.find(h => h.id === hypervisor)?.vms || []).find(v => v.name === name);
  if (!vm) return appAlert(`"${name}" is gone.`);
  if (vm.console?.how !== 'hub') return appAlert(vm.console?.why || 'It has no console the hub can open.');
  vmConsoleClose();
  // Kept as a VNC screen already (Machines → VNC), or one click to keep it: the same display, then named and pictured there.
  const saved = (await apiFetch('/api/machines/vnc').catch(() => ({ targets: [] }))).targets.find(t => t.same?.kind === 'vm' && t.same.id === `${hypervisor}:${name}`);
  const keep = saved ? `<span class="pc-dim">VNC screen “${escHtml(saved.name)}”</span>`
    : `<button class="btn btn-xs" title="Keep it in Machines → VNC" onclick="vncSaveDisplay(${jsArg(vm.name)}, ${jsArg(vm.console.host)}, ${vm.console.port}); this.remove()">Save as a VNC screen</button>`;
  const ov = Object.assign(document.createElement('div'), { className: 'pc-live' });
  ov.innerHTML = `<div class="pc-live-bar"><b>${escHtml(vm.name)}</b><span class="pc-dim">${escHtml([data.hypervisors.find(h => h.id === hypervisor)?.label, vm.os].filter(Boolean).join(' · '))}</span>
      <span style="flex:1"></span>${keep}<a class="btn btn-xs" href="${escHtml(vm.console.url)}" target="_blank" rel="noopener">Open in a window</a>
      <button class="btn btn-xs" onclick="vmConsoleClose()">✕</button></div>
    <iframe src="${escHtml(vm.console.url)}" title="${escHtml(vm.name)}" allow="clipboard-read; clipboard-write"></iframe>`;
  document.body.appendChild(ov);
  _vmConsole = { ov, release: overlayBack(() => vmConsoleClose(true)) };
}

function vmConsoleClose(fromBack) {
  if (!_vmConsole) return;
  const { ov, release } = _vmConsole;
  _vmConsole = null;
  ov.remove();
  if (!fromBack) release();
}

/** Force off is the one that can lose the guest's data, so it asks first. */
function vmAction(hypervisor, name, action) {
  const go = async () => {
    const status = document.getElementById('vms-status');
    setStatus(status, `${action} ${name}…`, '');
    try {
      const r = await apiFetch(`/api/vms/${encodeURIComponent(hypervisor)}/action`, {
        method: 'POST', body: { name, action },
      });
      setStatus(status, `✓ ${r.output}`, 'ok');
      // Shutdown and reboot are requests to the guest, not events: give it a
      // moment before asking the hypervisor what actually happened.
      setTimeout(vmsLoad, 1200);
    } catch (e) {
      setStatus(status, `✗ ${e.message}`, 'err');
    }
  };
  // Every way of stopping it asks, naming what uses it (lib/machine-ask.js); starting and resuming do not.
  if (!machineAskFirst('vm', `${hypervisor}:${name}`, action, `"${name}"`, go, action === 'kill' ? 'The guest is not asked to shut down.' : '')) go();
}

async function vmsSaveUri() {
  const status = document.getElementById('vms-status');
  try {
    await apiFetch('/api/vms/settings', {
      method: 'POST',
      body: { libvirtUri: document.getElementById('vm-libvirt-uri').value.trim() },
    });
    setStatus(status, '✓ Saved', 'ok');
    vmsLoad();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

/* ── libvirt management (modules/vms-manage.js): details, autostart, snapshots, a new machine ── */

async function vmDetails(name, btn, keepOpen) {
  const box = document.getElementById(`vm-details-${name}`);
  if (!box) return;
  if (!keepOpen && box.style.display !== 'none') { box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = '<div class="placeholder pulse">Reading…</div>';
  let d;
  try { d = await apiFetch(`/api/vms/libvirt/${encodeURIComponent(name)}`); }
  catch (e) { box.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  const n = jsArg(name);
  box.innerHTML = `
    <div class="vm-facts">${d.cpus || '?'} CPU · ${d.memoryMb ? `${Math.round(d.memoryMb / 1024 * 10) / 10} GB` : '?'} RAM
      <label class="vm-auto"><input type="checkbox" ${d.autostart ? 'checked' : ''} onchange="vmAutostart(${n}, this.checked)"> start with this machine</label></div>
    <div class="input-label" style="margin-top:6px">Snapshots</div>
    ${d.snapshots.length ? d.snapshots.map(s => `<div class="vm-snap"><span>${escHtml(s)}${s === d.currentSnapshot ? ' <em>(current)</em>' : ''}</span>
        <button class="btn btn-xs" onclick="vmSnapAct(${n}, ${jsArg(s)}, 'revert')" title="Put the machine back as it was then">↶ Revert</button>
        <button class="btn btn-xs btn-red" onclick="vmSnapAct(${n}, ${jsArg(s)}, 'delete')" title="Remove this snapshot">✕</button></div>`).join('')
      : '<div class="placeholder" style="font-size:11px">None yet.</div>'}
    <div class="vm-snap-new"><input class="input" id="vm-snapname-${escHtml(name)}" placeholder="snapshot name (optional)">
      <button class="btn btn-xs btn-blue" onclick="vmSnapTake(${n})">Take snapshot</button></div>`;
}

async function _vmCall(name, url, opts, what) {
  const status = document.getElementById('vms-status');
  setStatus(status, `${what}…`, '');
  try { await apiFetch(url, opts); setStatus(status, `✓ ${what}`, 'ok'); vmDetails(name, null, true); }
  catch (e) { setStatus(status, `✗ ${e.message}`, 'err'); }
}

function vmAutostart(name, on) {
  _vmCall(name, `/api/vms/libvirt/${encodeURIComponent(name)}/autostart`, { method: 'POST', body: { on } }, on ? `${name} starts with this machine` : `${name} no longer starts with this machine`);
}

function vmSnapTake(name) {
  const snapshot = document.getElementById(`vm-snapname-${name}`)?.value.trim() || '';
  _vmCall(name, `/api/vms/libvirt/${encodeURIComponent(name)}/snapshots`, { method: 'POST', body: { snapshot } }, `Snapshot of ${name} taken`);
}

function vmSnapAct(name, snap, act) {
  const url = `/api/vms/libvirt/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snap)}`;
  if (act === 'revert') appConfirm(`Put "${name}" back as it was at "${snap}"? What changed since is lost unless it has its own snapshot.`,
    () => _vmCall(name, `${url}/revert`, { method: 'POST' }, `${name} reverted to ${snap}`));
  else appConfirm(`Delete the snapshot "${snap}" of "${name}"?`, () => _vmCall(name, url, { method: 'DELETE' }, `Snapshot ${snap} deleted`));
}

function _vmCreateHtml() {
  return `<div class="vm-create" id="vm-create" style="display:none">
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:flex-end">
      <div class="field"><div class="input-label">Name</div><input class="input" id="vmc-name" style="width:150px" placeholder="dev-box"></div>
      <div class="field" style="flex:1;min-width:220px"><div class="input-label">ISO on this machine</div><input class="input" id="vmc-iso" placeholder="~/Downloads/ubuntu-24.04.iso"></div>
      <div class="field"><div class="input-label">RAM (MB)</div><input class="input" type="number" id="vmc-mem" value="4096" min="512" step="512" style="width:100px"></div>
      <div class="field"><div class="input-label">CPUs</div><input class="input" type="number" id="vmc-cpu" value="2" min="1" style="width:70px"></div>
      <div class="field"><div class="input-label">Disk (GB)</div><input class="input" type="number" id="vmc-disk" value="40" min="4" style="width:80px"></div>
      <div class="field"><div class="input-label">OS (optional)</div><input class="input" id="vmc-os" style="width:120px" placeholder="ubuntu24.04"></div>
      <div class="field"><button class="btn btn-sm btn-blue" onclick="vmCreate()">Create</button></div>
    </div>
    <div class="input-label" style="text-transform:none;letter-spacing:0;margin-top:4px">The disk goes in libvirt's default pool; the display listens on this machine only (VNC) — reach it with an SSH tunnel.</div>
  </div>`;
}

function vmCreateToggle() { const f = document.getElementById('vm-create'); if (f) f.style.display = f.style.display === 'none' ? '' : 'none'; }

async function vmCreate() {
  const v = id => document.getElementById(id).value.trim();
  const status = document.getElementById('vms-status');
  setStatus(status, `Creating ${v('vmc-name')}…`, '');
  try {
    await apiFetch('/api/vms/libvirt/create', { method: 'POST', body: { name: v('vmc-name'), iso: v('vmc-iso'),
      memoryMb: Number(v('vmc-mem')), vcpus: Number(v('vmc-cpu')), diskGb: Number(v('vmc-disk')), osVariant: v('vmc-os') } });
    setStatus(status, `✓ ${v('vmc-name')} created and started — install the OS through its display`, 'ok');
    vmsLoad();
  } catch (e) { setStatus(status, `✗ ${e.message}`, 'err'); }
}

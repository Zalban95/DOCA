/* ═══════════════════════════════════════════════════════
   DOCA PANEL — VIRTUAL MACHINES
   ═══════════════════════════════════════════════════════ */

function vmsInit() { vmsLoad(); }

async function vmsLoad() {
  const list = document.getElementById('vms-list');
  if (!list) return;
  try {
    const data = await apiFetch('/api/vms');
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
      </div>
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
      <span class="vm-name">${escHtml(vm.name)}</span>
      <span class="vm-state">${escHtml(vm.stateRaw || vm.state)}</span>
      ${display}
      <span class="vm-acts">${actions.join('')}</span>
    </div>`;
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
  if (action === 'kill') appConfirm(`Cut the power to "${name}"? The guest is not asked to shut down.`, go);
  else go();
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

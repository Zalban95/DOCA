/* Live's "VMs" switch (asked 2026-10-15: "a toggle to enable seeing VMs as it has for processes in Live … if the VM is
   in this host then I guess we can have a preview, or if it has a password we could have the black screen with a lock
   and just show resources used live and basic info"). Off, Live is as it was. On — kept per browser, like "VMs and VNC in
   front" — every VM on this host is a tile, running or not (GET /api/machines/vms/all, machines/vm-all.js):
     running, pictured     its screen, as before (machines/vm-shots.js)
     running, no picture   black, with a lock: its hypervisor gives none, or taking it failed — and its readings: CPU,
                           memory in use of what it is given, disks, how long it has run, who started it
     shut off or paused    dimmed, with what it is given, when it last ran if known, and ▶ Start (starting does not ask)
   The VNC screens that do not answer, or ask for a password DOCA does not hold, are lock tiles too. No password is
   tried; every word is a reading in fixed words. Host only, and only where the licence has `machines-all`. */
const MLV = { data: null, starting: {},
  on: (() => { try { return localStorage.getItem('doca.live.vmsAll') === '1'; } catch { return false; } })() };

const liveVmsAllOn = () => MLV.on && (typeof licenceFeatureOn !== 'function' || licenceFeatureOn('machines-all'));

/** The switch for Live's header; nothing where the licence does not have it. */
function liveVmsAllHtml() {
  if (typeof licenceFeatureOn === 'function' && !licenceFeatureOn('machines-all')) return '';
  return `<label class="ml-vms-front"><input type="checkbox" class="switch"${MLV.on ? ' checked' : ''} onchange="liveVmsAll(this.checked)"> VMs${infoBtn('On: every virtual machine on this host is a tile, running or not. One whose screen cannot be pictured shows a lock with its CPU, memory, disks and uptime; a stopped one shows when it last ran and Start. VNC screens that do not answer or ask for a password are lock tiles too. Kept for this browser only.')}</label>`;
}

function liveVmsAll(on) {
  MLV.on = !!on;
  try { localStorage.setItem('doca.live.vmsAll', on ? '1' : '0'); } catch { /* a private window: for this visit */ }
  if (!on) MLV.data = null;
  if (typeof _mlLoad === 'function') _mlLoad();
}

/** Read every VM, while the switch is on (Live's own timer calls this beside /api/machines). */
async function liveVmsLoad(fresh = false) {
  if (!liveVmsAllOn()) { MLV.data = null; return; }
  try { MLV.data = await apiFetch(`/api/machines/vms/all${fresh ? '?fresh=1' : ''}`); }
  catch (e) { MLV.data = { vms: [], vnc: [], error: e.message }; }
}

const _mlvGiB = kib => (kib == null ? null : kib >= 1048576 ? `${(kib / 1048576).toFixed(1)} GiB` : `${Math.round(kib / 1024)} MiB`);
const _mlvGB = b => (b == null ? null : b >= 1e9 ? `${(b / 1073741824).toFixed(1)} GiB` : `${Math.round(b / 1048576)} MiB`);
function _mlvFor(ms) {
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

/** A VM's readings as rows of a small table: what it uses now, what it is given, how long it has run. */
function _mlvFacts(v) {
  const g = v.given || {}, l = v.live || {}, rows = [];
  if (v.state === 'running') {
    rows.push(['CPU', [l.cpu != null ? `${l.cpu}% of ${l.cpuOf === 'core' ? 'one core' : 'its CPUs'}` : v.reads ? '—' : 'reading…', g.vcpus && `${g.vcpus} vCPU${g.vcpus > 1 ? 's' : ''}`].filter(Boolean).join(' · ')]);
    const mem = [l.memUsedKiB != null && `${_mlvGiB(l.memUsedKiB)} in use`, g.maxKiB && `of ${_mlvGiB(g.maxKiB)}`].filter(Boolean).join(' ');
    rows.push(['Memory', mem || '—']);
  } else {
    rows.push(['Given', [g.vcpus && `${g.vcpus} CPU${g.vcpus > 1 ? 's' : ''}`, g.maxKiB && _mlvGiB(g.maxKiB)].filter(Boolean).join(' · ') || '—']);
  }
  const disks = (g.disks || []).filter(d => d.size);
  if (disks.length) rows.push(['Disk', disks.map(d => `${_mlvGB(d.used)} of ${_mlvGB(d.size)}`).join(', ')]);
  if (v.state === 'running') rows.push(['Up', v.startedAt ? _mlvFor(Date.now() - v.startedAt) : '—']);
  else rows.push(['Last ran', v.lastRan ? `${_mlvFor(Date.now() - v.lastRan)} ago` : 'not known']);
  return `<dl class="mlv-facts">${rows.map(([k, x]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(x)}</dd>`).join('')}</dl>`;
}

/** The black panel: a lock when its screen is shut to DOCA, the readings, and Start for one that is down. */
function _mlvPanel({ lock = false, why = '', facts = '', reads = '', start = null, state = '' }) {
  return `<div class="mlv-panel${lock ? ' locked' : ''}">${lock ? `<div class="mlv-lock">${uiIcon('lock', 22)}</div>` : state ? `<div class="mlv-state">${escHtml(state)}</div>` : ''}
    ${why ? `<div class="mlv-why">${escHtml(why)}</div>` : ''}${facts}${reads ? `<div class="mlv-reads">${escHtml(reads)}</div>` : ''}
    ${start ? `<button class="btn btn-xs mlv-start">${uiIcon('start', 12)} ${start === 'resume' ? 'Resume' : 'Start'}</button>` : ''}</div>`;
}

/** Every VM as a tile (in place of Live's running ones), and the VNC screens shut to DOCA. `d`: /api/machines. */
function liveVmsTiles(d) {
  const tiles = [], asVnc = new Set((d.vnc || []).filter(n => n.same?.kind === 'vm').map(n => n.same.id));
  for (const v of MLV.data?.vms || []) {
    if (asVnc.has(v.key)) continue;   // a VM that is a VNC target is that target's one tile
    const running = v.state === 'running', starting = MLV.starting[v.key];
    const t = { id: `v:${v.key}`, kind: '▣', title: v.name, busy: !!v.busy?.busy, by: v.origin,
      point: running ? 'up' : v.state === 'paused' ? 'paused' : 'down',
      line: v.busy?.busy ? `busy: ${v.busy.text}` : [v.label, v.os].filter(Boolean).join(' · '),
      open: () => (running && v.console?.how === 'hub' ? vmConsoleOpen(v.hypervisor, v.name) : nav('vms')) };
    if (running && !v.locked) {
      Object.assign(t, { working: !!v.busy?.busy, who: v.console?.how === 'hub' ? 'VNC' : '', empty: 'Taking its picture…',
        img: v.shot ? `/api/machines/vms/${encodeURIComponent(v.hypervisor)}/${encodeURIComponent(v.name)}/shot` : null });
    } else if (running) {
      Object.assign(t, { working: !!v.busy?.busy, who: 'no picture', cls: 'mlv-locked',
        panel: _mlvPanel({ lock: true, why: v.why, facts: _mlvFacts(v), reads: v.reads }) });
    } else {
      Object.assign(t, { working: false, who: v.state === 'paused' ? 'paused' : 'shut off', cls: 'mlv-off',
        panel: _mlvPanel({ state: starting || (v.state === 'paused' ? 'Paused' : 'Shut off'), facts: _mlvFacts(v), start: starting ? null : v.start }),
        bind: el => el.querySelector('.mlv-start')?.addEventListener('click', e => { e.stopPropagation(); liveVmStart(v.hypervisor, v.name, v.start); }) });
    }
    tiles.push(t);
  }
  const shown = new Set((d.vnc || []).map(n => n.id));
  for (const n of MLV.data?.vnc || []) if (!shown.has(n.id)) tiles.push(_mlvVncTile(n));
  return tiles;
}

/** A VNC screen shut to DOCA: one that does not answer, or asks for a password DOCA does not hold. */
function _mlvVncTile(n) {
  const down = n.state === 'unreachable';
  return { id: `n:${n.id}`, working: false, kind: '◫', title: n.name, point: down ? 'down' : 'up', cls: 'mlv-locked',
    line: `${n.host}:${n.port}`, who: down ? 'does not answer' : 'locked',
    panel: _mlvPanel({ lock: true, why: n.why || '', reads: down ? '' : n.hasPassword ? 'The password kept for it is refused.' : 'No password is kept for it: add one under Machines → VNC.' }),
    open: () => nav('vnc') };
}

/** Start (or resume) a VM from its tile: the VMs tab's own route; starting does not ask (lib/machine-ask.js). */
function liveVmStart(hypervisor, name, action) {
  const key = `${hypervisor}:${name}`;
  const go = async () => {
    MLV.starting[key] = action === 'resume' ? 'Resuming…' : 'Starting…';
    if (typeof _mlRedraw === 'function') _mlRedraw();
    try { await apiFetch(`/api/vms/${encodeURIComponent(hypervisor)}/action`, { method: 'POST', body: { name, action } }); }
    catch (e) { appAlert(`${name} did not start: ${e.message}`); }
    setTimeout(async () => { await liveVmsLoad(true); delete MLV.starting[key]; if (typeof _mlLoad === 'function') _mlLoad(); }, 1500);
  };
  if (typeof machineAskFirst !== 'function' || !machineAskFirst('vm', key, action, `"${name}"`, go)) go();
}

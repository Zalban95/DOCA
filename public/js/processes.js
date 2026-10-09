/* The Processes drawer (modules/processes; asked 2026-10-09: "an eye on other existing non-system processes"). A small
   button in the Workstream's bar, and in Machines → Live's header, opens a drawer in the Workstream activity panel's
   look — white on black, lower right — listing what a person started on this machine, grouped by where it comes from:
   a project or a git repository, an agent's job, DOCA itself, an agents' computer, one of DOCA's services, a
   container, or outside DOCA. Each process is drawn as the status column's machine rows are (lib/machine-origin.js's
   words, "started outside DOCA" in amber), its children folded under it. Read only: stopping things stays with the
   machine rows and their confirmations; a group that is a container or a service opens its own tab. Read every 3 s
   while open and the page is visible; the hub stops reading 30 s after the last look. Host only (the machine's). */
const PD = { open: false, timer: null, data: null, kids: new Set(), host: null,
  system: (() => { try { return localStorage.getItem('doca.processes.system') === '1'; } catch { return false; } })() };
const PD_MS = 3000;
const PD_KIND = { project: 'Project', repo: 'Repository', job: 'Agent\'s job', doca: '', computer: 'Computer', service: 'Service', container: 'Container', outside: '', system: '' };

/** The button's markup: the same small control as the Workstream's ⟳ and ⧉. */
function processesButtonHtml() {
  if (typeof licenceFeatureOn === 'function' && !licenceFeatureOn('processes')) return '';
  return `<button class="btn btn-xs pd-btn${PD.open ? ' btn-teal' : ''}" onclick="processesDrawer()" title="What people started on this machine, grouped by where it comes from — read only">Processes</button>`;
}

/** Open, close or flip the drawer, over the page shown (`host`: its element). */
function processesDrawer(on = !PD.open, host = null) {
  PD.open = !!on;
  document.querySelectorAll('.pd-btn').forEach(b => b.classList.toggle('btn-teal', PD.open));
  clearInterval(PD.timer); PD.timer = null;
  let el = document.getElementById('pd-drawer');
  if (!PD.open) { el?.remove(); PD.host = null; return; }
  PD.host = host || document.querySelector('.tab-page.active') || document.body;
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'pd-drawer', className: 'pd-drawer' });
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Processes on this machine');
    el.innerHTML = `<div class="pd-head"><span class="ws-title">Processes</span><span class="pd-status" id="pd-status">reading…</span>
        <button class="btn btn-xs" onclick="processesDrawer(false)" title="Close">✕</button></div>
      <div class="pd-body" id="pd-body"></div><div class="pd-foot" id="pd-foot"></div>`;
    document.body.append(el);
  }
  _pdPlace();
  _pdFoot();
  _pdLoad();
  PD.timer = setInterval(() => { if (document.visibilityState === 'visible' && PD.open) _pdLoad(); }, PD_MS);
}

/** Lower right of the page it opened over (fixed, so a scrolling page does not carry it away). */
function _pdPlace() {
  const el = document.getElementById('pd-drawer');
  if (!el || !PD.host?.getBoundingClientRect) return;
  const r = PD.host.getBoundingClientRect();
  el.style.right = `${Math.max(0, window.innerWidth - r.right)}px`;
  el.style.bottom = `${Math.max(0, window.innerHeight - Math.min(r.bottom, window.innerHeight))}px`;
  el.style.maxWidth = `${Math.max(280, r.width)}px`;
}

async function _pdLoad() {
  const body = document.getElementById('pd-body');
  if (!body) return;
  try { PD.data = await apiFetch(`/api/machines/processes${PD.system ? '?system=1' : ''}`); }
  catch (e) { body.innerHTML = emptyStateHtml({ title: 'Processes cannot be read here', text: e.message }); return; }
  _pdDraw();
}

const _pdMem = b => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`);
const _pdCpu = c => (c == null ? '—' : `${c >= 10 ? Math.round(c) : c}%`);
function _pdFor(at) {
  const s = Math.max(0, (Date.now() - at) / 1000);
  return s < 90 ? 'just started' : s < 5400 ? `running ${Math.round(s / 60)} min` : s < 172800 ? `running ${Math.round(s / 3600)} h` : `running ${Math.round(s / 86400)} days`;
}

/** Where a group's or a port's link goes: its own tab. */
function processesGo(tab) { if (tab) { processesDrawer(false); nav(tab); } }

function _pdPorts(ports) {
  if (!ports.length) return '';
  const known = ports.filter(p => p.go);
  if (known.length) return known.map(p => `<span class="m-detail">listening on port ${p.port}${p.label ? ` — ${escHtml(p.label)}` : ''} — <a href="#" onclick="processesGo(${jsArg(p.go.tab)});return false">open it</a></span>`).join('');
  return `<span class="m-detail">listening on port${ports.length > 1 ? 's' : ''} ${ports.map(p => p.port).join(', ')}</span>`;
}

/** One process as the status column draws a machine: a point, its name, a line or two of detail, who started it. */
function _pdRow(r) {
  const busy = (r.cpu || 0) >= 25;   // the busy line machines/busy.js draws past 25% of one core
  const who = r.who?.text ? `<span class="m-detail${r.who.outside ? ' outside' : ''}">${escHtml(r.who.text)}${r.who.at && typeof machineAgo === 'function' ? `, ${machineAgo(r.who.at)}` : ''}</span>` : '';
  const facts = [`${_pdMem(r.mem)} of memory`, r.startedAt ? _pdFor(r.startedAt) : '', r.user ? `as ${r.user}` : ''].filter(Boolean).join(' · ');
  const kids = r.children.length ? `<details class="pd-kids" data-pid="${r.pid}"${PD.kids.has(r.pid) ? ' open' : ''}>
      <summary>${r.total.count - 1} more under it — ${_pdCpu(r.total.cpu)} CPU and ${_pdMem(r.total.mem)} together</summary>${r.children.map(_pdRow).join('')}</details>` : '';
  return `<div class="pd-proc"><div class="c-item m-row running${r.system ? ' pd-system' : ''}" title="${escHtml(`${r.name} (process ${r.pid})\n${r.command}`)}">
      <span class="m-main"><span class="c-name">${escHtml(r.name)}</span>${busy ? `<span class="m-detail m-busy">busy: ${_pdCpu(r.cpu)} of one core</span>` : ''}
        <span class="m-detail pd-cmd">${escHtml(r.command)}</span><span class="m-detail">${escHtml(facts)}</span>${_pdPorts(r.ports)}${who}</span>
      <span class="c-state" title="CPU, as a share of one core">${_pdCpu(r.cpu)}</span></div>${kids}</div>`;
}

function _pdGroup(g) {
  const kind = PD_KIND[g.kind] ?? '';
  const open = g.go?.tab ? `<a href="#" onclick="processesGo(${jsArg(g.go.tab)});return false" title="Open where it is managed">open →</a>` : '';
  return `<div class="pd-group"><div class="m-sub"><span>${kind ? `${escHtml(kind)} · ` : ''}<b>${escHtml(g.title)}</b></span>${open}</div>
    <div class="m-life">${escHtml(g.sub)} · ${g.total.count} process${g.total.count === 1 ? '' : 'es'} · ${_pdCpu(g.total.cpu)} CPU · ${_pdMem(g.total.mem)}</div>
    ${g.rows.map(_pdRow).join('')}${g.more ? `<div class="m-life">and ${g.more} more</div>` : ''}</div>`;
}

function _pdDraw() {
  const body = document.getElementById('pd-body'), d = PD.data;
  if (!body || !d) return;
  const st = document.getElementById('pd-status');
  if (st) st.textContent = `${d.counts.shown} of ${d.counts.total} · read every ${Math.round(d.everyMs / 1000)} s while open`;
  const top = body.scrollTop;
  body.innerHTML = d.groups.length ? d.groups.map(_pdGroup).join('')
    : emptyStateHtml({ title: 'Nothing of yours is running', text: 'Only the system\'s own processes are running on this machine. "The system" below lists them.' });
  body.scrollTop = top;
  body.querySelectorAll('details.pd-kids').forEach(det => det.addEventListener('toggle', () => {
    const pid = Number(det.dataset.pid);
    if (det.open) PD.kids.add(pid); else PD.kids.delete(pid);
  }));
  _pdFoot();
}

/** Under Advanced's fold: the switch for the system's own, and exactly what is left out and how many of each. */
function _pdFoot() {
  const foot = document.getElementById('pd-foot');
  if (!foot) return;
  const d = PD.data, why = d?.counts?.why || {};
  const rules = (d?.rules || []).map(r => `<li>${escHtml(r)}</li>`).join('');
  const counts = Object.entries(why).map(([k, n]) => `${n} ${escHtml(k)}`).join(' · ');
  const was = foot.querySelector('details')?.open;
  foot.innerHTML = advancedFold(`<label class="pd-switch"><input type="checkbox" class="switch" data-default="false"${PD.system ? ' checked' : ''} onchange="processesSystem(this.checked)"> Also list the system's own processes</label>
    <p class="m-life">Left out unless asked:</p><ul class="pd-rules">${rules}</ul>${counts ? `<p class="m-life">Now: ${counts}.</p>` : ''}
    <p class="m-life">Read only. To stop something, use its row in the status column or its tab — they ask first.</p>`,
    { label: d ? `The system — ${d.counts.system} left out` : 'The system', id: 'processes-system', count: 1 });
  if (was) foot.querySelector('details').open = true;
  if (typeof advancedFoldRefresh === 'function') advancedFoldRefresh(foot);
}

function processesSystem(on) {
  PD.system = !!on;
  try { localStorage.setItem('doca.processes.system', on ? '1' : '0'); } catch { /* this browser keeps nothing */ }
  _pdLoad();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('resize', () => { if (PD.open) _pdPlace(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && PD.open && !document.querySelector('.modal-overlay.open, dialog[open]')) processesDrawer(false); });
}

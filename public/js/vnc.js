/* Machines → VNC (modules/vnc-targets; asked 2026-10-08: "a vnc section in machines, same logic, showing the running and
   connected ones on the live and so on"). Screens of other machines added by address: each with its point — connected
   (someone watches or drives it through the hub), reachable, or unreachable — a console to watch or take over, and Live
   focused on it. The hub keeps each password and signs in itself, so this page never holds one: the form sends it once
   and reads back only "kept". Below, the displays DOCA already knows (a running VM's, the agents' computers'), read-only,
   and the owner's switch for the agent's vnc_look and vnc_input. The page is made here: index.html is at its ceiling. */
const VNC = { data: null, timer: null, editing: null };

function vncTab(shown) {
  clearInterval(VNC.timer); VNC.timer = null;
  if (!shown) return;
  vncLoad();
  VNC.timer = setInterval(() => { if (document.visibilityState === 'visible' && !VNC.editing) vncLoad(); }, 5000);
}

async function vncLoad() {
  const page = document.getElementById('tab-vnc');
  if (!page) return;
  if (!page.querySelector('.vnc-list')) {
    page.innerHTML = `${pageHeadHtml({ title: 'VNC', sub: 'Other machines\' screens, reached by address. The hub keeps each password and signs in itself; no browser is ever sent one.',
      actions: '<button class="btn btn-sm btn-blue" onclick="vncEdit()">+ Add a screen</button><button class="btn btn-sm" onclick="vncLoad()">↺ Refresh</button>' })}
      <div class="card mb8"><div class="card-title">Screens</div><div class="vnc-form"></div><div class="vnc-list"><div class="placeholder pulse">Loading…</div></div></div>
      <div class="card mb8"><div class="card-title">Already known here</div><div class="vnc-known"></div></div>
      <div class="card"><div class="card-title">The agent</div><div class="vnc-agent"></div></div>`;
  }
  try { VNC.data = await apiFetch('/api/machines/vnc'); }
  catch (e) { page.querySelector('.vnc-list').innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  _vncDraw(page);
}

const _vncPoint = s => (s === 'unreachable' ? 'down' : 'up');
const _vncStateWord = t => (t.state === 'connected' ? (t.driving ? 'driven' : 'watched') : t.state);

function _vncRowHtml(t) {
  const id = jsArg(t.id), live = t.state !== 'unreachable';
  const same = t.same ? ` · ${t.same.kind === 'vm' ? 'VM' : 'computer'} ${escHtml(t.same.name)}` : '';
  return `<div class="vm-row vnc-row">
      <span class="m-pt ${_vncPoint(t.state)}" title="${escHtml(t.state)}"></span>
      <span class="vm-name">${escHtml(t.name)}</span>
      <span class="vm-state">${escHtml(_vncStateWord(t))}</span>
      <span class="vm-display"><code>${escHtml(t.host)}:${t.port}</code><span class="vnc-pass">${t.hasPassword ? 'password kept' : 'no password'}${same}</span></span>
      <span class="vm-acts">
        ${live ? `<button class="btn btn-xs" title="Connect and watch it, view only" onclick="vncConsoleOpen(${id})">Connect</button>
        <button class="btn btn-xs" title="Drive it: the agent's input waits until you hand it back" onclick="vncConsoleOpen(${id}, true)">Take over</button>
        <button class="btn btn-xs" title="Its picture in Machines → Live" onclick="liveFocus(${jsArg(`n:${t.id}`)})">Live</button>` : ''}
        <button class="btn btn-xs" title="Sign in now with what is kept" onclick="vncTest(${id}, this)">Test</button>
        <button class="btn btn-xs" onclick="vncEdit(${id})">Edit</button>
        <button class="btn btn-xs btn-red" onclick="vncRemove(${id})">Remove</button></span>
    </div>`;
}

function _vncDraw(page) {
  const d = VNC.data;
  page.querySelector('.vnc-list').innerHTML = d.targets.length ? d.targets.map(_vncRowHtml).join('')
    : '<div class="placeholder">No screen added yet. Add one by its address — a VNC server on a desk, a Raspberry Pi, a VM on another machine.</div>';
  page.querySelector('.vnc-known').innerHTML = d.known.length ? d.known.map(k => `<div class="vm-row vnc-row">
      <span class="m-pt up"></span><span class="vm-name">${escHtml(k.name)}</span><span class="vm-state">${k.kind === 'vm' ? 'VM' : 'computer'}</span>
      <span class="vm-display">${k.host ? `<code>${escHtml(k.host)}:${k.port}</code>` : '<span class="vnc-pass">its own live view</span>'}</span>
      <span class="vm-acts">${k.kind === 'computer' ? `<button class="btn btn-xs" onclick="computersWatch(${jsArg(k.id)})">Watch</button>`
        : `${k.opens === 'hub' ? `<button class="btn btn-xs" onclick="vmConsoleOpen(${jsArg(k.id.split(':')[0])}, ${jsArg(k.id.split(':').slice(1).join(':'))})">VNC</button>`
          : `<span class="vnc-pass" title="${escHtml(k.why || '')}">in a viewer</span>`}<button class="btn btn-xs" title="Keep it as a VNC screen" onclick="vncSaveDisplay(${jsArg(k.name)}, ${jsArg(k.host)}, ${k.port})">Save</button>`}</span></div>`).join('')
    : '<div class="placeholder">No running VM shows a VNC display, and no agents\' computer is running. They are listed here when they are, without being added.</div>';
  page.querySelector('.vnc-agent').innerHTML = `<p class="vnc-note">Ask the agent to take control of one of these screens and it uses <code>vnc_look</code>
      (a screenshot, read by the vision pass when it is on) and <code>vnc_input</code> (click, scroll, keys, text) under your approvals — asked in
      Manual mode. A specialist sent to test on one asks you before every action. The agent waits while you drive a screen, never types a password
      DOCA keeps, and a person without the host right uses only the screens allotted to them (Settings → Users).</p>`;
}

/** The add or edit form, in the card. The password field is empty on edit: the hub never sends one back. */
function vncEdit(id) {
  const page = document.getElementById('tab-vnc');
  const t = id ? VNC.data?.targets.find(x => x.id === id) : null;
  VNC.editing = id || 'new';
  page.querySelector('.vnc-form').innerHTML = `<div class="vnc-edit">
      <label><span class="input-label">Name</span><input class="input" id="vnc-f-name" value="${escHtml(t?.name || '')}" placeholder="desk"></label>
      <label><span class="input-label">Host</span><input class="input" id="vnc-f-host" value="${escHtml(t?.host || '')}" placeholder="192.168.1.20 or desk.local"></label>
      <label><span class="input-label">Port</span><input class="input" id="vnc-f-port" type="number" min="1" max="65535" value="${t?.port || 5900}"></label>
      <label><span class="input-label">Password</span><input class="input" id="vnc-f-pass" type="password" autocomplete="new-password"
        placeholder="${t?.hasPassword ? 'kept — leave empty to keep it' : 'none, or the VNC password'}"></label>
      ${t?.hasPassword ? '<label class="vnc-forget"><input type="checkbox" id="vnc-f-forget"> forget the kept password</label>' : ''}
      <span class="vnc-edit-acts"><button class="btn btn-xs btn-blue" onclick="vncSave()">Save</button><button class="btn btn-xs" onclick="vncEditClose()">Cancel</button></span>
    </div>`;
  page.querySelector('#vnc-f-name').focus();
}

function vncEditClose() {
  VNC.editing = null;
  const f = document.querySelector('#tab-vnc .vnc-form');
  if (f) f.innerHTML = '';
}

async function vncSave() {
  const v = sel => document.getElementById(sel)?.value ?? '';
  const body = { name: v('vnc-f-name').trim(), host: v('vnc-f-host').trim(), port: Number(v('vnc-f-port')) };
  const pass = v('vnc-f-pass');
  if (pass) body.password = pass;
  else if (document.getElementById('vnc-f-forget')?.checked) body.password = '';
  const id = VNC.editing !== 'new' ? VNC.editing : null;
  try {
    await apiFetch(id ? `/api/machines/vnc/${encodeURIComponent(id)}` : '/api/machines/vnc', { method: id ? 'PUT' : 'POST', body });
    vncEditClose();
    vncLoad();
  } catch (e) { appAlert(e.message); }
}

function vncRemove(id) {
  const t = VNC.data?.targets.find(x => x.id === id);
  appConfirm(`Remove "${t?.name || id}"? Its kept password goes with it.`, async () => {
    try { await apiFetch(`/api/machines/vnc/${encodeURIComponent(id)}`, { method: 'DELETE' }); vncLoad(); } catch (e) { appAlert(e.message); }
  });
}

/** Test one now: a fresh look, signing in with the kept password. */
async function vncTest(id, btn) {
  const was = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
  try { const r = await apiFetch(`/api/machines/vnc/${encodeURIComponent(id)}/test`); appAlert(r.ok ? `It answers: ${r.width}×${r.height}${r.name ? `, "${r.name}"` : ''}.` : `It does not answer: ${r.why}`); }
  catch (e) { appAlert(e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = was; } vncLoad(); }
}

/** A VM's VNC display kept as a screen, in one click (from this page, the VMs tab or its console). */
async function vncSaveDisplay(name, host, port) {
  try { await apiFetch('/api/machines/vnc', { method: 'POST', body: { name, host, port } }); appAlert(`Saved as the VNC screen "${name}" (Machines → VNC).`); }
  catch (e) { appAlert(e.message); }
  if (document.getElementById('tab-vnc')?.classList.contains('active')) vncLoad();
}

/** A target's console in the panel, through the hub — watching, or driving (the agent's input waits meanwhile). */
let _vncView = null;
async function vncConsoleOpen(id, drive = false) {
  if (!VNC.data) { try { VNC.data = await apiFetch('/api/machines/vnc'); } catch (e) { return appAlert(e.message); } }
  const t = VNC.data.targets.find(x => x.id === id);
  if (!t) return appAlert('That screen is gone.');
  const url = drive ? t.console.drive : t.console.watch;
  // Take over and Hand back swap what the open view shows, in place: closing it would go Back, and that Back would
  // close the view that replaced it.
  const ov = _vncView?.ov || Object.assign(document.createElement('div'), { className: 'pc-live' });
  ov.innerHTML = `<div class="pc-live-bar"><b>${escHtml(t.name)}</b><span class="pc-dim">${escHtml(`${t.host}:${t.port}`)}</span>
      ${drive ? '<span class="pc-driving">You are driving — the agent\'s input waits</span>' : ''}
      <span style="flex:1"></span>
      <button class="btn btn-xs" onclick="vncConsoleOpen(${jsArg(id)}, ${drive ? 'false' : 'true'})">${drive ? 'Hand back' : 'Take over'}</button>
      <a class="btn btn-xs" href="${escHtml(url)}" target="_blank" rel="noopener">Open in a window</a>
      <button class="btn btn-xs" onclick="vncConsoleClose()">✕</button></div>
    <iframe src="${escHtml(url)}" title="${escHtml(t.name)}" allow="clipboard-read; clipboard-write"></iframe>`;
  if (!_vncView) { document.body.appendChild(ov); _vncView = { ov, release: overlayBack(() => vncConsoleClose(true)) }; }
}

function vncConsoleClose(fromBack) {
  if (!_vncView) return;
  const { ov, release } = _vncView;
  _vncView = null;
  ov.remove();
  if (!fromBack) release();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-vnc' });
  document.getElementById('tab-settings')?.before(page);
});

/* ═══════════════════════════════════════════════════════
   VMs → Computers for agents (modules/computers, clients/computer): Linux
   desktops in containers that missions work in — make one, watch it (noVNC,
   from this machine's browser), stop it, remove it with its files.
   ═══════════════════════════════════════════════════════ */

async function computersLoad() {
  const tab = document.getElementById('tab-vms');
  if (!tab) return;
  let card = document.getElementById('computers-card');
  if (!card) { card = document.createElement('div'); card.className = 'card'; card.id = 'computers-card'; tab.prepend(card); }
  let data;
  try { data = await apiFetch('/api/computers'); }
  catch (e) { card.innerHTML = `<div class="card-title">Computers for agents</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const rows = data.computers.map(c => `<div class="disk-row">
      <span class="disk-label">${c.state === 'running' ? '●' : '○'} ${escHtml(c.name)} <span style="color:var(--muted)">${escHtml(c.id)}</span></span>
      <span class="disk-path" title="${escHtml(c.purpose || '')}">${escHtml(c.purpose || c.state)}</span>
      <span class="disk-free">
        ${c.state === 'running' ? `<a class="btn btn-xs" href="${escHtml(c.vnc.url)}" target="_blank" rel="noopener" title="Watch or take over (VNC password ${escHtml(c.vnc.password)}) — from this machine's browser">Watch</a>
          <button class="btn btn-xs" onclick="computersAct('stop', ${jsArg(c.id)})">Stop</button>` : `<button class="btn btn-xs" onclick="computersAct('start', ${jsArg(c.id)})">Start</button>`}
        <button class="btn btn-xs btn-red" onclick="computersAct('remove', ${jsArg(c.id)})" title="Remove it and its files">✕</button></span></div>`).join('');
  card.innerHTML = `<div class="card-title" style="display:flex;align-items:center;gap:8px">Computers for agents
      ${data.image.ready ? '<button class="btn btn-xs btn-blue" onclick="computersNew()">＋ New</button>' : '<button class="btn btn-xs btn-amber" onclick="computersBuild()">Build the image</button>'}
      <button class="btn btn-xs" onclick="computersLoad()">↺</button></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">A Linux desktop in a container — shell, files, a real Chromium, screen recording — where a mission can try
      something risky, use a site as a person would, or record a demo, without touching this machine. The Orchestrator makes them with its
      <code>computer</code> tool and sends the <b>Tester</b> to work in one.</p>
    ${rows || '<div class="placeholder">None yet.</div>'}
    <pre class="terminal" id="computers-out" style="display:none;margin-top:8px;max-height:240px"></pre>`;
}

function computersNew() {
  appPrompt('Name for the new computer:', async name => {
    try { await apiFetch('/api/computers', { method: 'POST', body: { name } }); } catch (e) { appAlert(e.message); }
    computersLoad();
  }, 'computer');
}

async function computersAct(action, id) {
  const go = async () => {
    try { await apiFetch(action === 'remove' ? `/api/computers/${id}` : `/api/computers/${id}/${action}`, { method: action === 'remove' ? 'DELETE' : 'POST' }); }
    catch (e) { appAlert(e.message); }
    computersLoad();
  };
  if (action === 'remove') appConfirm('Remove this computer and every file in it?', go); else go();
}

async function computersBuild() {
  const out = document.getElementById('computers-out');
  out.style.display = ''; out.textContent = 'Building the computer image (several minutes the first time)…\n';
  await sseStream('/api/computers/image', {}, { onEvent: e => { out.textContent += e.status || ''; out.scrollTop = out.scrollHeight; } });
  computersLoad();
}

/* ═══════════════════════════════════════════════════════
   COMPUTERS — the agents' computers (modules/computers, clients/computer;
   TODO H13.1): Linux desktops in containers that missions work in. Each card
   is a live thumbnail (a still every few seconds while this tab is open and
   the page is visible), who works in it, what it produced, and one click into
   the live view — the noVNC page through the hub, inside the panel, so a
   phone watches it full screen and Back closes it.
   ═══════════════════════════════════════════════════════ */

const COMPUTERS_STILL_MS = 4000;
const COMPUTERS_LIST_MS = 15000;
let _computersTimers = [];
let _computersView = null;

/** nav() calls this on every tab change: the timers run only while the tab is shown. */
function computersTab(shown) {
  _computersTimers.forEach(clearInterval); _computersTimers = [];
  if (!shown) return;
  computersLoad();
  _computersTimers.push(setInterval(computersStills, COMPUTERS_STILL_MS), setInterval(computersLoad, COMPUTERS_LIST_MS));
}

/** Fetch a new still for every running computer; an image that fails keeps the last one it had. */
function computersStills() {
  if (document.visibilityState !== 'visible') return;
  document.querySelectorAll('#tab-computers img.pc-still[data-id]').forEach(img => {
    const next = new Image();
    next.onload = () => { img.src = next.src; img.classList.remove('pc-still-empty'); };
    next.src = `/api/computers/${img.dataset.id}/screen?t=${Date.now()}`;
  });
}

async function computersLoad() {
  const tab = document.getElementById('tab-computers');
  if (!tab) return;
  let data;
  try { data = await apiFetch('/api/computers'); }
  catch (e) { tab.innerHTML = `<div class="card"><div class="card-title">Computers</div><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  const running = data.computers.filter(c => c.state === 'running').length;
  tab.innerHTML = `<div class="toolbar" style="margin-bottom:8px">
      <div class="card-title" style="margin-bottom:0">Computers</div>
      ${data.image.ready ? '<button class="btn btn-sm btn-blue" onclick="computersNew()">＋ New</button>'
        : '<button class="btn btn-sm btn-amber" onclick="computersBuild()">Build the image</button>'}
      <button class="btn btn-sm" onclick="computersLoad()">↺</button>
      <span class="status-line">${data.computers.length ? `${running} running of ${data.computers.length}` : ''}</span></div>
    <div class="input-label" style="margin-bottom:10px">The agents' computers: a Linux desktop in a container — shell, files, a real Chromium,
      screen recording — where a mission tries something risky, uses a site as a person would, or records a demo, without touching this
      machine. The Orchestrator and work chats make them with their <code>computer</code> tool and send a specialist (the <b>Tester</b>) to
      work in one. One an agent made stops after its mission and is removed some days later unless pinned (📌; the limits are
      under <code>computers</code> in settings). Click a screen to watch or take over.</div>
    <pre class="terminal" id="computers-out" style="display:none;max-height:240px;margin-bottom:8px"></pre>
    <div class="scroll-y" style="flex:1"><div class="pc-grid">${data.computers.map(computersCard).join('')
      || `<div class="placeholder">${data.image.ready ? 'None yet — an agent makes one when it needs it, or ＋ New.' : 'Build the image once (several minutes: Chromium, a desktop, ffmpeg), then agents can make computers.'}</div>`}</div></div>`;
  computersStills();
}

function computersCard(c) {
  const on = c.state === 'running';
  const m = c.mission;
  const who = m ? `<div class="pc-who" title="${escHtml(m.task)}"><b>${escHtml(m.label || m.agentId)}</b> · ${escHtml(m.state)} — ${escHtml(m.task)}</div>`
    : `<div class="pc-who pc-dim">${escHtml(c.purpose || 'No mission yet.')}</div>`;
  const media = (c.media || []).map(f => `<button class="pc-file" title="${escHtml(f.name)}" onclick="computersMedia(${jsArg(f.name)}, ${jsArg(f.mime)})">${
    /^video\//.test(f.mime) ? '▶' : /^image\//.test(f.mime) ? '▣' : '▤'} ${escHtml(f.name.replace(/^computer-[a-f0-9]+-/, '').slice(0, 28))}</button>`).join('');
  return `<div class="pc-card ${on ? '' : 'pc-off'}">
    ${on ? `<img class="pc-still pc-still-empty" data-id="${escHtml(c.id)}" alt="${escHtml(c.name)}'s screen" onclick="computersWatch(${jsArg(c.id)})" title="Watch or take over">`
      : `<div class="pc-still pc-blank">${escHtml(c.state)}</div>`}
    <div class="pc-head"><span class="pc-dot ${on ? 'on' : ''}"></span><b>${escHtml(c.name)}</b><span class="pc-dim">${escHtml(c.id)}</span>
      <span style="flex:1"></span>
      ${on ? `<button class="btn btn-xs" onclick="computersWatch(${jsArg(c.id)})">Watch</button>
        <button class="btn btn-xs" onclick="computersAct('stop', ${jsArg(c.id)})">Stop</button>`
        : `<button class="btn btn-xs" onclick="computersAct('start', ${jsArg(c.id)})">Start</button>`}
      <button class="btn btn-xs ${c.pinned ? 'btn-amber' : ''}" onclick="computersPin(${jsArg(c.id)}, ${!c.pinned})"
        title="${c.pinned ? 'Pinned: kept as it is. Click to let it be tidied away.' : c.auto ? 'Made by an agent: it stops after its mission and is removed some days later. Pin to keep it.' : 'Pin to keep it running after its missions.'}">📌</button>
      <button class="btn btn-xs btn-red" onclick="computersAct('remove', ${jsArg(c.id)})" title="Remove it and its files">✕</button></div>
    ${who}${media ? `<div class="pc-files">${media}</div>` : ''}</div>`;
}

/** The live view inside the panel: the noVNC page through the hub (computers/vnc.js); Back or ✕ closes it. */
async function computersWatch(id) {
  const c = (await apiFetch('/api/computers').catch(() => ({ computers: [] }))).computers.find(x => x.id === id);
  if (!c) return appAlert('That computer is gone.');
  computersWatchClose();
  const ov = document.createElement('div');
  ov.className = 'pc-live';
  ov.innerHTML = `<div class="pc-live-bar"><b>${escHtml(c.name)}</b><span class="pc-dim">${escHtml(c.mission ? `${c.mission.label} · ${c.mission.state}` : c.purpose || '')}</span>
      <span style="flex:1"></span><a class="btn btn-xs" href="${escHtml(c.vnc.url)}" target="_blank" rel="noopener">Open in a window</a>
      <button class="btn btn-xs" onclick="computersWatchClose()">✕</button></div>
    <iframe src="${escHtml(c.vnc.url)}" title="${escHtml(c.name)}" allow="clipboard-read; clipboard-write"></iframe>`;
  document.body.appendChild(ov);
  _computersView = { ov, release: overlayBack(() => computersWatchClose(true)) };
}

function computersWatchClose(fromBack) {
  if (!_computersView) return;
  const { ov, release } = _computersView;
  _computersView = null;
  ov.remove();
  if (!fromBack) release();
}

function computersMedia(name, mime) {
  mediaViewerOpen({ src: `/api/attachments/${encodeURIComponent(name)}`, name,
    kind: /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : 'image' });
}

async function computersPin(id, pinned) {
  try { await apiFetch(`/api/computers/${id}/pin`, { method: 'POST', body: { pinned } }); } catch (e) { appAlert(e.message); }
  computersLoad();
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

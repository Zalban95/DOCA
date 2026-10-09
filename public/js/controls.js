/* ═══════════════════════════════════════════════════════
   DOCA PANEL — CONTROLS  (all containers) and OpenClaw's stack card, which lives in
   Settings → OpenClaw → Stack: it is OpenClaw's compose, drawn only where OpenClaw is
   installed, beside OpenClaw's setup scripts
   ═══════════════════════════════════════════════════════ */

async function action(act, asked) {
  if (!asked && machineAskFirst('stack', 'stack', act, 'the stack', () => action(act, true), act === 'restart' ? 'Every container in it stops and starts again.' : 'Every container in it stops.')) return;
  const st = document.getElementById('action-status');
  setStatus(st, `Running: ${act}…`, 'info');
  const btns = document.querySelectorAll('#stack-card .btn');
  btns.forEach(b => b.disabled = true);
  try {
    await apiFetch('/api/action', { method: 'POST', body: { action: act } });
    setStatus(st, `✓ ${act} completed`, 'ok');
  } catch (e) {
    setStatus(st, `✗ ${e.message}`, 'err');
  } finally {
    btns.forEach(b => b.disabled = false);
    setTimeout(() => { st.textContent = ''; st.className = 'status-line'; }, 8000);
    setTimeout(() => { pollStatus(); controlsRefreshContainers(); }, 2000);
  }
}

/** Update the stack: newest compose definition + images, then recreate.
 *  Streamed rather than awaited like action() — pulling images is slow enough
 *  that a spinner with no output looks like a hang. */
function stackUpdate() {
  machineAsk('stack', 'stack', 'update', 'the stack', _stackRunUpdate,
    'This pulls the newest images and recreates the containers, so services will restart. Running work may be interrupted.');
}

async function _stackRunUpdate() {
  const st   = document.getElementById('action-status');
  const out  = document.getElementById('stack-update-out');
  const btns = document.querySelectorAll('#stack-card .btn');

  setStatus(st, 'Updating stack…', 'info');
  btns.forEach(b => b.disabled = true);
  showStream(out, 'Updating stack…\n');

  await sseStream('/api/stack/update', {}, {
    onStatus: text => appendStream(out, text),
    onDone: d => {
      setStatus(st, d.ok ? '✓ Stack updated' : '✗ Update failed', d.ok ? 'ok' : 'err');
      btns.forEach(b => b.disabled = false);
      setTimeout(() => { pollStatus(); controlsRefreshContainers(); }, 2000);
    },
    onError: e => {
      appendStream(out, `\nError: ${e.message}`);
      setStatus(st, `✗ ${e.message}`, 'err');
      btns.forEach(b => b.disabled = false);
    },
  });
}

/* ── All containers list ─────────────────────────────── */

function controlsInit() {
  harnessLoad();
  controlsRefreshContainers();
}

/** Settings → OpenClaw → Stack: the compose card, then the setup scripts. */
function _subtabStackInit() {
  controlsStackCard();
  loadScripts();
}

/** The Start/Stop card runs docker compose in the stack folder: named for that, and shown only when there is one. */
async function controlsStackCard() {
  const card = document.getElementById('stack-card');
  if (!card) return;
  let info = null;
  try { info = await apiFetch('/api/stack/info'); } catch { /* without host, or no answer: no card */ }
  card.style.display = info?.exists ? '' : 'none';
  if (info?.exists) {
    const t = document.getElementById('stack-card-title');
    t.textContent = `${info.label} · docker compose`;
    t.title = `Start, stop and update run docker compose in ${info.dir} (${info.file}). They do not stop DOCA itself.`;
  }
}

async function controlsRefreshContainers() {
  const list    = document.getElementById('controls-containers-list');
  const countEl = document.getElementById('controls-containers-count');
  if (!list) return;
  if (hostedHive()) { list.innerHTML = `<div class="placeholder">${escHtml(HOSTED_SAY)}</div>`; if (countEl) countEl.textContent = ''; return; }
  try {
    const data = await apiFetch('/api/docker/containers');
    const containers = data.containers || data || [];

    if (!containers.length) {
      list.innerHTML = `<div class="placeholder">${escHtml(data.reason || 'No containers found')}</div>`;
      if (countEl) countEl.textContent = '';
      return;
    }

    // Sort: running first
    containers.sort((a, b) => {
      const aUp = (a.State || a.Status || '').toLowerCase().includes('running') ? 0 : 1;
      const bUp = (b.State || b.Status || '').toLowerCase().includes('running') ? 0 : 1;
      return aUp - bUp;
    });

    const running = containers.filter(c => (c.State || c.Status || '').toLowerCase().includes('running')).length;
    if (countEl) countEl.textContent = `${running}/${containers.length} running`;

    list.innerHTML = containers.map(c => {
      const id      = c.ID || c.Id || '';
      const name    = (c.Names || c.Name || id).replace(/^\//, '');
      const image   = c.Image || '';
      const state   = (c.State || c.Status || '').toLowerCase();
      const isUp    = state.includes('running');
      const q = jsArg(id);
      // A point for its state (E4) and the same row actions as the Docker tab, in the same order (des 5).
      return `<div class="ctrl-container-row">
        <span class="ctrl-cont-status" title="${escHtml(state)}"><span class="pt ${isUp ? 'pt-up pt-run' : 'pt-stopped'}"></span></span>
        <span class="ctrl-cont-name" title="${escHtml(name)}">${escHtml(name)}</span>
        <span class="ctrl-cont-image" title="${escHtml(image)}">${escHtml(image)}</span>
        <div class="ctrl-cont-actions">${rowActs([
          { icon: 'logs', label: 'Logs', onclick: `nav('docker'); dockerToggleLog(${q},${jsArg(name)})` },
          isUp && { icon: 'restart', label: 'Restart', onclick: `controlsContainerAction(${q},'restart')` },
          isUp ? { icon: 'stop', label: 'Stop', onclick: `controlsContainerAction(${q},'stop')` } : { icon: 'start', label: 'Start', onclick: `controlsContainerAction(${q},'start')` },
        ])}</div>
      </div>`;
    }).join('');
  } catch (e) {
    if (list) list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

async function controlsContainerAction(id, act, asked) {
  if (!asked && machineAskFirst('container', id, act, '', () => controlsContainerAction(id, act, true))) return;
  const st = document.getElementById('controls-container-status');
  if (st) setStatus(st, `${act} ${id.slice(0, 8)}…`, 'info');
  try {
    await apiFetch(`/api/docker/containers/${id}/action`, { method: 'POST', body: { action: act } });
    if (st) setStatus(st, `✓ ${act} done`, 'ok');
    setTimeout(() => { if (st) { st.textContent = ''; st.className = 'status-line'; } }, 4000);
    setTimeout(() => { controlsRefreshContainers(); pollStatus(); }, 1200);
  } catch (e) {
    if (st) setStatus(st, `✗ ${e.message}`, 'err');
  }
}

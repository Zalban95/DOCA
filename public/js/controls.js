/* ═══════════════════════════════════════════════════════
   DOCA PANEL — CONTROLS  (service control + all containers)
   ═══════════════════════════════════════════════════════ */

async function action(act) {
  const st = document.getElementById('action-status');
  setStatus(st, `Running: ${act}…`, 'info');
  const btns = document.querySelectorAll('#tab-controls .btn');
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
  appConfirm(
    'Update the stack? This pulls the newest images and recreates the containers, ' +
    'so services will restart. Running work may be interrupted.',
    _stackRunUpdate,
  );
}

async function _stackRunUpdate() {
  const st   = document.getElementById('action-status');
  const out  = document.getElementById('stack-update-out');
  const btns = document.querySelectorAll('#tab-controls .btn');

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

async function controlsRefreshContainers() {
  const list    = document.getElementById('controls-containers-list');
  const countEl = document.getElementById('controls-containers-count');
  if (!list) return;
  try {
    const data = await apiFetch('/api/docker/containers');
    const containers = data.containers || data || [];

    if (!containers.length) {
      list.innerHTML = '<div class="placeholder">No containers found</div>';
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
      const stColor = isUp ? 'var(--green)' : 'var(--muted)';
      const stDot   = isUp ? '●' : '○';

      return `<div class="ctrl-container-row">
        <span class="ctrl-cont-status" style="color:${stColor}" title="${state}">${stDot}</span>
        <span class="ctrl-cont-name" title="${name}">${name}</span>
        <span class="ctrl-cont-image">${image}</span>
        <div class="ctrl-cont-actions">
          <button class="btn btn-xs btn-green"  onclick="controlsContainerAction('${id}','start')"   ${isUp  ? 'disabled' : ''} title="Start">▶</button>
          <button class="btn btn-xs btn-red"    onclick="controlsContainerAction('${id}','stop')"    ${!isUp ? 'disabled' : ''} title="Stop">■</button>
          <button class="btn btn-xs btn-amber"  onclick="controlsContainerAction('${id}','restart')" ${!isUp ? 'disabled' : ''} title="Restart">↺</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    if (list) list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

async function controlsContainerAction(id, act) {
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
